/* Small shared helpers (no DOM). */
export const isNum = Number.isFinite;
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
export function map(x,inMin,inMax,outMin,outMax){
  if (!isNum(x)) return outMin;
  if (Math.abs(inMax-inMin)<1e-9) return outMin;
  return (x-inMin)*(outMax-outMin)/(inMax-inMin)+outMin;
}
export function fmt(v,u,d){ return isNum(v)? `${v.toFixed(d)} ${u}` : `– ${u}`; }
export function num(v,d){ return isNum(v) ? v.toFixed(d) : '—'; }
export function errMsg(err){ return (err && (err.message || err.name)) || String(err); }
export function storageGet(key, def){ try{ const v = localStorage.getItem(key); return v===null ? def : v; }catch{ return def; } }
export function storageSet(key, val){ try{ localStorage.setItem(key, val); }catch{} }
export function storageGetJson(key, def){ try{ const v = localStorage.getItem(key); return v===null ? def : JSON.parse(v); }catch{ return def; } }
export function storageSetJson(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch{} }
export function withTimeout(promise, ms, label){
  let t;
  return Promise.race([
    promise,
    new Promise((_,rej)=>{ t = setTimeout(()=>rej(new Error(label||'Timeout')), ms); })
  ]).finally(()=>clearTimeout(t));
}
export function hhmmss(ts){
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(x=>String(x).padStart(2,'0')).join(':');
}
/* человекочитаемая «свежесть» для сырого дампа (англ.) */
export function ago(ts,now){
  if(!ts) return '—';
  const ms = Math.max(0, now - ts);
  if (ms < 1500) return 'now';
  if (ms < 60000) return `${(ms/1000).toFixed(1)} s ago`;
  if (ms < 3600000) return `${Math.floor(ms/60000)} m ago`;
  if (ms < 86400000) return `${Math.floor(ms/3600000)} h ago`;
  return `${Math.floor(ms/86400000)} d ago`;
}
