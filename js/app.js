/* Battery monitor app: multi-battery connection manager, rendering, picker, settings. */
import { isNum, clamp, map, fmt, num, errMsg, storageGet, storageSet, storageGetJson, storageSetJson, withTimeout, hhmmss, ago } from './util.js';
import { t, applyStaticI18n, detectLang, getLangPref, setLangPref, refreshAutoLang, LANG_NAMES } from './i18n.js';
import { UUID } from './protocols.js';
import { createDriver, waitForAdvertisement } from './ble.js';
import { MAX_CELLS, CHG, createState, applyUpdate, powerW, activeCells, maxTemp, getCellScaleMv, estimateFullCapacityAh, estimateEta, aggregateStates } from './model.js';
import { createSession, sessionAddSummary, sessionAddCells } from './session.js';
import { createChart, METRICS } from './chart.js';
import { initOffline } from './offline.js';

/* ================= Config ================= */
const RECONNECT_MAX_ATTEMPTS = 8;
const CONNECT_TIMEOUT_MS = 20000;
const STALE_AFTER_MS = 10000;
const MAX_POINTS = 1000;
const ALL = 'all';
const STORAGE_KEYS = { devices:'bt:devices', legacyLastDevice:'bt:lastDeviceId', wakeLock:'ui:wakeLock', tab:'ui:tab', metric:'ui:chartMetric' };
const SOC_ARC_LEN = 2 * Math.PI * 54;

const $ = sel => document.querySelector(sel);
const devName = d => d.name || d.id;
const connectErrMsg = err => err?.code === 'noServices' ? t('err.noServices') : errMsg(err);

/* ================= Batteries ================= */
/* One entry per BMS: its own GATT link, reconnect loop, state, history and session counters. */
const batteries = [];
let selectedId = null;       // battery id or ALL
const allPoints = [];        // history of the aggregate (all batteries)
let allSession = createSession();
let globalStatus = { key:'status.idle', params:null, tone:'idle' }; // shown when no battery is listed
const EMPTY_STATE = createState();

function createBattery(device){
  return {
    id: device.id, device, driver:null, connected:false, busy:false, userDisconnect:false,
    reconnectTimer:null, attempts:0,
    status: { key:'status.connecting', params:{ name:devName(device) }, tone:'warn' },
    state: createState(), points: [], session: createSession(),
  };
}
const findBattery = id => batteries.find(b => b.id === id);

/* Current view: a single battery, all batteries (2+), or nothing connected. */
function currentView(){
  if (selectedId === ALL && batteries.length > 1) return { all:true };
  const bat = findBattery(selectedId) || batteries[0];
  return bat ? { bat } : { none:true };
}
function aggregateView(){
  const agg = aggregateStates(batteries.map(b => b.state));
  const errs = batteries.filter(b => b.state.errors && b.state.errors.toUpperCase() !== 'OK').map(b => `${devName(b.device)}: ${b.state.errors}`);
  agg.errors = errs.length ? errs.join('; ') : 'OK';
  return agg;
}
function viewState(v){ return v.bat ? v.bat.state : v.all ? aggregateView() : EMPTY_STATE; }
function viewPoints(){ const v = currentView(); return v.bat ? v.bat.points : v.all ? allPoints : []; }
function select(id){ selectedId = id; scheduleRender(); }

function pushPoint(list, p){
  if (list.length >= MAX_POINTS) list.shift();
  list.push(p);
}

function onBatteryData(bat, p){
  const now = Date.now();
  const res = applyUpdate(bat.state, p, now);
  const s = bat.state;
  if (res.summary){
    pushPoint(bat.points, { t:now, w:powerW(s), i:s.current, v:s.totalV, soc:s.soc });
    sessionAddSummary(bat.session, { v:s.totalV, i:s.current, soc:s.soc, temps:[s.temp1, s.temp2, s.tmos] }, now);
  }
  if (res.cells) sessionAddCells(bat.session, s.cells);
  scheduleRender();
}

/* Samples the aggregate once a second for the "All" chart and system-level session peaks. */
function sampleAggregate(){
  const now = Date.now();
  const live = batteries.filter(b => b.connected && b.state.lastSummaryTs && now - b.state.lastSummaryTs < STALE_AFTER_MS);
  if (!live.length) return;
  const agg = aggregateStates(live.map(b => b.state));
  pushPoint(allPoints, { t:now, w:powerW(agg), i:agg.current, v:agg.totalV, soc:agg.soc });
  sessionAddSummary(allSession, { v:agg.totalV, i:agg.current, soc:agg.soc, temps:[agg.temp1, agg.temp2, agg.tmos] }, now);
}

/* Remembered devices (auto-connect on load). null = never stored (legacy single-device key may exist). */
function rememberedIds(){
  const v = storageGetJson(STORAGE_KEYS.devices, null);
  if (Array.isArray(v)) return v;
  const legacy = storageGet(STORAGE_KEYS.legacyLastDevice, '');
  return legacy ? [legacy] : null;
}
function rememberDevice(id){
  const ids = rememberedIds() || [];
  if (!ids.includes(id)){ ids.push(id); storageSetJson(STORAGE_KEYS.devices, ids); }
  else if (!Array.isArray(storageGetJson(STORAGE_KEYS.devices, null))) storageSetJson(STORAGE_KEYS.devices, ids);
}
function forgetDevice(id){ storageSetJson(STORAGE_KEYS.devices, (rememberedIds() || []).filter(x => x !== id)); }

/* ================= Connection manager (per battery) ================= */
function setBatStatus(bat, key, tone, params){ bat.status = { key, tone, params }; scheduleRender(); }

