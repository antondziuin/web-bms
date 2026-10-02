/* JK / JBD BMS protocol: frame builders, reassembly (framers) and parsers.
   Pure functions without DOM/BLE access, so they are unit-tested in Node. */
const isNum = Number.isFinite;

export const UUID = {
  JK_SVC:'0000ffe0-0000-1000-8000-00805f9b34fb',
  JK_CHR:'0000ffe1-0000-1000-8000-00805f9b34fb',
  JBD_SVC:'0000ff00-0000-1000-8000-00805f9b34fb',
  JBD_NOTIFY:'0000ff01-0000-1000-8000-00805f9b34fb',
  JBD_CTRL:'0000ff02-0000-1000-8000-00805f9b34fb',
};

export const JK_FRAME_SIZES = [300, 320, 352, 368, 384];

export function sumCrc(frame,len){ let c=0; for(let i=0;i<len;i++) c=(c+(frame[i]&0xFF))&0xFF; return c; }

export function jkIndexOfHeader(a, from=0){
  for (let i=from;i<=a.length-4;i++) if (a[i]===0x55&&a[i+1]===0xAA&&a[i+2]===0xEB&&a[i+3]===0x90) return i;
  return -1;
}

export function jkBuildCmd(cmd,value=0,len=0){
  const frame=new Uint8Array(20);
  frame[0]=0xAA; frame[1]=0x55; frame[2]=0x90; frame[3]=0xEB; frame[4]=cmd; frame[5]=len;
  frame[6]=value&0xFF; frame[7]=(value>>8)&0xFF; frame[8]=(value>>16)&0xFF; frame[9]=(value>>>24)&0xFF;
  frame[19]=sumCrc(frame,19);
  return frame;
}

export function makeJkFramer(onFrame){
  let buf = [];
  return function push(chunk){
    for (const b of chunk) buf.push(b);
    for (;;){
      const h = jkIndexOfHeader(buf);
      if (h < 0){ buf = buf.slice(-3); return; }
      if (h > 0) buf = buf.slice(h);
      if (buf.length < JK_FRAME_SIZES[0]) return;
      const next = jkIndexOfHeader(buf, 4);
      const sizes = JK_FRAME_SIZES.slice();
      if (next >= JK_FRAME_SIZES[0] && !sizes.includes(next)) sizes.push(next);
      sizes.sort((a,b)=>a-b);
      let matched = 0;
      for (const size of sizes){
        if (buf.length < size) break;
        if (sumCrc(buf, size-1) === buf[size-1]){ matched = size; break; }
      }
      if (matched){
        const frame = buf.slice(0, matched);
        buf = buf.slice(matched);
        try{ onFrame(frame); }catch(ex){ console.warn('JK parse', ex); }
        continue;
      }
      // Corrupt / unknown-size frame: resync on the next header, or give up once too long.
      if (next >= JK_FRAME_SIZES[0] || buf.length >= 512){ buf = buf.slice(next > 0 ? next : 4); continue; }
      return;
    }
  };
}

const jk = {
  u16(d,i){ return ((d[i+1]<<8)|d[i]) & 0xFFFF; },
  s16(d,i){ const v=jk.u16(d,i); return (v&0x8000)? (v-0x10000): v; },
  u32(d,i){ return ((jk.u16(d,i+2)<<16)|jk.u16(d,i))>>>0; },
  s32(d,i){ const v=jk.u32(d,i); return (v&0x80000000)? (v-0x100000000): v; },
};

export function parseJkFrame(d){
  const type=d[4];
  if (type===0x01) return parseJkSettings(d);
  if (type===0x02) return parseJk02(d,0) || parseJk02(d,32) || parseJk04(d);
  if (type===0x03) return parseJkDeviceInfo(d);
  return null;
}

