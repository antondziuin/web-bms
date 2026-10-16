/* Battery state model: merging parsed updates, derived values and the multi-battery aggregate.
   Pure functions (no DOM), unit-tested in Node. */
import { isNum } from './util.js';

export const MAX_CELLS = 32;
export const DEFAULT_MIN_MV = 2900;
export const DEFAULT_MAX_MV = 4200;
export const CHG = { MIN_CHG_A: 0.10, MIN_SOC: 1, IDLE_A: 0.01, MIN_CHG_W: 2, IDLE_W: 0.5 };
/* Packs whose voltages differ more than this are separate systems (e.g. a 4S and a 14S pack):
   their voltages, currents and Ah cannot be averaged or added up, only watts and watt-hours can. */
export const SAME_BUS_RATIO = 1.15;

const NUMERIC_KEYS = ['totalV','current','soc','capRem','capFull','cycles','temp1','temp2','tmos','cfgSoc0mV','cfgSoc100mV','cfgUvpMv','cfgOvpMv'];

export function createState(){
  return {
    totalV:NaN, current:NaN, soc:NaN, capRem:NaN, capFull:NaN, cycles:NaN,
    temp1:NaN, temp2:NaN, tmos:NaN,
    balancing:false, errors:'OK', cells:[], model:'',
    lastCellsTs:0, lastSummaryTs:0,
    cfgSoc0mV:NaN, cfgSoc100mV:NaN, cfgUvpMv:NaN, cfgOvpMv:NaN,
    uptime:NaN, uptimeAt:0,
    bmsSettings:null, bmsSettingsAt:0,
  };
}

/* Merges a parsed partial update into state. Only finite numbers overwrite.
   Returns {summary, cells}: which kinds of data the update carried. */
export function applyUpdate(state, p, now = Date.now()){
  const res = { summary:false, cells:false };
  if (!p) return res;
  for (const k of NUMERIC_KEYS) if (isNum(p[k])) state[k] = p[k];
  if (typeof p.balancing === 'boolean') state.balancing = p.balancing;
  if (typeof p.errors === 'string' && p.errors) state.errors = p.errors;
  if (typeof p.model === 'string' && p.model) state.model = p.model;
  if (p.bmsSettings){ state.bmsSettings = p.bmsSettings; state.bmsSettingsAt = now; }
  if (isNum(p.uptime)){ state.uptime = p.uptime; state.uptimeAt = now; } // JK run time, to date logbook entries
  if (Array.isArray(p.cells) && p.cells.length){ state.cells = p.cells.slice(0, MAX_CELLS); state.lastCellsTs = now; res.cells = true; }
  if (isNum(p.totalV) || isNum(p.current)){ state.lastSummaryTs = now; res.summary = true; }
  return res;
}

/* The aggregate carries its own power (sum over packs); a pack's power is V × I. */
export function powerW(s){
  if (isNum(s.power)) return s.power;
  const w = s.totalV * s.current;
  return isNum(w) ? w : NaN;
}
export function activeCells(s){ return s.cells.filter(v=>isNum(v) && v>0); }
export function maxTemp(s){ const tt = [s.temp1, s.temp2].filter(isNum); return tt.length ? Math.max(...tt) : NaN; }
export function cellDeltaMv(s){
  const act = activeCells(s);
  return act.length > 1 ? (Math.max(...act) - Math.min(...act)) * 1000 : NaN;
}
export function getCellScaleMv(s){
  const soc0 = s.cfgSoc0mV, soc100 = s.cfgSoc100mV;
  if (isNum(soc0) && isNum(soc100) && soc100>soc0) return [soc0, soc100];
  const uvp = s.cfgUvpMv, ovp = s.cfgOvpMv;
  if (isNum(uvp) && isNum(ovp) && ovp>uvp) return [uvp, ovp];
  return [DEFAULT_MIN_MV, DEFAULT_MAX_MV];
}
/* Ёмкость: из BMS, если известна; иначе оценка по SOC и остатку */
export function estimateFullCapacityAh(s){
  const soc = s.soc, r = s.capRem;
  if (isNum(s.capFull) && s.capFull > 0 && (!isNum(r) || s.capFull >= r)) return s.capFull;
  if (!isNum(soc) || !isNum(r) || soc < CHG.MIN_SOC || r <= 0) return NaN;
  return r / (soc/100);
}
/* returns {mode:'discharge'|'charge'|'idle'|null, hours:NaN|number} */
export function estimateEta(s){
  if (isNum(s.power)) return estimateEtaEnergy(s);
  const i = s.current, rem = s.capRem;
  if (!isNum(i) || !isNum(rem)) return {mode:null, hours:NaN};
  if (i < -CHG.IDLE_A) return {mode:'discharge', hours: rem / (-i)};
  if (i <= CHG.IDLE_A) return {mode:'idle', hours:NaN};
  if (i <= CHG.MIN_CHG_A) return {mode:'charge', hours:NaN};
  if (isNum(s.soc) && s.soc >= 100) return {mode:'charge', hours:0};
  const full = estimateFullCapacityAh(s);
  if (!isNum(full)) return {mode:'charge', hours:NaN};
  return {mode:'charge', hours: Math.max(0, full - rem) / i};
}