function onGattDisconnected(ev){
  const bat = batteries.find(b => b.device === ev.target);
  if (!bat) return;
  const wasConnected = bat.connected;
  const d = bat.driver;
  bat.driver = null; bat.connected = false;
  if (d) d.stop().catch(()=>{});
  scheduleRender();
  if (!wasConnected || bat.userDisconnect) return;
  bat.attempts = 0;
  scheduleReconnect(bat);
}

function cancelReconnect(bat){
  if (bat.reconnectTimer){ clearTimeout(bat.reconnectTimer); bat.reconnectTimer = null; }
}
function scheduleReconnect(bat){
  cancelReconnect(bat);
  if (bat.userDisconnect || !findBattery(bat.id)) return;
  if (bat.attempts >= RECONNECT_MAX_ATTEMPTS){ setBatStatus(bat, 'status.noLink', 'error'); return; }
  const delay = Math.min(30000, 1000 * 2 ** bat.attempts);
  bat.attempts++;
  setBatStatus(bat, 'status.retry', 'warn', { s:Math.round(delay/1000), n:bat.attempts, max:RECONNECT_MAX_ATTEMPTS });
  bat.reconnectTimer = setTimeout(async ()=>{
    bat.reconnectTimer = null;
    try{ await connectBattery(bat, { advertise:true, quiet:true }); }
    catch{ scheduleReconnect(bat); }
  }, delay);
}

async function connectBattery(bat, opts = {}){
  if (bat.busy) return false;
  bat.busy = true;
  cancelReconnect(bat);
  const device = bat.device, name = devName(device);
  try{
    bat.userDisconnect = false;
    device.removeEventListener('gattserverdisconnected', onGattDisconnected);
    device.addEventListener('gattserverdisconnected', onGattDisconnected);
    setBatStatus(bat, 'status.connecting', 'warn', { name });
    if (opts.advertise) await waitForAdvertisement(device, 8000);
    const server = await withTimeout(device.gatt.connect(), CONNECT_TIMEOUT_MS, t('err.timeout'));
    const driver = await createDriver(server, p => onBatteryData(bat, p));
    bat.driver = driver;
    await driver.start();
    bat.connected = true;
    bat.attempts = 0;
    rememberDevice(device.id);
    setBatStatus(bat, 'status.connected', 'ok', { name, kind:driver.kind });
    return true;
  }catch(err){
    console.error(err);
    const d = bat.driver; bat.driver = null; bat.connected = false;
    if (d){ try{ await d.stop(); }catch{} }
    try{ device.gatt.disconnect(); }catch{}
    if (!opts.quiet) setBatStatus(bat, 'status.error', 'error', { msg:connectErrMsg(err) });
    throw err;
  }finally{
    bat.busy = false;
    scheduleRender();
  }
}

/* Adds a BMS to the list (or re-uses the existing entry) and connects it. */
async function addBattery(device, opts = {}){
  let bat = findBattery(device.id);
  if (bat && bat.connected){ select(bat.id); return bat; }
  const isNew = !bat;
  if (isNew){
    bat = createBattery(device); batteries.push(bat);
    allSession = createSession(); // why: системные пики/SOC/напряжение имеют смысл только для неизменного набора батарей
  }
  else if (bat.device !== device){
    bat.device.removeEventListener('gattserverdisconnected', onGattDisconnected);
    bat.device = device;
  }
  select(bat.id);
  try{
    await connectBattery(bat, opts);
    return bat;
  }catch(err){
    if (isNew){
      removeBattery(bat);
      globalStatus = { key:'status.error', tone:'error', params:{ msg:connectErrMsg(err) } };
    }
    throw err;
  }
}

function removeBattery(bat){
  cancelReconnect(bat);
  bat.device.removeEventListener('gattserverdisconnected', onGattDisconnected);
  const idx = batteries.indexOf(bat);
  if (idx >= 0){ batteries.splice(idx, 1); allSession = createSession(); }
  if (selectedId === bat.id || (selectedId === ALL && batteries.length < 2)) selectedId = batteries.length > 1 ? ALL : (batteries[0]?.id ?? null);
  scheduleRender();
}

async function disconnectBattery(bat){
  bat.userDisconnect = true;
  cancelReconnect(bat);
  const d = bat.driver;
  bat.driver = null; bat.connected = false;
  if (d){ try{ await d.stop(); }catch{} }
  try{ if (bat.device.gatt?.connected) bat.device.gatt.disconnect(); }catch{}
  forgetDevice(bat.id);
  removeBattery(bat);
  globalStatus = { key:'status.disconnected', tone:'idle', params:null };
}

/* ================= DOM refs ================= */
const statusBar = $('#statusBar');
const connChip = $('#connChip');
const btnBtEl = $('#btn-bt');
const btnBtLabel = $('#btnBtLabel');
const batBar = $('#batBar');
const metricsCard = $('#metricsCard');
const rawInfo = $('#rawInfo');
const hud = {
  power: $('#powerVal'), volt: $('#voltVal'), amp: $('#ampVal'),
  soc: $('#socVal'), socGauge: $('#socGauge'), socArc: $('#socArc'),
  flow: $('#flowState'), flowIcon: $('#flowIcon'), flowText: $('#flowText'),
  capRem: $('#capRemVal'), capFull: $('#capFullSub'),
  eta: $('#etaVal'), etaLabel: $('#etaLabel'),
  delta: $('#deltaVal'), deltaSub: $('#deltaSub'), deltaTile: $('#deltaTile'),
  temps: $('#tempsVal'), tempsSub: $('#tempsSub'), tempTile: $('#tempTile'),
  cycles: $('#cyclesVal'), cyclesSub: $('#cyclesSub'),
  bal: $('#balancingPill'), balText: $('#balancingText'),
  errors: $('#errorsPill'), errorsText: $('#errorsText'),
};
const det = { name: $('#detName'), kind: $('#detKind'), model: $('#detModel'), cap: $('#detCap'), fresh: $('#detFresh'), disconnect: $('#btn-disconnect') };
const wakeLockChk = $('#wakeLock');

