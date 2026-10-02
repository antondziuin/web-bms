/* In-page layout audit (runs via page.evaluate). Returns text that spills out of its container,
   text cut off by overflow/ellipsis, and horizontal page scroll. */
(() => {
  const CONTAINERS = '.card,.tile,.chip,.btn,.stat,.energy-card,.bat-card,.bat-chip,.cell-card,.kv dt,.kv dd,.setting,'
    + '.recent-item,.banner,dialog,.seg button,.flow,.conn,.topbar,.empty,.chart-head,.raw-head,.dlg-head,.gauge';
  const SCROLLERS = '#batBar,#rawInfo,#recent-list';
  // Intentionally ellipsized: long statuses and device names (full text is in the title / details).
  const ELLIPSIS_OK = '#statusBar,.bat-chip .name,.bat-card-name';
  const issues = [];
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) issues.push({ type: 'page-hscroll', where: 'html', detail: `${de.scrollWidth} > ${de.clientWidth}` });

  const describe = (el) => {
    if (el.id) return '#' + el.id;
    const cls = [...el.classList].slice(0, 2).join('.');
    const parent = el.parentElement?.closest('[id]');
    return (parent ? '#' + parent.id + ' ' : '') + el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  };
  const shown = (el) => {
    if (el.closest('[hidden]')) return false;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  for (const el of document.querySelectorAll('body *')){
    if (el.closest('svg, script, style, template')) continue;
    if (el.closest('dialog') && !el.closest('dialog').open) continue;
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!hasText || !shown(el)) continue;
    const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 70);
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 1 && (cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis')){
      if (!el.matches(ELLIPSIS_OK)) issues.push({ type: 'truncated', where: describe(el), detail: text });
      continue;
    }
    if (el.closest(SCROLLERS)) continue;
    const cont = el.closest(CONTAINERS);
    if (!cont) continue;
    const range = document.createRange();
    range.selectNodeContents(el);
    const t = range.getBoundingClientRect(), c = cont.getBoundingClientRect();
    const over = Math.max(t.right - c.right, c.left - t.left, t.bottom - c.bottom, c.top - t.top);
    if (over > 1) issues.push({ type: 'spill', where: describe(el), detail: `${text} (by ${over.toFixed(1)}px out of ${describe(cont)})` });
  }
  return issues;
})()