export function parseJkDeviceInfo(d){
  const ascii = (a,b)=> String.fromCharCode(...d.slice(a,b)).replace(/[^\x20-\x7e]/g,'').trim();
  const model = ascii(6,22), hw = ascii(22,30), sw = ascii(30,38);
  const s = [model, hw && `HW ${hw}`, sw && `SW ${sw}`].filter(Boolean).join(' · ');
  return s ? { model: s } : null;
}

export function parseJkSettings(d){
  const uvp = jk.u32(d,10), ovp = jk.u32(d,18);
  const soc100 = jk.u32(d,30), soc0 = jk.u32(d,34);
  const okU = uvp>1000 && uvp<5000;
  const okO = ovp>2000 && ovp<5000;
  const okS = soc100>soc0 && soc100<5000 && soc0>1000;
  return {
    cfgUvpMv: okU?uvp:NaN, cfgOvpMv: okO?ovp:NaN,
    cfgSoc0mV: okS?soc0:NaN, cfgSoc100mV: okS?soc100:NaN,
  };
}

export function parseJk02(d,off){
  const nCells = off ? 32 : 24;
  if (d.length < 154+off) return null;
  const cells=[];
  for (let i=0;i<nCells;i++) cells.push(jk.u16(d,6+i*2)*0.001);
  const act = cells.filter(v=>v>0);
  if (!act.length || act.some(v=>v<0.5 || v>5)) return null;

  const totalV = jk.u32(d,118+off) * 0.001;
  const sum = act.reduce((a,b)=>a+b,0);
  // why: проверяем, что напряжение пакета согласуется с суммой ячеек — отсекает неверную раскладку
  if (!(totalV >= 1.5*act.length && totalV <= 5.0*act.length)) return null;
  if (Math.abs(totalV - sum) > Math.max(0.5, sum*0.1)) return null;

  const current = jk.s32(d,126+off) * 0.001;
  const temp1 = jk.s16(d,130+off)*0.1, temp2 = jk.s16(d,132+off)*0.1;
  const tmos = off ? jk.s16(d,112+off)*0.1 : jk.s16(d,134+off)*0.1;
  const errPos = off ? 134+off : 136+off;
  const errMask = (d[errPos]<<8) | d[errPos+1];
  const soc = d[141+off];
  return {
    cells, totalV, current, temp1, temp2,
    tmos: (tmos > -40 && tmos < 150) ? tmos : NaN,
    balancing: d[140+off] !== 0x00,
    soc: soc <= 100 ? soc : NaN,
    capRem: jk.u32(d,142+off)*0.001,
    capFull: jk.u32(d,146+off)*0.001 || NaN,
    cycles: jk.u32(d,150+off),
    errors: jkErrors(errMask),
  };
}

export function parseJk04(d){
  const cells=[];
  const dv = new DataView(new Uint8Array(d).buffer);
  for (let i=0;i<24;i++){ const pos=6+i*4; if (pos+4>d.length) break; cells.push(dv.getFloat32(pos,true)); }
  const act = cells.filter(v=>isNum(v) && v>0);
  if (!act.length || cells.some(v=>!isNum(v) || v<0 || v>5) || act.some(v=>v<0.5)) return null;
  return { cells, totalV: act.reduce((a,b)=>a+b,0) };
}

export function jkErrors(mask){
  if (!(mask>0)) return 'OK';
  const names=['Charge Overtemp','Charge Undertemp','Coprocessor comm','Cell Undervoltage','Pack Undervoltage','Discharge Overcurrent','Discharge Short','Discharge Overtemp','Wire Resistance','MOSFET Overtemp','Cell Count Mismatch','Current Sensor Anomaly','Cell Overvoltage','Pack Overvoltage','Charge Overcurrent','Charge Short'];
  const list=[]; for(let i=0;i<names.length;i++) if(mask&(1<<i)) list.push(names[i]);
  return list.join('; ');
}

export function jbdChecksum(data,offset,len){ let sum=0; for(let i=0;i<len;i++) sum=(sum - (data[offset+i]&0xFF))&0xFFFF; return sum; }