/* ================= Tabs ================= */
const TABS = ['cells','chart','session','details'];
const tabBtns = Object.fromEntries(TABS.map(n=>[n, $(`#tab-${n}-btn`)]));
const tabPanels = Object.fromEntries(TABS.map(n=>[n, $(`#tab-${n}`)]));
let activeTab = 'cells';
function setTab(name){
  activeTab = TABS.includes(name) ? name : 'cells';
  for (const n of TABS){
    const on = n === activeTab;
    tabBtns[n].classList.toggle('active', on);
    tabBtns[n].setAttribute('aria-selected', String(on));
    tabPanels[n].classList.toggle('active', on);
  }
  storageSet(STORAGE_KEYS.tab, activeTab);
  if (activeTab === 'chart') requestAnimationFrame(chart.resize); // why: скрытый canvas имеет размер 0x0
  render();
}
for (const n of TABS) tabBtns[n].addEventListener('click', ()=>setTab(n));

/* ================= Chart ================= */
const chart = createChart($('#chart'), $('#chartWrap'), $('#chartNow'), viewPoints);
const chartMetricBtns = [...document.querySelectorAll('#chartMetric button')];
function setChartMetric(m){
  chart.setMetric(m);
  for (const b of chartMetricBtns) b.setAttribute('aria-pressed', String(b.dataset.metric === chart.metric));
  storageSet(STORAGE_KEYS.metric, chart.metric);
}
for (const b of chartMetricBtns) b.addEventListener('click', ()=>setChartMetric(b.dataset.metric));

/* ================= Formatting ================= */
function formatEtaHours(hrs){
  if (!isNum(hrs) || hrs<0) return '—';
  const uh = t('unit.h'), um = t('unit.m');
  if (hrs===0) return `0 ${um}`;
  const h = Math.floor(hrs);
  const m = Math.floor((hrs - h) * 60);
  if (h>=100) return `${h} ${uh}`;
  return h ? `${h} ${uh} ${m} ${um}` : `${m} ${um}`;
}
function formatDuration(ms){
  const s = Math.max(0, Math.floor(ms/1000));
  if (s < 60) return `${s} ${t('unit.s')}`;
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
  return h ? `${h} ${t('unit.h')} ${String(m).padStart(2,'0')} ${t('unit.m')}` : `${m} ${t('unit.m')}`;
}
function formatAh(ah){ return `${ah.toFixed(Math.abs(ah) < 1 ? 3 : 2)} Ah`; }
function formatWh(wh){ const a = Math.abs(wh); return a >= 1000 ? `${(wh/1000).toFixed(2)} kWh` : `${wh.toFixed(a < 10 ? 1 : 0)} Wh`; }
function agoText(ts, now){
  if (!ts) return '—';
  const s = Math.max(0, (now - ts)/1000);
  if (s < 1.5) return t('ago.now');
  if (s < 60) return t('ago.s', {n:Math.floor(s)});
  if (s < 3600) return t('ago.min', {n:Math.floor(s/60)});
  return t('ago.h', {n:Math.floor(s/3600)});
}

/* ================= Cells grid ================= */
const cellsSimple = $('#cellsSimple');
const cellsEmpty = $('#cellsEmpty');
const cellsSummary = $('#cellsSummary');
const overviewEl = $('#overview');
const simpleSlots = [];
(function buildCellsSimple(){
  for (let i=0;i<MAX_CELLS;i++){
    const card = document.createElement('div'); card.className='cell-card'; card.hidden = true;
    const top = document.createElement('div'); top.className='cell-top';
    const idx = document.createElement('div'); idx.className='cell-idx'; idx.textContent = `#${String(i+1).padStart(2,'0')}`;
    const flag = document.createElement('div'); flag.className='cell-flag';
    top.append(idx, flag);
    const val = document.createElement('div'); val.className='cell-val num'; val.textContent='—';
    const bar = document.createElement('div'); bar.className='cell-bar';
    const fill = document.createElement('div'); fill.className='cell-fill'; bar.appendChild(fill);
    card.append(top, val, bar);
    cellsSimple.appendChild(card);
    simpleSlots.push({cardEl:card, valEl:val, fillEl:fill, flagEl:flag});
  }
})();

/* Cells updater (0 V = нет ячейки, скрываем) */
function renderCells(s){
  const volts = s.cells;
  const [minMv, maxMv] = getCellScaleMv(s);
  const finite = activeCells(s);
  const n = finite.length;
  const min = n ? Math.min(...finite) : NaN;
  const max = n ? Math.max(...finite) : NaN;
  const sum = finite.reduce((a,b)=>a+b,0);
  const avg = n ? sum/n : NaN;
  const minIdx = n > 1 && min !== max ? volts.indexOf(min) : -1;
  const maxIdx = n > 1 && min !== max ? volts.indexOf(max) : -1;
  cellsEmpty.hidden = n > 0;
  cellsSummary.hidden = n === 0;
  cellsSimple.hidden = false;
  $('#cellMin').textContent = n ? `${min.toFixed(3)} V` : '—';
  $('#cellAvg').textContent = n ? `${avg.toFixed(3)} V` : '—';
  $('#cellMax').textContent = n ? `${max.toFixed(3)} V` : '—';
  $('#cellSum').textContent = n ? `${sum.toFixed(2)} V` : '—';

  for (let i=0;i<MAX_CELLS;i++){
    const v = volts[i];
    const slot = simpleSlots[i];
    if (!isNum(v) || v <= 0){ slot.cardEl.hidden = true; continue; }
    slot.cardEl.hidden = false;
    slot.valEl.innerHTML = `${v.toFixed(3)}<small>V</small>`;
    const perc = clamp(Math.round(map(v*1000, minMv, maxMv, 0, 100)), 0, 100);
    slot.fillEl.style.width = perc + '%';
    const isLow = i === minIdx && avg - v > 0.040;
    const isHigh = i === maxIdx && v - avg > 0.040;
    slot.cardEl.classList.toggle('is-min', i === minIdx);
    slot.cardEl.classList.toggle('is-max', i === maxIdx);
    slot.flagEl.className = 'cell-flag' + (isLow ? ' flag-min' : isHigh ? ' flag-max' : '');
    slot.flagEl.textContent = isLow ? 'LOW' : isHigh ? 'HIGH' : '';
  }
}

