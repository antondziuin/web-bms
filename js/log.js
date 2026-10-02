/* BMS data log: records every battery at a fixed interval into IndexedDB, shows the history on the
   page (chart + table), exports CSV / JSON, opens saved log files and optionally captures raw BLE frames. */
import { isNum, storageGet, storageSet, errMsg, hhmmss } from './util.js';
import { t } from './i18n.js';
import { makeRecord, recordPoint, devicesOf, toCsv, toJson, parseLogFile, downsample, localTime } from './logformat.js';
import { logStoreSupported, addRecords, getRecords, pruneRecords, clearRecords } from './logstore.js';
import { createChart, METRICS } from './chart.js';

export const LOG_RETENTION_DAYS = 7;
const RETENTION_MS = LOG_RETENTION_DAYS * 86400000;
const FLUSH_MS = 5000;
const REFRESH_MS = 10000;
const RAW_MAX = 5000;
const PAGE = 50;
const RANGES = { '1h': 3600000, '6h': 6 * 3600000, '24h': 86400000, all: Infinity };
const KEYS = { enabled: 'log:enabled', interval: 'log:interval', range: 'log:range', metric: 'log:metric' };

const $ = sel => document.querySelector(sel);
const p2 = x => String(x).padStart(2, '0');
function shortTime(ts, withDate){
  const d = new Date(ts);
  return (withDate ? `${p2(d.getDate())}.${p2(d.getMonth()+1)} ` : '') + hhmmss(ts);
}
function fileStamp(){
  const d = new Date();
  return `${d.getFullYear()}${p2(d.getMonth()+1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
}
export function download(name, text, type){
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const fmtN = (x, d) => isNum(x) ? x.toFixed(d) : '—';

/* getBatteries(): battery list (id, device, state, lastLogTs); getSelectedId(): battery shown now. */
export function createLog({ getBatteries, getSelectedId }){
  const el = {
    empty: $('#logEmpty'), emptyText: $('#logEmptyText'), body: $('#logBody'), summary: $('#logSummary'),
    device: $('#logDevice'), rows: $('#logRows'), more: $('#logMore'), fileBar: $('#logFileBar'), fileName: $('#logFileName'),
    enabled: $('#logEnabled'), enabledSub: $('#logEnabledSub'), interval: $('#logInterval'),
    raw: $('#rawEnabled'), rawSub: $('#rawSub'), rawDownload: $('#rawDownload'), error: $('#logError'),
    input: $('#logFile'), unsupported: $('#logUnsupported'),
  };
  const rangeBtns = [...document.querySelectorAll('#logRange button')];
  const metricBtns = [...document.querySelectorAll('#logMetric button')];
  const supported = logStoreSupported();

  let enabled = storageGet(KEYS.enabled, '1') === '1';
  let intervalS = Number(storageGet(KEYS.interval, '10')) || 10;
  let rangeKey = RANGES[storageGet(KEYS.range, '6h')] ? storageGet(KEYS.range, '6h') : '6h';
  const queue = [];
  const rawFrames = [];
  let rawEnabled = false;

  const view = { active: false, mode: 'db', fileRecords: [], fileName: '', records: [], dev: null, shown: PAGE, loading: false, timer: null, gapMs: 60000 };
  const chart = createChart($('#logChart'), $('#logChartWrap'), null, () => view.points || [], { gapMs: () => view.gapMs });

  /* ---------- recording ---------- */
  function record(bat, now = Date.now()){
    // why: JBD присылает ячейки отдельным кадром — не пишем запись, пока их ещё нет
    if (!enabled || !supported || !bat.state.lastCellsTs) return;
    if (bat.lastLogTs && now - bat.lastLogTs < intervalS * 1000 - 250) return;
    bat.lastLogTs = now;
    queue.push(makeRecord(bat.state, bat.id, bat.device.name || bat.id, now));
  }
  async function flush(){
    if (!queue.length) return;
    const batch = queue.splice(0);
    try{ await addRecords(batch); }
    catch(err){ console.warn('log write failed', err); showError(errMsg(err)); }
  }
  function raw(bat, kind, bytes){
    if (!rawEnabled) return;
    if (rawFrames.length >= RAW_MAX) rawFrames.shift();
    rawFrames.push({ t: Date.now(), name: bat.device.name || bat.id, kind, hex: Array.from(bytes, b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ') });
  }

  /* ---------- loading ---------- */
  function rangeEnd(){ return view.mode === 'file' ? (view.fileRecords.at(-1)?.t ?? Date.now()) : Date.now(); }
  async function reload(){
    if (view.loading) return;
    view.loading = true;
    try{
      const from = rangeEnd() - RANGES[rangeKey];
      if (view.mode === 'file') view.records = view.fileRecords.filter(r => r.t > from);
      else if (supported){ await flush(); view.records = await getRecords(isFinite(from) ? from : -Infinity); }
      else view.records = [];
    }catch(err){ showError(errMsg(err)); view.records = []; }
    finally{ view.loading = false; }
    renderView();
  }
  function showError(msg){ el.error.hidden = !msg; el.error.textContent = msg ? t('log.fileError', { msg }) : ''; }

  /* ---------- rendering ---------- */
  function renderDevices(devices){
    const ids = [...devices.keys()];
    const preferred = getSelectedId();
    if (!ids.includes(view.dev)) view.dev = ids.includes(preferred) ? preferred : (ids[0] ?? null);
    const sig = ids.join('|') + '#' + [...devices.values()].join('|');
    if (el.device.dataset.sig !== sig){
      el.device.replaceChildren(...ids.map(id => { const o = document.createElement('option'); o.value = id; o.textContent = devices.get(id); return o; }));
      el.device.dataset.sig = sig;
    }
    el.device.value = view.dev ?? '';
    el.device.hidden = ids.length < 2;
  }
  function renderView(){
    const devices = devicesOf(view.records);
    renderDevices(devices);
    const rows = view.records.filter(r => r.dev === view.dev);
    const has = rows.length > 0;
    el.empty.hidden = has; el.body.hidden = !has;
    el.emptyText.textContent = t(view.mode === 'file' || view.records.length ? 'log.emptyRange' : 'log.empty');
    el.fileBar.hidden = view.mode !== 'file';
    el.fileName.textContent = t('log.file', { name: view.fileName });
    for (const b of rangeBtns) b.setAttribute('aria-pressed', String(b.dataset.range === rangeKey));
    if (!has){ el.summary.textContent = ''; view.points = []; chart.draw(); return; }

    const first = rows[0].t, last = rows.at(-1).t, multiDay = last - first > 20 * 3600000 || new Date(first).toDateString() !== new Date(last).toDateString();
    el.summary.textContent = t('log.summary', { n: rows.length, from: shortTime(first, multiDay), to: shortTime(last, multiDay) });

    // chart: averaged into ≤ 1200 points; the gap threshold follows the recording interval
    const step = rows.length > 1 ? medianStep(rows) : intervalS * 1000;
    const ds = downsample(rows.map(recordPoint), 1200);
    view.points = ds.points;
    view.gapMs = Math.max(60000, step * 3, ds.bucketMs * 2.5);
    requestAnimationFrame(chart.resize);

    // table: newest first
    const frag = document.createDocumentFragment();
    for (const r of rows.slice(-view.shown).reverse()){
      const p = recordPoint(r);
      const tr = document.createElement('tr');
      for (const v of [shortTime(r.t, multiDay), fmtN(r.v, 2), fmtN(r.i, 2), fmtN(p.w, Math.abs(p.w) >= 100 ? 0 : 1), fmtN(r.soc, 0), fmtN(p.d, 0), fmtN(p.tc, 1), r.err || '']){
        const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
      }
      if (r.err) tr.className = 'err';
      frag.appendChild(tr);
    }
    el.rows.replaceChildren(frag);
    el.more.hidden = rows.length <= view.shown;
  }
  function medianStep(rows){
    const d = [];
    for (let i = Math.max(1, rows.length - 200); i < rows.length; i++) d.push(rows[i].t - rows[i-1].t);
    d.sort((a, b) => a - b);
    return d[Math.floor(d.length / 2)] || intervalS * 1000;
  }
  function renderSettings(){
    el.enabled.checked = enabled;
    el.enabledSub.textContent = t('log.enabledSub', { days: LOG_RETENTION_DAYS });
    el.interval.value = String(intervalS);
    for (const o of el.interval.options){ const s = Number(o.value); o.textContent = s < 60 ? `${s} ${t('unit.s')}` : `${s / 60} ${t('unit.m')}`; }
    el.raw.checked = rawEnabled;
    el.rawSub.textContent = t('log.rawSub', { n: rawFrames.length });
    el.rawDownload.disabled = !rawFrames.length;
    el.unsupported.hidden = supported;
  }

  /* ---------- events ---------- */
  for (const b of rangeBtns) b.addEventListener('click', () => { rangeKey = b.dataset.range; storageSet(KEYS.range, rangeKey); view.shown = PAGE; reload(); });
  function setMetric(m){
    chart.setMetric(m);
    for (const b of metricBtns) b.setAttribute('aria-pressed', String(b.dataset.metric === chart.metric));
    storageSet(KEYS.metric, chart.metric);
  }
  for (const b of metricBtns) b.addEventListener('click', () => setMetric(b.dataset.metric));
  el.device.addEventListener('change', () => { view.dev = el.device.value; view.shown = PAGE; renderView(); });
  el.more.addEventListener('click', () => { view.shown += PAGE * 4; renderView(); });
  el.enabled.addEventListener('change', () => { enabled = el.enabled.checked; storageSet(KEYS.enabled, enabled ? '1' : '0'); });
  el.interval.addEventListener('change', () => { intervalS = Number(el.interval.value) || 10; storageSet(KEYS.interval, String(intervalS)); });
  el.raw.addEventListener('change', () => { rawEnabled = el.raw.checked; renderSettings(); });
  el.rawDownload.addEventListener('click', () => {
    const lines = rawFrames.map(f => `${localTime(f.t)}.${String(f.t % 1000).padStart(3, '0')}\t${f.name}\t${f.kind}\t${f.hex}`);
    download(`web-bms-frames-${fileStamp()}.txt`, lines.join('\n') + '\n', 'text/plain');
  });
  $('#logCsv').addEventListener('click', () => download(`web-bms-log-${fileStamp()}.csv`, toCsv(view.records), 'text/csv'));
  $('#logJson').addEventListener('click', () => download(`web-bms-log-${fileStamp()}.json`, toJson(view.records), 'application/json'));
  $('#logOpen').addEventListener('click', () => el.input.click());
  el.input.addEventListener('change', async () => {
    const file = el.input.files?.[0];
    el.input.value = '';
    if (!file) return;
    try{
      view.fileRecords = parseLogFile(await file.text());
      view.fileName = file.name;
      view.mode = 'file';
      rangeKey = 'all';
      view.dev = null; view.shown = PAGE;
      showError('');
      await reload();
    }catch(err){ showError(errMsg(err)); }
  });
  $('#logCloseFile').addEventListener('click', () => {
    view.mode = 'db'; view.fileRecords = []; view.dev = null; view.shown = PAGE;
    rangeKey = RANGES[storageGet(KEYS.range, '6h')] ? storageGet(KEYS.range, '6h') : '6h';
    reload();
  });
  $('#logClear').addEventListener('click', async () => {
    if (!confirm(t('log.clearConfirm'))) return;
    queue.length = 0;
    try{ await clearRecords(); }catch(err){ showError(errMsg(err)); }
    for (const b of getBatteries()) b.lastLogTs = 0;
    if (view.mode === 'db') reload();
  });

  /* ---------- lifecycle ---------- */
  setInterval(flush, FLUSH_MS);
  if (supported){
    const prune = () => pruneRecords(Date.now() - RETENTION_MS).catch(err => console.warn('log prune failed', err));
    prune();
    setInterval(prune, 3600000);
  }
  window.addEventListener('pagehide', () => { flush(); });
  setMetric(METRICS[storageGet(KEYS.metric, 'w')] ? storageGet(KEYS.metric, 'w') : 'w');
  renderSettings();

  return {
    record, raw,
    /* The tab became visible / hidden: refresh periodically only while it is shown. */
    setActive(active){
      if (active === view.active) return;
      view.active = active;
      clearInterval(view.timer);
      if (active){ reload(); view.timer = setInterval(() => { if (view.mode === 'db') reload(); renderSettings(); }, REFRESH_MS); }
    },
    tick(){ if (view.active) renderSettings(); },
    applyLanguage(){ renderSettings(); if (view.active) renderView(); },
  };
}