/* Aggregate ETA in energy terms (Wh / W), valid for packs of any voltage. */
function estimateEtaEnergy(s){
  const p = s.power, rem = s.energyRemWh, full = s.energyFullWh;
  if (p < -CHG.IDLE_W) return {mode:'discharge', hours: isNum(rem) ? rem / (-p) : NaN};
  if (p <= CHG.IDLE_W) return {mode:'idle', hours:NaN};
  if (p <= CHG.MIN_CHG_W) return {mode:'charge', hours:NaN};
  if (isNum(s.soc) && s.soc >= 100) return {mode:'charge', hours:0};
  if (!isNum(rem) || !isNum(full)) return {mode:'charge', hours:NaN};
  return {mode:'charge', hours: Math.max(0, full - rem) / p};
}

const sumAll = (v) => v.length && v.every(isNum) ? v.reduce((a,b)=>a+b,0) : NaN;
const sumFinite = (v) => { const f = v.filter(isNum); return f.length ? f.reduce((a,b)=>a+b,0) : NaN; };

/* Combines several packs into one system-level state. Power and energy (Wh) are summed per pack,
   so packs of different voltages (4S next to 14S) combine correctly; SOC is weighted by energy.
   Voltage (average), current and Ah (sums) are only given when all packs sit at about the same
   voltage (parallel packs), otherwise they are NaN. Temperatures take the maximum.
   isLive(state): packs whose current/power still count — a pack that lost its link keeps its
   last SOC and energy, but must not keep "charging" with its last current. Packs without data are ignored. */
export function aggregateStates(states, isLive = () => true){
  const agg = Object.assign(createState(), { power:NaN, energyRemWh:NaN, energyFullWh:NaN });
  const packs = states.filter(s => s.lastSummaryTs);
  if (!packs.length) return agg;
  const flowing = packs.filter(isLive);
  const maxOf = (key) => { const v = states.map(s=>s[key]).filter(isNum); return v.length ? Math.max(...v) : NaN; };
  const volts = packs.map(s=>s.totalV).filter(isNum);
  const sameBus = volts.length < 2 || Math.max(...volts) <= Math.min(...volts) * SAME_BUS_RATIO;
  const fulls = packs.map(estimateFullCapacityAh);

  agg.power = sumFinite(flowing.map(powerW));
  agg.energyRemWh = sumAll(packs.map(s => s.capRem * s.totalV));
  agg.energyFullWh = sumAll(packs.map((s, k) => fulls[k] * s.totalV));
  if (sameBus){
    agg.totalV = volts.length ? volts.reduce((a,b)=>a+b,0) / volts.length : NaN;
    agg.current = sumFinite(flowing.map(s=>s.current));
    agg.capRem = sumFinite(packs.map(s=>s.capRem));
    agg.capFull = sumAll(fulls);
  }
  if (isNum(agg.energyFullWh) && agg.energyFullWh > 0 && isNum(agg.energyRemWh)) agg.soc = Math.min(100, agg.energyRemWh / agg.energyFullWh * 100);
  else if (isNum(agg.capFull) && agg.capFull > 0 && isNum(agg.capRem)) agg.soc = Math.min(100, agg.capRem / agg.capFull * 100);
  else { const socs = packs.map(s=>s.soc).filter(isNum); agg.soc = socs.length ? socs.reduce((a,b)=>a+b,0) / socs.length : NaN; }
  agg.temp1 = maxOf('temp1'); agg.temp2 = maxOf('temp2'); agg.tmos = maxOf('tmos');
  agg.balancing = states.some(s=>s.balancing);
  agg.lastSummaryTs = Math.max(...packs.map(s=>s.lastSummaryTs));
  agg.lastCellsTs = Math.max(0, ...states.map(s=>s.lastCellsTs));
  return agg;
}