/* ================= Overview (all batteries) ================= */
const overviewCards = new Map(); // why: обновляем на месте, чтобы клик не терялся при перерисовке
function renderOverview(){
  cellsEmpty.hidden = true; cellsSummary.hidden = true; cellsSimple.hidden = true;
  overviewEl.hidden = false;
  for (const [id, el] of overviewCards) if (!findBattery(id)){ el.remove(); overviewCards.delete(id); }
  for (const bat of batteries){
    let el = overviewCards.get(bat.id);
    if (!el){
      el = document.createElement('button');
      el.className = 'bat-card';
      el.innerHTML = `<div class="bat-card-head"><span class="dot"></span><span class="bat-card-name"></span><span class="bat-card-kind"></span></div>
        <div class="bat-card-soc"><b class="soc"></b><div class="bat-card-bar"><i></i></div></div>
        <div class="bat-card-grid"><div>V<b class="v"></b></div><div>A<b class="a"></b></div><div>W<b class="w"></b></div>
        <div>Δ mV<b class="d"></b></div><div>°C<b class="tc"></b></div><div>Ah<b class="sc"></b></div></div>`;
      el.addEventListener('click', ()=> select(bat.id));
      overviewCards.set(bat.id, el);
    }
    overviewEl.appendChild(el); // keeps list order = battery order
    const s = bat.state;
    el.dataset.tone = bat.status.tone || 'idle';
    el.querySelector('.bat-card-name').textContent = devName(bat.device);
    // why: статус показываем вместо протокола — в сетке значений длинный «немає зв’язку» не помещается
    el.querySelector('.bat-card-kind').textContent = bat.connected ? (bat.driver?.kind || '') : bat.busy ? t('ov.connecting') : t('ov.offline');
    el.querySelector('.bat-card-name').title = devName(bat.device);
    el.querySelector('.soc').textContent = isNum(s.soc) ? `${s.soc.toFixed(0)}%` : '—';
    el.querySelector('.bat-card-bar i').style.width = `${isNum(s.soc) ? clamp(s.soc,0,100) : 0}%`;
    el.querySelector('.v').textContent = num(s.totalV, 2);
    el.querySelector('.a').textContent = num(s.current, 2);
    const w = powerW(s);
    el.querySelector('.w').textContent = isNum(w) ? w.toFixed(Math.abs(w)>=100?0:1) : '—';
    const act = activeCells(s);
    el.querySelector('.d').textContent = act.length > 1 ? ((Math.max(...act)-Math.min(...act))*1000).toFixed(0) : '—';
    el.querySelector('.tc').textContent = num(maxTemp(s), 1);
    el.querySelector('.sc').textContent = num(s.capRem, 1);
  }
}

/* ================= Battery switcher ================= */
const batChips = new Map();
function makeChip(id){
  const el = document.createElement('button');
  el.className = 'bat-chip';
  el.innerHTML = '<span class="dot"></span><span class="name"></span><span class="soc"></span>';
  el.addEventListener('click', ()=> select(id));
  batChips.set(id, el);
  return el;
}
function renderBatBar(v){
  batBar.hidden = batteries.length < 2;
  if (batBar.hidden) return;
  const ids = [ALL, ...batteries.map(b=>b.id)];
  for (const [id, el] of batChips) if (!ids.includes(id)){ el.remove(); batChips.delete(id); }
  const agg = aggregateStates(batteries.map(b=>b.state));
  for (const id of ids){
    const el = batChips.get(id) || makeChip(id);
    batBar.appendChild(el);
    const bat = id === ALL ? null : findBattery(id);
    const soc = bat ? bat.state.soc : agg.soc;
    el.dataset.tone = bat ? (bat.status.tone || 'idle') : headerStatus(v.all ? v : {all:true}).tone;
    el.classList.toggle('active', bat ? v.bat === bat : !!v.all);
    el.querySelector('.name').textContent = bat ? devName(bat.device) : `${t('bat.all')} · ${batteries.length}`;
    el.querySelector('.soc').textContent = isNum(soc) ? `${soc.toFixed(0)}%` : '';
  }
}

/* ================= Header ================= */
function headerStatus(v){
  if (v.bat) return v.bat.status;
  if (v.all){
    const total = batteries.length, n = batteries.filter(b=>b.connected).length;
    return { key:'status.multi', params:{ n, total }, tone: n === total ? 'ok' : n ? 'warn' : 'error' };
  }
  return globalStatus;
}
function renderHeader(v){
  const st = headerStatus(v);
  const text = t(st.key, st.params);
  statusBar.textContent = text;
  statusBar.title = text;
  connChip.dataset.tone = st.tone || 'idle';
  btnBtLabel.textContent = batteries.length ? t('btn.add') : t('btn.connect');
  btnBtEl.classList.toggle('btn-primary', !batteries.length);
}

