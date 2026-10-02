/* Log records and file formats (CSV / JSON), plus chart downsampling. Pure functions, unit-tested in Node.
   A record: { t (ms), dev (device id), name, v, i, soc, rem, full, t1, t2, tm, bal (0/1), err, cells: [mV] }.
   Missing numbers are null. */
const isNum = Number.isFinite;
const num = (x) => isNum(x) ? x : null;
const round = (x, d) => isNum(x) ? Math.round(x * 10 ** d) / 10 ** d : null;

export const LOG_FORMAT = 'web-bms-log';

/* Builds a record from a battery state (see model.js). */
export function makeRecord(state, dev, name, t){
  return {
    t, dev, name,
    v: round(state.totalV, 3), i: round(state.current, 3), soc: num(state.soc),
    rem: round(state.capRem, 3), full: round(state.capFull, 3),
    t1: round(state.temp1, 1), t2: round(state.temp2, 1), tm: round(state.tmos, 1),
    bal: state.balancing ? 1 : 0,
    err: state.errors && state.errors.toUpperCase() !== 'OK' ? state.errors : '',
    cells: (state.cells || []).filter(v => isNum(v) && v > 0).map(v => Math.round(v * 1000)),
  };
}

/* Derived values used by the chart and table. */
export function recordPoint(r){
  const cells = r.cells || [];
  const temps = [r.t1, r.t2].filter(isNum);
  return {
    t: r.t,
    v: num(r.v), i: num(r.i), soc: num(r.soc),
    w: isNum(r.v) && isNum(r.i) ? r.v * r.i : null,
    d: cells.length > 1 ? Math.max(...cells) - Math.min(...cells) : null,
    tc: temps.length ? Math.max(...temps) : null,
  };
}

export function devicesOf(records){
  const map = new Map();
  for (const r of records) map.set(r.dev, r.name || r.dev);
  return map;
}

/* ---------- CSV ---------- */
const BASE_COLS = ['time','timestamp_ms','device_id','device','voltage_V','current_A','power_W','soc_pct','remaining_Ah','full_Ah',
  'temp1_C','temp2_C','mos_C','balancing','errors','cell_min_V','cell_max_V','delta_mV'];

function pad(n){ return String(n).padStart(2, '0'); }
export function localTime(t){
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function csvField(v){
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(records){
  const maxCells = records.reduce((m, r) => Math.max(m, (r.cells || []).length), 0);
  const cellCols = Array.from({ length: maxCells }, (_, i) => `cell${String(i+1).padStart(2, '0')}_V`);
  const lines = [[...BASE_COLS, ...cellCols].join(',')];
  for (const r of records){
    const cells = r.cells || [];
    const p = recordPoint(r);
    const row = [localTime(r.t), r.t, r.dev, r.name, r.v, r.i, round(p.w, 1), r.soc, r.rem, r.full, r.t1, r.t2, r.tm, r.bal, r.err,
      cells.length ? Math.min(...cells) / 1000 : null, cells.length ? Math.max(...cells) / 1000 : null, p.d,
      ...cellCols.map((_, i) => isNum(cells[i]) ? cells[i] / 1000 : null)];
    lines.push(row.map(csvField).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/* RFC 4180-ish parser: quoted fields, doubled quotes, CRLF / LF. */
export function parseCsvRows(text){
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (q){
      if (c === '"'){ if (text[i+1] === '"'){ field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ','){ row.push(field); field = ''; }
    else if (c === '\n' || c === '\r'){
      if (c === '\r' && text[i+1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length){ row.push(field); rows.push(row); }
  return rows;
}

function fromCsv(text){
  const [head, ...body] = parseCsvRows(text.replace(/^﻿/, ''));
  if (!head || !head.includes('timestamp_ms') || !head.includes('voltage_V')) throw new Error('not a web-bms CSV log');
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  const cellIdx = head.map((h, i) => /^cell\d+_V$/.test(h) ? i : -1).filter(i => i >= 0);
  const f = (row, name) => { const s = row[col[name]]; if (s === undefined || s === '') return null; const v = Number(s); return isNum(v) ? v : null; };
  return body.filter(r => r.length > 1).map(r => ({
    t: f(r, 'timestamp_ms'), dev: r[col.device_id] || r[col.device] || 'device', name: r[col.device] || r[col.device_id] || 'device',
    v: f(r, 'voltage_V'), i: f(r, 'current_A'), soc: f(r, 'soc_pct'), rem: f(r, 'remaining_Ah'), full: f(r, 'full_Ah'),
    t1: f(r, 'temp1_C'), t2: f(r, 'temp2_C'), tm: f(r, 'mos_C'), bal: f(r, 'balancing') ? 1 : 0, err: r[col.errors] || '',
    cells: cellIdx.map(i => Number(r[i])).filter(v => isNum(v) && v > 0).map(v => Math.round(v * 1000)),
  })).filter(r => isNum(r.t));
}

/* ---------- JSON ---------- */
export function toJson(records, exportedAt = Date.now()){
  return JSON.stringify({ format: LOG_FORMAT, version: 1, exported: new Date(exportedAt).toISOString(), records });
}

/* Reads a CSV or JSON log produced by toCsv / toJson. Returns records sorted by time. */
export function parseLogFile(text){
  const trimmed = text.trim();
  let records;
  if (trimmed.startsWith('{')){
    const data = JSON.parse(trimmed);
    if (data.format !== LOG_FORMAT || !Array.isArray(data.records)) throw new Error('not a web-bms JSON log');
    records = data.records.filter(r => r && isNum(r.t)).map(r => ({ ...r, dev: r.dev ?? 'device', name: r.name ?? r.dev ?? 'device', cells: Array.isArray(r.cells) ? r.cells : [] }));
  } else records = fromCsv(trimmed);
  if (!records.length) throw new Error('the file has no records');
  return records.sort((a, b) => a.t - b.t);
}

/* ---------- Chart downsampling ---------- */
/* Averages points into at most `max` time buckets. Empty buckets stay empty, so gaps survive.
   Returns { points, bucketMs }. */
export function downsample(points, max = 1200){
  if (points.length <= max) return { points, bucketMs: 0 };
  const t0 = points[0].t, span = points[points.length - 1].t - t0 || 1;
  const bucketMs = span / max;
  const out = []; let cur = null, key = -1;
  const keys = ['v', 'i', 'w', 'soc', 'd', 'tc'];
  const flush = () => {
    if (!cur) return;
    const p = { t: Math.round(cur.t / cur.n) };
    for (const k of keys) p[k] = cur[k + 'n'] ? cur[k] / cur[k + 'n'] : null;
    out.push(p);
  };
  for (const p of points){
    const k = Math.min(max - 1, Math.floor((p.t - t0) / bucketMs));
    if (k !== key){ flush(); key = k; cur = { t: 0, n: 0 }; for (const kk of keys){ cur[kk] = 0; cur[kk + 'n'] = 0; } }
    cur.t += p.t; cur.n++;
    for (const kk of keys) if (isNum(p[kk])){ cur[kk] += p[kk]; cur[kk + 'n']++; }
  }
  flush();
  return { points: out, bucketMs };
}