export function jbdBuildRead(reg){
  const frame = new Uint8Array(7);
  frame[0]=0xDD; frame[1]=0xA5; frame[2]=reg; frame[3]=0x00;
  const crc = jbdChecksum(frame,2,2);
  frame[4]=(crc>>8)&0xFF; frame[5]=crc&0xFF; frame[6]=0x77;
  return frame;
}

export function makeJbdFramer(onFrame){
  let buf = [];
  return function push(chunk){
    for (const b of chunk) buf.push(b);
    for (;;){
      const s = buf.indexOf(0xDD);
      if (s < 0){ buf = []; return; }
      if (s > 0) buf = buf.slice(s);
      if (buf.length < 7) return;
      const dataLen = buf[3];
      const frameLen = 4 + dataLen + 3;
      if (buf.length < frameLen) return;
      if (buf[frameLen-1] !== 0x77){ buf = buf.slice(1); continue; }
      const crcRemote = ((buf[frameLen-3] << 8) | buf[frameLen-2]) & 0xFFFF;
      const crcLocal = jbdChecksum(buf, 2, 2 + dataLen);
      if (crcLocal !== crcRemote){ buf = buf.slice(1); continue; }
      const frame = buf.slice(0, frameLen);
      buf = buf.slice(frameLen);
      try{ onFrame(frame); }catch(ex){ console.warn('JBD parse', ex); }
    }
  };
}

const jbd = {
  u16(d,i){ return ((d[i]<<8)|d[i+1])&0xFFFF; },
  s16(d,i){ const v=jbd.u16(d,i); return (v&0x8000) ? v-0x10000 : v; },
  u32(d,i){ return ((jbd.u16(d,i)<<16)|jbd.u16(d,i+2))>>>0; },
};

export function parseJbdFrame(frame){
  const fn = frame[1], status = frame[2], len = frame[3];
  if (status !== 0x00) return null;
  const data = frame.slice(4, 4 + len);
  if (fn === 0x03) return parseJbdHwInfo(data);
  if (fn === 0x04) return parseJbdCells(data);
  if (fn === 0x05) return parseJbdVersion(data);
  return null;
}

export function parseJbdHwInfo(d){
  if (d.length < 23) return null;
  const tempCnt = Math.min(d[22], 6, Math.floor((d.length-23)/2));
  const temps=[]; for(let i=0;i<tempCnt;i++) temps.push((jbd.u16(d,23+i*2)-2731)*0.1);
  const errMask = jbd.u16(d,16);
  return {
    totalV: jbd.u16(d,0)*0.01,
    current: jbd.s16(d,2)*0.01,
    capRem: jbd.u16(d,4)*0.01,
    capFull: jbd.u16(d,6)*0.01 || NaN,
    cycles: jbd.u16(d,8),
    balancing: jbd.u32(d,12) !== 0,
    errors: jbdErrors(errMask),
    soc: d[19],
    temp1: temps[0] ?? NaN, temp2: temps[1] ?? NaN, tmos: temps[2] ?? NaN,
  };
}

export function parseJbdCells(d){
  if (d.length<2 || d.length>64 || (d.length%2)!==0) return null;
  const cells=[]; for(let i=0;i<d.length/2;i++) cells.push(jbd.u16(d,i*2)*0.001);
  return { cells };
}

export function parseJbdVersion(d){
  const s = String.fromCharCode(...d).replace(/[^\x20-\x7e]/g,'').trim();
  return s ? { model: s } : null;
}

export function jbdErrors(mask){
  if (!mask) return 'OK';
  const names=['Cell overvoltage','Cell undervoltage','Pack overvoltage','Pack undervoltage','Charging over temperature','Charging under temperature','Discharging over temperature','Discharging under temperature','Charging overcurrent','Discharging overcurrent','Short circuit','IC front-end error','Mosfet Software Lock','Charge timeout Close','Unknown(0x0E)','Unknown(0x0F)'];
  const out=[]; for(let i=0;i<names.length;i++) if(mask&(1<<i)) out.push(names[i]);
  return out.join('; ');
}