/* ================= HUD ================= */
function renderHud(s){
  const v=s.totalV, i=s.current, w=powerW(s);
  hud.power.textContent = isNum(w) ? Math.abs(w).toFixed(Math.abs(w)>=100?0:1) : '—';
  hud.volt.textContent  = num(v, 2);
  hud.amp.textContent   = num(i, 2);
  hud.capRem.textContent= num(s.capRem, 2);
  const full = estimateFullCapacityAh(s);
  hud.capFull.textContent = isNum(full) ? t('tile.capOf', {cap:full.toFixed(full>=100?0:1)}) + (isNum(s.capFull)?'':' '+t('cap.estimate')) : ' ';

  // SOC gauge
  const soc = s.soc;
  hud.soc.textContent = num(soc, 0);
  const sv = isNum(soc) ? clamp(soc, 0, 100) : 0;
  hud.socArc.style.strokeDashoffset = String(SOC_ARC_LEN * (1 - sv/100));
  hud.socGauge.dataset.level = !isNum(soc) ? 'none' : soc < 20 ? 'low' : soc < 40 ? 'mid' : 'high';
  hud.socGauge.setAttribute('aria-label', isNum(soc) ? t('gauge.aria', {soc:soc.toFixed(0)}) : t('gauge.ariaUnknown'));

  // flow + ETA
  const eta = estimateEta(s);
  const flow = eta.mode ?? (isNum(i) ? (i > CHG.IDLE_A ? 'charge' : i < -CHG.IDLE_A ? 'discharge' : 'idle') : 'none');
  hud.flow.dataset.flow = flow;
  hud.flowIcon.setAttribute('href', flow==='charge' ? '#i-bolt' : flow==='discharge' ? '#i-down' : '#i-pause');
  hud.flowText.textContent = t('flow.' + flow);
  hud.etaLabel.textContent = t(eta.mode==='discharge' ? 'eta.discharge' : eta.mode==='charge' ? 'eta.charge' : 'eta.none');
  hud.eta.textContent = eta.mode==='idle' ? t('eta.idle')
    : eta.mode==='charge' && !isNum(eta.hours) ? t('eta.charging')
    : formatEtaHours(eta.hours);

  // cells delta (in the "All" view: the worst battery)
  const act = activeCells(s);
  if (act.length > 1){
    const mn = Math.min(...act), mx = Math.max(...act), d = (mx-mn)*1000;
    hud.delta.textContent = d.toFixed(0);
    hud.deltaSub.textContent = `#${s.cells.indexOf(mn)+1} ↓ · #${s.cells.indexOf(mx)+1} ↑`;
    hud.deltaTile.classList.toggle('warn', d >= 50);
  } else if (s === EMPTY_STATE || s.cells.length || !batteries.length){
    hud.delta.textContent = '—'; hud.deltaSub.textContent = ' '; hud.deltaTile.classList.remove('warn');
  } else {
    let worst = null, wd = -1;
    for (const b of batteries){ const a = activeCells(b.state); if (a.length > 1){ const d = (Math.max(...a)-Math.min(...a))*1000; if (d > wd){ wd = d; worst = b; } } }
    hud.delta.textContent = worst ? wd.toFixed(0) : '—';
    hud.deltaSub.textContent = worst ? devName(worst.device) : ' ';
    hud.deltaSub.title = worst ? devName(worst.device) : '';
    hud.deltaTile.classList.toggle('warn', wd >= 50);
  }

  // temperatures
  const t1 = s.temp1, t2 = s.temp2, tm = s.tmos;
  const mt = maxTemp(s);
  hud.temps.textContent = num(mt, 1);
  const parts = [];
  if (isNum(t1)) parts.push(`T1 ${t1.toFixed(1)}`);
  if (isNum(t2)) parts.push(`T2 ${t2.toFixed(1)}`);
  if (isNum(tm)) parts.push(`MOS ${tm.toFixed(1)}`);
  hud.tempsSub.textContent = parts.length ? parts.join(' · ') : ' ';
  hud.tempTile.classList.toggle('warn', [t1, t2, tm].some(x=>isNum(x) && (x>=55 || x<=0)));

  // cycles
  hud.cycles.textContent = isNum(s.cycles) ? String(s.cycles) : '—';
  hud.cyclesSub.textContent = isNum(s.cycles) && isNum(full) ? t('cycles.total', {ah:(s.cycles*full).toFixed(0)}) : ' ';

  // chips
  const bal = !!s.balancing;
  hud.balText.textContent = t(bal ? 'chip.balOn' : 'chip.balOff');
  hud.bal.className = 'chip' + (bal ? ' on':'');
  const err = (s.errors||'').trim();
  const bad = !!err && err.toUpperCase()!=='OK';
  hud.errorsText.textContent = bad ? err : t('chip.noErrors');
  hud.errors.className = 'chip ' + (bad ? 'err':'ok');
}

/* ================= Session ================= */
const ses = {
  empty: $('#sessionEmpty'), body: $('#sessionBody'), since: $('#sesSince'), note: $('#sesNote'),
  ahIn: $('#sesAhIn'), whIn: $('#sesWhIn'), ahOut: $('#sesAhOut'), whOut: $('#sesWhOut'), ahNet: $('#sesAhNet'), whNet: $('#sesWhNet'),
  duration: $('#sesDuration'), peakChg: $('#sesPeakChg'), peakDis: $('#sesPeakDis'), packV: $('#sesPackV'),
  soc: $('#sesSoc'), cellV: $('#sesCellV'), delta: $('#sesDelta'), tMax: $('#sesTMax'),
};
/* "All" view: energy is the exact sum of per-battery counters; peaks/voltage/SOC come from the
   sampled aggregate; cell extremes are the worst across batteries. */
