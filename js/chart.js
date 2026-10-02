/* Canvas line chart for one metric of the history points: grid, area fill, gap breaks, hover tooltip.
   Colours come from CSS custom properties, so it follows the light/dark theme. */
import { isNum, clamp, hhmmss } from './util.js';
import { t } from './i18n.js';

export const CHART_GAP_MS = 15000; // разрыв линии, если данных не было дольше
/* now / tip: decimals for the "Now" label and the tooltip */
export const METRICS = {
  w:   { unit:'W',  color:'--c-power',   get:p=>p.w,   now:1, tip:2 },
  i:   { unit:'A',  color:'--c-current', get:p=>p.i,   now:2, tip:2 },
  v:   { unit:'V',  color:'--c-volt',    get:p=>p.v,   now:2, tip:2 },
  soc: { unit:'%',  color:'--c-soc',     get:p=>p.soc, now:0, tip:0 },
  d:   { unit:'mV', color:'--warn',      get:p=>p.d,   now:0, tip:0 },
  tc:  { unit:'°C', color:'--err',       get:p=>p.tc,  now:1, tip:1 },
};

/* Axis/tooltip time: add the date when the visible span is longer than ~a day. */
function formatTime(ts, span, tooltip){
  const d = new Date(ts), p2 = x => String(x).padStart(2, '0');
  const date = `${p2(d.getDate())}.${p2(d.getMonth()+1)}`;
  if (span > 20 * 3600000) return tooltip ? `${date} ${hhmmss(ts)}` : `${date} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  if (span > 2 * 3600000 && !tooltip) return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  return hhmmss(ts);
}

function niceDecimals(span, unit){ if (unit==='%') return 0; return span >= 20 ? 0 : span >= 2 ? 1 : 2; }

/* getPoints(): array of {t, w, i, v, soc, d, tc}; nowEl: element for the "Now: …" label (or null).
   opts.gapMs(): line-break threshold for this data (default CHART_GAP_MS). */
export function createChart(canvas, wrap, nowEl, getPoints, opts = {}){
  const ctx = canvas.getContext('2d');
  let metricKey = 'w';
  let hoverX = null;

  function roundRect(x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
  }

  function draw(){
    const metric = METRICS[metricKey];
    const pts = getPoints().filter(p=>isNum(metric.get(p)));
    const n = pts.length;
    if (nowEl) nowEl.innerHTML = n ? `${t('chart.now')} <b>${metric.get(pts[n-1]).toFixed(metric.now)} ${metric.unit}</b>` : '';
    const gapMs = opts.gapMs ? opts.gapMs() : CHART_GAP_MS;

    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    ctx.clearRect(0,0,w,h);
    const css = getComputedStyle(canvas);
    const color = css.getPropertyValue(metric.color).trim() || '#3b82f6';
    const cGrid = css.getPropertyValue('--chart-grid').trim();
    const cAxis = css.getPropertyValue('--chart-axis').trim();
    const cText = css.getPropertyValue('--chart-text').trim();
    const cSurface = css.getPropertyValue('--surface').trim();
    const cTextStrong = css.getPropertyValue('--text').trim();

    let min = 0, max = 1;
    if (n){ const vals = pts.map(metric.get); min = Math.min(...vals); max = Math.max(...vals); }
    if (metricKey==='soc'){ min = Math.max(0, Math.min(min, max-10)); max = Math.min(100, Math.max(max, min+10)); }
    if (max - min < 1e-6){ min -= 1; max += 1; }
    else { const pad = (max-min)*0.08; min -= pad; max += pad; }
    const span = max - min;

    ctx.save();
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    ctx.lineWidth = 1;
    const ticks = 4, dec = niceDecimals(span, metric.unit);
    const yLabels = Array.from({length:ticks+1}, (_,i)=>{ const v = min + span*i/ticks; return {v, text:`${v.toFixed(dec)} ${metric.unit}`}; });
    // why: ширина подписей зависит от значений (минус, тысячи) — отступ слева считаем по тексту
    const labelW = Math.max(...yLabels.map(l=>ctx.measureText(l.text).width));
    const PAD = {l:Math.ceil(labelW)+16, r:14, t:14, b:26};
    const pw = Math.max(1, w-PAD.l-PAD.r), ph = Math.max(1, h-PAD.t-PAD.b);
    const t1 = n ? pts[n-1].t : Date.now();
    const t0 = n ? pts[0].t : t1 - 60000;
    const dt = Math.max(1, t1 - t0);
    const X = t => n===1 ? PAD.l + pw : PAD.l + ((t - t0) / dt) * pw;
    const Y = v => PAD.t + ph - ((v - min) / span) * ph;

    // grid + Y labels
    ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    for (const {v, text} of yLabels){
      const y = Math.round(Y(v)) + .5;
      ctx.strokeStyle = cGrid;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l+pw, y); ctx.stroke();
      ctx.fillStyle = cText;
      ctx.fillText(text, PAD.l-8, y);
    }
    if (min < 0 && max > 0){
      const y = Math.round(Y(0)) + .5;
      ctx.strokeStyle = cAxis; ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l+pw, y); ctx.stroke();
      ctx.setLineDash([]);
    }
    // X labels
    ctx.fillStyle = cText; ctx.textBaseline = 'alphabetic';
    const xTicks = pw > 300 ? 3 : 2;
    let prevLabel = '';
    for (let i=0;i<=xTicks;i++){
      const label = formatTime(t0 + dt*i/xTicks, dt, false);
      if (label === prevLabel) continue;
      prevLabel = label;
      ctx.textAlign = i===0 ? 'left' : i===xTicks ? 'right' : 'center';
      ctx.fillText(label, PAD.l + pw*i/xTicks, h-8);
    }

    if (!n){
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = cText;
      ctx.font = '13px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
      ctx.fillText(t('chart.noData'), PAD.l + pw/2, PAD.t + ph/2);
      ctx.restore();
      return;
    }

    // split into segments at gaps
    const segs = []; let cur = [];
    for (let i=0;i<n;i++){
      if (i && pts[i].t - pts[i-1].t > gapMs){ segs.push(cur); cur = []; }
      cur.push(pts[i]);
    }
    segs.push(cur);

    // area fill
    const grad = ctx.createLinearGradient(0, PAD.t, 0, PAD.t+ph);
    grad.addColorStop(0, color + '55'); grad.addColorStop(1, color + '00');
    const baseY = (min < 0 && max > 0) ? Y(0) : PAD.t + ph; // why: заливка к нулю, если он в диапазоне, иначе к низу
    for (const s of segs){
      if (s.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(X(s[0].t), baseY);
      for (const p of s) ctx.lineTo(X(p.t), Y(metric.get(p)));
      ctx.lineTo(X(s[s.length-1].t), baseY);
      ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();
    }
    // line
    ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = color;
    for (const s of segs){
      ctx.beginPath();
      s.forEach((p,i)=>{ const x = X(p.t), y = Y(metric.get(p)); if (i) ctx.lineTo(x,y); else ctx.moveTo(x,y); });
      ctx.stroke();
    }
    // last point
    const last = pts[n-1];
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(last.t), Y(metric.get(last)), 3.5, 0, Math.PI*2); ctx.fill();

    // hover tooltip
    if (hoverX !== null && hoverX >= PAD.l - 10 && hoverX <= PAD.l + pw + 10){
      let best = pts[0], bestD = Infinity;
      for (const p of pts){ const d = Math.abs(X(p.t) - hoverX); if (d < bestD){ bestD = d; best = p; } }
      const x = X(best.t), y = Y(metric.get(best));
      ctx.strokeStyle = cAxis; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x)+.5, PAD.t); ctx.lineTo(Math.round(x)+.5, PAD.t+ph); ctx.stroke();
      ctx.fillStyle = cSurface; ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      const vtxt = `${metric.get(best).toFixed(metric.tip)} ${metric.unit}`, ttxt = formatTime(best.t, dt, true);
      ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
      const bw = Math.max(ctx.measureText(vtxt).width, ctx.measureText(ttxt).width) + 18, bh = 40;
      const bx = clamp(x + 10 + bw > PAD.l + pw ? x - 10 - bw : x + 10, PAD.l, PAD.l + pw - bw);
      const by = clamp(y - bh - 8, PAD.t, PAD.t + ph - bh);
      ctx.fillStyle = cSurface; ctx.strokeStyle = cGrid; ctx.lineWidth = 1;
      roundRect(bx, by, bw, bh, 8); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = cTextStrong; ctx.fillText(vtxt, bx + 9, by + 6);
      ctx.font = '11px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
      ctx.fillStyle = cText; ctx.fillText(ttxt, bx + 9, by + 23);
    }
    ctx.restore();
  }

  function resize(){
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.max(1, Math.floor(cssW * dpr)), ph = Math.max(1, Math.floor(cssH * dpr));
    if (canvas.width !== pw || canvas.height !== ph){ canvas.width = pw; canvas.height = ph; }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    draw();
  }

  function onPointer(e){
    const r = canvas.getBoundingClientRect();
    hoverX = e.clientX - r.left;
    draw();
  }
  canvas.addEventListener('pointermove', onPointer);
  canvas.addEventListener('pointerdown', onPointer);
  canvas.addEventListener('pointerleave', ()=>{ hoverX = null; draw(); });
  window.addEventListener('resize', ()=>requestAnimationFrame(resize), {passive:true});
  if ('ResizeObserver' in window){
    try{ new ResizeObserver(()=>requestAnimationFrame(resize)).observe(wrap); }catch{}
  }

  return {
    draw, resize,
    get metric(){ return metricKey; },
    setMetric(m){ metricKey = METRICS[m] ? m : 'w'; draw(); },
  };
}
