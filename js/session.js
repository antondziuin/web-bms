/* Session counters: energy in/out (trapezoidal integration of current/power over time),
   peaks and extremes since the session started. Pure functions, unit-tested in Node. */
import { isNum } from './util.js';

/* why: если данных не было дольше, интервал не интегрируем — иначе один старый замер растянется на весь разрыв */
export const SESSION_MAX_GAP_MS = 30000;

export function createSession(now = Date.now()){
  return {
    start: now, lastTs: 0, lastI: NaN, lastW: NaN,
    ahIn: 0, ahOut: 0, whIn: 0, whOut: 0,
    peakChgW: 0, peakDisW: 0, peakChgA: 0, peakDisA: 0,
    vMin: NaN, vMax: NaN,
    cellMin: NaN, cellMinIdx: -1, cellMax: NaN, cellMaxIdx: -1,
    tMax: NaN, deltaMaxMv: NaN,
    socStart: NaN, socNow: NaN,
    samples: 0,
  };
}

/* Feeds one sample: v (V), i (A, + = charge), w (W, defaults to v × i — the aggregate of packs with
   different voltages passes its own sum), soc (%), temps (°C list). */
export function sessionAddSummary(s, {v, i, w = v * i, soc, temps = []}, now = Date.now()){
  const dt = now - s.lastTs;
  const h = dt > 0 && dt <= SESSION_MAX_GAP_MS ? dt / 3600000 : 0;
  if (h && isNum(i) && isNum(s.lastI)){
    const ai = (s.lastI + i) / 2;
    if (ai > 0) s.ahIn += ai * h; else s.ahOut += -ai * h;
  }
  if (h && isNum(w) && isNum(s.lastW)){
    const aw = (s.lastW + w) / 2;
    if (aw > 0) s.whIn += aw * h; else s.whOut += -aw * h;
  }
  if (isNum(i) || isNum(w)){ s.lastTs = now; s.lastI = i; s.lastW = w; }
  if (isNum(i)){
    if (i > 0) s.peakChgA = Math.max(s.peakChgA, i); else s.peakDisA = Math.max(s.peakDisA, -i);
  }
  if (isNum(w)){
    if (w > 0) s.peakChgW = Math.max(s.peakChgW, w); else s.peakDisW = Math.max(s.peakDisW, -w);
  }
  if (isNum(v)){
    s.vMin = isNum(s.vMin) ? Math.min(s.vMin, v) : v;
    s.vMax = isNum(s.vMax) ? Math.max(s.vMax, v) : v;
  }
  if (isNum(soc)){
    if (!isNum(s.socStart)) s.socStart = soc;
    s.socNow = soc;
  }
  for (const tv of temps) if (isNum(tv)) s.tMax = isNum(s.tMax) ? Math.max(s.tMax, tv) : tv;
  s.samples++;
}

/* Feeds a cell-voltage snapshot (V, 0 = no cell). */
export function sessionAddCells(s, cells){
  const act = [];
  cells.forEach((v, idx) => { if (isNum(v) && v > 0) act.push([v, idx]); });
  if (!act.length) return;
  for (const [v, idx] of act){
    if (!isNum(s.cellMin) || v < s.cellMin){ s.cellMin = v; s.cellMinIdx = idx; }
    if (!isNum(s.cellMax) || v > s.cellMax){ s.cellMax = v; s.cellMaxIdx = idx; }
  }
  if (act.length > 1){
    const vs = act.map(a=>a[0]);
    const d = (Math.max(...vs) - Math.min(...vs)) * 1000;
    s.deltaMaxMv = isNum(s.deltaMaxMv) ? Math.max(s.deltaMaxMv, d) : d;
  }
}