function combinedSession(){
  const list = batteries.map(b => b.session);
  const c = { ...allSession };
  c.start = Math.min(allSession.start, ...list.map(s => s.start));
  for (const k of ['ahIn','ahOut','whIn','whOut']) c[k] = list.reduce((a, s) => a + s[k], 0);
  c.samples = list.reduce((a, s) => a + s.samples, 0);
  const finiteMax = (k) => { const v = list.map(s => s[k]).filter(isNum); return v.length ? Math.max(...v) : NaN; };
  c.tMax = finiteMax('tMax'); c.deltaMaxMv = finiteMax('deltaMaxMv');
  c.cellMin = NaN; c.cellMax = NaN;
  batteries.forEach(b => {
    const s = b.session, name = devName(b.device);
    if (isNum(s.cellMin) && !(s.cellMin >= c.cellMin)){ c.cellMin = s.cellMin; c.cellMinLabel = `${name} #${s.cellMinIdx+1}`; }
    if (isNum(s.cellMax) && !(s.cellMax <= c.cellMax)){ c.cellMax = s.cellMax; c.cellMaxLabel = `${name} #${s.cellMaxIdx+1}`; }
  });
  return c;
}
function renderSession(v){
  const s = v.bat ? v.bat.session : v.all ? combinedSession() : null;
  const has = !!s; // why: после сброса показываем нули, а не заглушку
  ses.empty.hidden = has; ses.body.hidden = !has;
  if (!has) return;
  ses.note.hidden = !v.all;
  ses.since.textContent = t('ses.since', { time: hhmmss(s.start) });
  ses.ahIn.textContent = formatAh(s.ahIn); ses.whIn.textContent = formatWh(s.whIn);
  ses.ahOut.textContent = formatAh(s.ahOut); ses.whOut.textContent = formatWh(s.whOut);
  const netAh = s.ahIn - s.ahOut, netWh = s.whIn - s.whOut;
  ses.ahNet.textContent = (netAh >= 0 ? '+' : '−') + formatAh(Math.abs(netAh));
  ses.whNet.textContent = (netWh >= 0 ? '+' : '−') + formatWh(Math.abs(netWh));
  ses.duration.textContent = formatDuration(Date.now() - s.start);
  ses.peakChg.textContent = s.peakChgA > 0 ? `${s.peakChgW.toFixed(0)} W · ${s.peakChgA.toFixed(1)} A` : '—';
  ses.peakDis.textContent = s.peakDisA > 0 ? `${s.peakDisW.toFixed(0)} W · ${s.peakDisA.toFixed(1)} A` : '—';
  ses.packV.textContent = isNum(s.vMin) ? `${s.vMin.toFixed(2)} / ${s.vMax.toFixed(2)} V` : '—';
  ses.soc.textContent = isNum(s.socStart) ? `${s.socStart.toFixed(0)}% → ${s.socNow.toFixed(0)}%` : '—';
  const minLabel = s.cellMinLabel ?? `#${s.cellMinIdx+1}`, maxLabel = s.cellMaxLabel ?? `#${s.cellMaxIdx+1}`;
  ses.cellV.textContent = isNum(s.cellMin) ? `${s.cellMin.toFixed(3)} V (${minLabel}) / ${s.cellMax.toFixed(3)} V (${maxLabel})` : '—';
  ses.delta.textContent = isNum(s.deltaMaxMv) ? `${s.deltaMaxMv.toFixed(0)} mV` : '—';
  ses.tMax.textContent = isNum(s.tMax) ? `${s.tMax.toFixed(1)} °C` : '—';
}
$('#sesReset').addEventListener('click', ()=>{
  const v = currentView(), now = Date.now();
  if (v.bat) v.bat.session = createSession(now);
  else if (v.all){ for (const b of batteries) b.session = createSession(now); allSession = createSession(now); }
  render();
});

/* ================= Details ================= */
function renderDetails(v){
  const now = Date.now();
  if (v.bat){
    const b = v.bat, s = b.state, full = estimateFullCapacityAh(s);
    det.name.textContent = devName(b.device);
    det.kind.textContent = b.driver ? b.driver.kind : '—';
    det.model.textContent = s.model || '—';
    det.cap.textContent = isNum(full) ? `${full.toFixed(1)} Ah` + (isNum(s.capFull)?'':' '+t('cap.estimate')) : '—';
    det.fresh.textContent = s.lastSummaryTs ? t('det.fresh', {pack:agoText(s.lastSummaryTs, now), cells:agoText(s.lastCellsTs, now)}) : '—';
    det.disconnect.hidden = false;
    det.disconnect.textContent = t('btn.disconnect');
    rawInfo.textContent = compileBatInfo(b);
  } else if (v.all){
    const agg = aggregateView();
    det.name.textContent = t('det.allName', { n: batteries.length });
    det.kind.textContent = [...new Set(batteries.map(b=>b.driver?.kind).filter(Boolean))].join(', ') || '—';
    det.model.textContent = '—';
    det.cap.textContent = isNum(agg.capFull) ? `${agg.capFull.toFixed(1)} Ah` : '—';
    det.fresh.textContent = agg.lastSummaryTs ? t('det.fresh', {pack:agoText(agg.lastSummaryTs, now), cells:agoText(agg.lastCellsTs, now)}) : '—';
    det.disconnect.hidden = false;
    det.disconnect.textContent = t('det.disconnectAll');
    rawInfo.textContent = batteries.map(compileBatInfo).join('\n\n');
  } else {
    det.name.textContent = '—'; det.kind.textContent = t('det.notConnected'); det.model.textContent = '—';
    det.cap.textContent = '—'; det.fresh.textContent = '—';
    det.disconnect.hidden = true;
    rawInfo.textContent = compileBatInfo(null);
  }
}
det.disconnect.addEventListener('click', async ()=>{
  const v = currentView();
  const list = v.bat ? [v.bat] : v.all ? batteries.slice() : [];
  for (const b of list) await disconnectBattery(b);
});
$('#copyRaw').addEventListener('click', async (e)=>{
  const b = e.currentTarget;
  try{ await navigator.clipboard.writeText(rawInfo.textContent); b.textContent = t('det.copied'); }
  catch{ b.textContent = t('det.copyFailed'); }
  setTimeout(()=>{ b.textContent = t('det.copy'); }, 1500);
});

