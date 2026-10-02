/* BLE drivers: wrap a GATT server, stream parsed updates to onData. */
import { UUID, jkBuildCmd, makeJkFramer, parseJkFrame, jbdBuildRead, jbdBuildWrite, makeJbdFramer, parseJbdFrame } from './protocols.js';
import { sleep, withTimeout } from './util.js';

async function writeChr(chr, frame){
  const p = chr.properties || {};
  const primary = p.writeWithoutResponse && chr.writeValueWithoutResponse ? 'wo'
    : p.write && chr.writeValueWithResponse ? 'w' : 'legacy';
  const call = kind => kind==='wo' ? chr.writeValueWithoutResponse(frame)
    : kind==='w' ? chr.writeValueWithResponse(frame) : chr.writeValue(frame);
  try{ await call(primary); }
  catch(e){
    const alt = primary==='wo' ? (chr.writeValueWithResponse ? 'w' : 'legacy') : (chr.writeValueWithoutResponse ? 'wo' : 'legacy');
    if (alt === primary) throw e;
    await call(alt);
  }
}

export function makeWriter(chr){
  let chain = Promise.resolve();
  return frame => {
    const p = chain.then(()=>writeChr(chr, frame));
    chain = p.catch(()=>{});
    return p;
  };
}

export async function makeJk(server, onData, onRaw){
  const svc = await server.getPrimaryService(UUID.JK_SVC);
  const chr = await svc.getCharacteristic(UUID.JK_CHR);
  const write = makeWriter(chr);
  let lastRx = Date.now();
  let watchdog = null;
  let logbookWaiter = null;
  const framer = makeJkFramer(frame=>{
    onRaw?.(frame);
    const p = parseJkFrame(frame);
    if (p?.jkLogbook){ lastRx = Date.now(); logbookWaiter?.(p.jkLogbook); logbookWaiter = null; return; }
    if (p){ lastRx = Date.now(); onData(p); }
  });
  function onNotify(ev){
    const view = ev.target.value;
    framer(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  }
  async function start(){
    chr.addEventListener('characteristicvaluechanged', onNotify);
    await chr.startNotifications();
    await sleep(120);
    await write(jkBuildCmd(0x97)); // device info
    await write(jkBuildCmd(0x96)); // settings + cell info stream
    lastRx = Date.now();
    watchdog = setInterval(()=>{
      if (server.connected && Date.now()-lastRx>3000) write(jkBuildCmd(0x96)).catch(()=>{});
    }, 1000);
  }
  async function stop(){
    if (watchdog){ clearInterval(watchdog); watchdog = null; }
    chr.removeEventListener('characteristicvaluechanged', onNotify);
    if (server.connected){ try{ await chr.stopNotifications(); }catch{} }
  }
  /* Event log stored in the BMS (command 0xA1 → frame 0x05). */
  async function readLogbook(){
    try{
      return await withTimeout(new Promise(resolve => { logbookWaiter = resolve; write(jkBuildCmd(0xA1)).catch(()=>{}); }), 6000, 'No answer from the BMS');
    }finally{ logbookWaiter = null; }
  }
  return { kind:'JK', start, stop, readLogbook };
}

export async function makeJbd(server, onData, onRaw){
  const svc = await server.getPrimaryService(UUID.JBD_SVC);
  const chrN = await svc.getCharacteristic(UUID.JBD_NOTIFY);
  const chrC = await svc.getCharacteristic(UUID.JBD_CTRL);
  const write = makeWriter(chrC);
  let poll = null, tick = 0, paused = false, countersWaiter = null;
  const framer = makeJbdFramer(frame=>{
    onRaw?.(frame);
    const p = parseJbdFrame(frame);
    if (p && ('jbdCounters' in p || 'jbdCountersError' in p)){ countersWaiter?.(p); countersWaiter = null; return; }
    if (p) onData(p);
  });
  function onNotify(ev){
    const view = ev.target.value;
    framer(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  }
  async function start(){
    chrN.addEventListener('characteristicvaluechanged', onNotify);
    await chrN.startNotifications();
    await write(jbdBuildRead(0x05)).catch(()=>{});
    await write(jbdBuildRead(0x03));
    await write(jbdBuildRead(0x04));
    // why: один таймер с чередованием 0x03/0x04 — запросы не наслаиваются
    poll = setInterval(()=>{
      if (!server.connected || paused) return;
      write(jbdBuildRead(tick++ % 2 ? 0x04 : 0x03)).catch(()=>{});
    }, 1000);
  }
  async function stop(){
    if (poll){ clearInterval(poll); poll = null; }
    chrN.removeEventListener('characteristicvaluechanged', onNotify);
    if (server.connected){ try{ await chrN.stopNotifications(); }catch{} }
  }
  function requestCounters(ms){
    return withTimeout(new Promise(resolve => { countersWaiter = resolve; write(jbdBuildRead(0xAA)).catch(()=>{}); }), ms, 'No answer from the BMS')
      .catch(() => null).finally(() => { countersWaiter = null; });
  }
  /* Protection counters (register 0xAA). Some firmware answers only in factory mode: then enter it,
     read and leave it without saving (0x0000 → reg 0x01), so no setting is changed. */
  async function readCounters(){
    paused = true;
    try{
      let r = await requestCounters(1500);
      if (!r?.jbdCounters){
        await write(jbdBuildWrite(0x00, [0x56, 0x78]));
        await sleep(250);
        try{ r = await requestCounters(2500); }
        finally{ await write(jbdBuildWrite(0x01, [0x00, 0x00])).catch(()=>{}); await sleep(150); }
      }
      if (!r?.jbdCounters) throw new Error('No answer from the BMS');
      return r.jbdCounters;
    }finally{ paused = false; }
  }
  return { kind:'JBD', start, stop, readCounters };
}

/* Picks the driver by the services the BMS exposes. Error carries a code for i18n.
   onRaw(kind, frame) optionally receives every checksum-valid frame (raw BLE log). */
export async function createDriver(server, onData, onRaw){
  const hasJBD = await server.getPrimaryService(UUID.JBD_SVC).then(()=>true,()=>false);
  if (hasJBD) return makeJbd(server, onData, onRaw && (f => onRaw('JBD', f)));
  const hasJK = await server.getPrimaryService(UUID.JK_SVC).then(()=>true,()=>false);
  if (hasJK) return makeJk(server, onData, onRaw && (f => onRaw('JK', f)));
  const err = new Error('No supported services found');
  err.code = 'noServices';
  throw err;
}

/* Remembered devices may need an advertisement before gatt.connect() succeeds. */
export async function waitForAdvertisement(device, ms){
  if (typeof device.watchAdvertisements !== 'function') return;
  const ac = new AbortController();
  try{
    await withTimeout(new Promise((resolve, reject)=>{
      device.addEventListener('advertisementreceived', resolve, {once:true});
      device.watchAdvertisements({signal: ac.signal}).catch(reject);
    }), ms, 'no advertisement');
  }catch{ /* best effort */ }
  finally{ ac.abort(); }
}