function compileBatInfo(bat){
  const s = bat ? bat.state : EMPTY_STATE;
  const v=s.totalV, i=s.current, w=powerW(s);
  const lines=[];
  if (bat) lines.push(`Device: ${devName(bat.device)}${bat.driver?` (${bat.driver.kind})`:''}${s.model?` · ${s.model}`:''}`);
  lines.push(`Pack: ${fmt(v,'V',3)} ${fmt(i,'A',3)} ${fmt(w,'W',1)}`);
  const meta=[];
  if (isNum(s.soc)) meta.push(`SOC ${s.soc.toFixed(0)}%`);
  meta.push(`Balancing ${s.balancing?'ON':'OFF'}`);
  if (isNum(s.capRem)) meta.push(`${s.capRem.toFixed(2)} Ah`);
  const eta = estimateEta(s);
  if (eta.mode==='discharge') meta.push(`ETA ${formatEtaHours(eta.hours)}`);
  else if (eta.mode==='charge') meta.push(`ETA ${isNum(eta.hours)?formatEtaHours(eta.hours):'charge'}`);
  else if (eta.mode==='idle') meta.push('ETA stop');
  const Cn = estimateFullCapacityAh(s);
  if (isNum(Cn)) meta.push(`C${isNum(s.capFull)?'=':'≈'}${Cn.toFixed(1)}Ah`);
  if (isNum(s.cycles)) meta.push(`Cycles ${s.cycles}`);
  lines.push(meta.join(' · '));
  if (isNum(s.temp1)||isNum(s.temp2)||isNum(s.tmos)) lines.push(`Temps: ${fmt(s.temp1,'°C',1)} ${fmt(s.temp2,'°C',1)} MOS ${fmt(s.tmos,'°C',1)}`);
  if (s.errors && s.errors.toUpperCase()!=='OK') lines.push(`Errors: ${s.errors}`);
  const act=activeCells(s);
  if (act.length){
    const sum=act.reduce((a,b)=>a+b,0), min=Math.min(...act), max=Math.max(...act);
    const deltaMv=(max-min)*1000, diffMv=isNum(v)? (v-sum)*1000 : NaN;
    const [minMv,maxMv]=getCellScaleMv(s);
    lines.push(`Cells: ${act.length} · Σ=${fmt(sum,'V',3)} · Min/Max=${min.toFixed(3)}/${max.toFixed(3)} V · Δ=${deltaMv.toFixed(1)} mV`);
    lines.push(`Cell V: ${act.map(x=>x.toFixed(3)).join(' ')}`);
    if (isNum(diffMv)) lines.push(`Pack − Σcells = ${diffMv.toFixed(1)} mV`);
    lines.push(`Scale: ${(minMv/1000).toFixed(3)}–${(maxMv/1000).toFixed(3)} V`);
  } else lines.push('Cells: –');
  const now=Date.now();
  lines.push(`Freshness: cells ${ago(s.lastCellsTs, now)}, pack ${ago(s.lastSummaryTs, now)}`);
  return lines.join('\n');
}

/* ================= Render ================= */
let renderQueued = false;
function scheduleRender(){
  if (renderQueued) return;
  renderQueued = true;
  // why: rAF не срабатывает во фоновой вкладке; setTimeout-фолбэк держит данные в актуальном виде
  const run = ()=>{ if (!renderQueued) return; renderQueued = false; render(); };
  requestAnimationFrame(run);
  setTimeout(run, 250);
}
function render(){
  const v = currentView();
  const s = viewState(v);
  renderHeader(v);
  renderBatBar(v);
  renderHud(s);
  if (v.all) renderOverview();
  else { overviewEl.hidden = true; renderCells(s); }
  if (activeTab === 'chart') chart.draw();
  if (activeTab === 'session') renderSession(v);
  if (activeTab === 'details') renderDetails(v);
}

/* ================= Screen Wake Lock ================= */
let wakeLock = null;
async function syncWakeLock(){
  if (!('wakeLock' in navigator)) return;
  try{
    if (wakeLockChk.checked && document.visibilityState==='visible' && !wakeLock){
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', ()=>{ wakeLock = null; });
    } else if (!wakeLockChk.checked && wakeLock){
      await wakeLock.release(); wakeLock = null;
    }
  }catch(e){ console.warn('wakeLock', e); }
}
if ('wakeLock' in navigator){
  $('#wakeLockSw').hidden = false;
  wakeLockChk.checked = storageGet(STORAGE_KEYS.wakeLock, '0') === '1';
  wakeLockChk.addEventListener('change', ()=>{ storageSet(STORAGE_KEYS.wakeLock, wakeLockChk.checked?'1':'0'); syncWakeLock(); });
  document.addEventListener('visibilitychange', syncWakeLock);
}

/* ================= Picker ================= */
const dlg = $('#dlg-picker');
const recentList = $('#recent-list');
const pickerStatus = $('#picker-status');

function openPicker(msg){
  pickerStatus.textContent = msg || '';
  recentList.hidden = true;
  if (!dlg.open) dlg.showModal();
}
btnBtEl.addEventListener('click', ()=> openPicker());
$('#cellsConnect').addEventListener('click', ()=> openPicker());
$('#btn-close-picker').addEventListener('click', ()=> dlg.close());

async function connectFromPicker(device, advertise){
  pickerStatus.textContent = t('status.connecting', {name:devName(device)});
  try{
    await addBattery(device, {advertise});
    dlg.close();
  }catch(err){
    pickerStatus.textContent = t('picker.failed', {msg:connectErrMsg(err)});
  }
}

$('#btn-reconnect').addEventListener('click', async ()=>{
  if (!('bluetooth' in navigator) || typeof navigator.bluetooth.getDevices !== 'function'){
    pickerStatus.textContent = t('picker.noRecentSupport'); return;
  }
  let list = [];
  try{ list = await navigator.bluetooth.getDevices(); }
  catch(err){ pickerStatus.textContent = t('status.error', {msg:errMsg(err)}); return; }
  recentList.replaceChildren();
  recentList.hidden = false;
  if (!list.length){ const e = document.createElement('div'); e.className = 'recent-empty'; e.textContent = t('picker.noRecent'); recentList.appendChild(e); return; }
  for (const dev of list){
    // why: имя BLE-устройства задаёт кто угодно поблизости — только textContent, без innerHTML
    const item = document.createElement('div'); item.className = 'recent-item';
    const info = document.createElement('div');
    info.append(document.createTextNode(dev.name || t('picker.unnamed')));
    const id = document.createElement('span'); id.className = 'id'; id.textContent = dev.id;
    info.append(id);
    const btn = document.createElement('button'); btn.className = 'btn btn-sm'; btn.textContent = t('btn.connect');
    btn.disabled = !!findBattery(dev.id)?.connected;
    btn.addEventListener('click', ()=> connectFromPicker(dev, true));
    item.append(info, btn);
    recentList.appendChild(item);
  }
});

$('#btn-choose').addEventListener('click', async ()=>{
  let device;
  try{
    pickerStatus.textContent = t('picker.opening');
    device = await navigator.bluetooth.requestDevice({
      filters:[{services:[UUID.JK_SVC]},{services:[UUID.JBD_SVC]}],
      optionalServices:[UUID.JK_SVC,UUID.JBD_SVC]
    });
  }catch(err){
    pickerStatus.textContent = err?.name==='NotFoundError' ? t('picker.cancelled')
      : err?.name==='SecurityError' ? t('picker.needClick')
      : t('status.error', {msg:errMsg(err)});
    return;
  }
  await connectFromPicker(device, false);
});

/* ================= Auto-connect ================= */
/* Reconnects every remembered BMS; with no list stored yet falls back to the first granted device. */
async function autoConnectOnLoad(){
  if (!('bluetooth' in navigator)) return;
  let available = true;
  try{ if (typeof navigator.bluetooth.getAvailability === 'function') available = await navigator.bluetooth.getAvailability(); }catch{}
  if (!available){ globalStatus = { key:'status.btOff', tone:'error', params:null }; render(); return; }
  if (typeof navigator.bluetooth.getDevices === 'function'){
    try{
      const granted = await navigator.bluetooth.getDevices();
      const ids = rememberedIds();
      const devs = ids === null ? granted.slice(0, 1) : granted.filter(d => ids.includes(d.id));
      if (devs.length){
        const failures = [];
        for (const dev of devs){
          try{ await addBattery(dev, {advertise:true}); }
          catch(err){ failures.push(t('picker.autoFailed', {name:devName(dev), msg:connectErrMsg(err)})); }
        }
        if (batteries.length > 1) select(ALL);
        if (!batteries.length) openPicker(failures.join('\n'));
        return;
      }
    }catch(e){ console.warn('autoConnectOnLoad (granted) failed:', e); }
  }
  openPicker(t('picker.hint'));
}

/* ================= Language ================= */
const langSelect = $('#langSelect');
function applyLanguage(){
  applyStaticI18n();
  langSelect.options[0].textContent = t('det.langAuto', {lang: LANG_NAMES[detectLang()]});
  langSelect.value = getLangPref();
  overviewCards.clear(); overviewEl.replaceChildren(); // rebuilt with translated labels
  render();
}
langSelect.addEventListener('change', ()=>{ setLangPref(langSelect.value); applyLanguage(); });
window.addEventListener('languagechange', ()=>{ refreshAutoLang(); applyLanguage(); });

/* ================= Init ================= */
applyLanguage();
setChartMetric(METRICS[storageGet(STORAGE_KEYS.metric, 'w')] ? storageGet(STORAGE_KEYS.metric, 'w') : 'w');
setTab(storageGet(STORAGE_KEYS.tab, 'cells'));
requestAnimationFrame(chart.resize);
initOffline();

setInterval(()=>{
  sampleAggregate();
  const v = currentView(), s = viewState(v), now = Date.now();
  const connected = v.bat ? v.bat.connected : batteries.some(b=>b.connected);
  const stale = s.lastSummaryTs && (!connected || now - s.lastSummaryTs > STALE_AFTER_MS);
  metricsCard.classList.toggle('stale', !!stale);
  if (v.all || activeTab === 'session' || activeTab === 'details') render();
}, 1000);

if (!('bluetooth' in navigator)){
  btnBtEl.setAttribute('disabled','');
  $('#cellsConnect').setAttribute('disabled','');
  globalStatus = { key: window.isSecureContext ? 'status.unsupported' : 'status.needHttps', tone:'error', params:null };
  render();
} else if (document.readyState === 'complete'){
  autoConnectOnLoad().catch(()=>{});
} else {
  window.addEventListener('load', ()=>{ autoConnectOnLoad().catch(()=>{}); });
}
