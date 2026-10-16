/* "BMS parameters" section of the Details tab: protection, balancing and battery settings, view only.
   JK sends them by itself on connect (settings frame); JBD keeps them in EEPROM and is read on request. */
import { isNum, errMsg, hhmmss } from './util.js';
import { t, getLang } from './i18n.js';

const $ = sel => document.querySelector(sel);

/* Rows by group. label: i18n key (defaults to bset.<k>); u: unit; rel / delay / rec: keys of the
   release value, trigger delay and recovery time shown under the value. */
const GROUPS = [
  { key: 'volt', rows: [
    { k: 'cellOvp', label: 'mem.cnt.covp', u: 'mv', rel: 'cellOvpRel' },
    { k: 'cellUvp', label: 'mem.cnt.cuvp', u: 'mv', rel: 'cellUvpRel' },
    { k: 'packOvp', label: 'mem.cnt.povp', u: 'v', rel: 'packOvpRel' },
    { k: 'packUvp', label: 'mem.cnt.puvp', u: 'v', rel: 'packUvpRel' },
    { k: 'powerOff', u: 'mv' },
    { k: 'soc100', u: 'mv' },
    { k: 'soc0', u: 'mv' },
    { k: 'rcv', u: 'mv' },
    { k: 'rfv', u: 'mv' },
  ] },
  { key: 'current', rows: [
    { k: 'chgOc', label: 'mem.cnt.chgoc', u: 'a', delay: 'chgOcDelay', rec: 'chgOcRec' },
    { k: 'dsgOc', label: 'mem.cnt.dsgoc', u: 'a', delay: 'dsgOcDelay', rec: 'dsgOcRec' },
    { k: 'scpDelay', u: 'us', rec: 'scpRec' },
  ] },
  { key: 'temp', rows: [
    { k: 'chgOt', label: 'mem.cnt.chgot', u: 'c', rel: 'chgOtRel' },
    { k: 'chgUt', label: 'mem.cnt.chgut', u: 'c', rel: 'chgUtRel' },
    { k: 'dsgOt', label: 'mem.cnt.dsgot', u: 'c', rel: 'dsgOtRel' },
    { k: 'dsgUt', label: 'mem.cnt.dsgut', u: 'c', rel: 'dsgUtRel' },
    { k: 'mosOt', u: 'c', rel: 'mosOtRel' },
  ] },
  { key: 'bal', rows: [
    { k: 'balSwitch', u: 'bool' },
    { k: 'balChgOnly', u: 'bool' },
    { k: 'balStart', u: 'mv' },
    { k: 'balTrigger', u: 'mvd' },
    { k: 'balMaxCurrent', u: 'a' },
  ] },
  { key: 'bat', rows: [
    { k: 'cellCount', u: 'n' },
    { k: 'designCap', u: 'ah' },
    { k: 'cycleCap', u: 'ah' },
    { k: 'chgSwitch', u: 'bool' },
    { k: 'dsgSwitch', u: 'bool' },
  ] },
];

/* Up to `max` decimals, without trailing zeros: 60 → "60", 2.5 → "2.5". */
const trim = (v, max) => String(Number(v.toFixed(max)));
export function formatSetting(v, u){
  if (u === 'bool') return typeof v === 'boolean' ? t(v ? 'bset.on' : 'bset.off') : '';
  if (!isNum(v)) return '';
  switch (u){
    case 'mv': return `${(v / 1000).toFixed(3)} V`;
    case 'v': return `${v.toFixed(2)} V`;
    case 'mvd': return `${trim(v, 0)} mV`;
    case 'a': return `${trim(v, 2)} A`;
    case 'c': return `${trim(v, 1)} °C`;
    case 's': return `${trim(v, 0)} ${t('unit.s')}`;
    case 'us': return `${trim(v, 0)} µs`;
    case 'ah': return `${trim(v, 1)} Ah`;
    default: return trim(v, 0);
  }
}

/* Groups of { label, value, sub: [notes] } with only the values the BMS reported. */
export function settingRows(settings){
  if (!settings) return [];
  return GROUPS.map(g => ({
    key: g.key,
    rows: g.rows.flatMap(r => {
      const value = formatSetting(settings[r.k], r.u);
      if (!value) return [];
      const rel = r.rel && formatSetting(settings[r.rel], r.u);
      const delay = r.delay && formatSetting(settings[r.delay], 's');
      const rec = r.rec && formatSetting(settings[r.rec], 's');
      const sub = [rel && t('bset.rel', { v: rel }), delay && t('bset.delay', { v: delay }), rec && t('bset.rec', { v: rec })].filter(Boolean);
      return [{ k: r.k, label: t(r.label || 'bset.' + r.k), value, sub }];
    }),
  })).filter(g => g.rows.length);
}

/* getView(): { bat } for one battery, { all:true } for the aggregate, or { none:true }. */
export function createBmsSettings({ getView }){
  const el = { block: $('#bsetBlock'), sub: $('#bsetSub'), read: $('#bsetRead'), status: $('#bsetStatus'), groups: $('#bsetGroups') };
  let busy = false, error = null, shown = null; // shown: what #bsetGroups holds, to skip rebuilding it every tick

  function render(){
    const v = getView();
    const bat = v.bat, kind = bat?.driver?.kind;
    el.block.hidden = !v.all && !kind;
    if (el.block.hidden) return;
    const s = bat?.state;
    el.sub.textContent = v.all ? t('bset.allView')
      : kind === 'JBD' ? t('bset.jbdSub')
      : s.bmsSettings ? t('bset.jkSub') : t('bset.jkNone');
    el.read.hidden = kind !== 'JBD';
    el.read.disabled = busy || !bat?.connected;
    el.read.textContent = busy ? t('mem.reading') : t('mem.read');
    const statusText = error && error.bat === bat ? t('mem.failed', { msg: error.msg })
      : kind === 'JBD' && s.bmsSettingsAt ? t('mem.readAt', { time: hhmmss(s.bmsSettingsAt) }) : '';
    el.status.hidden = !statusText;
    el.status.textContent = statusText;
    el.status.classList.toggle('err', !!(error && error.bat === bat));

    const settings = v.all ? null : s.bmsSettings, lang = getLang();
    if (shown && shown.settings === settings && shown.lang === lang) return;
    shown = { settings, lang };
    const frag = document.createDocumentFragment();
    for (const g of settingRows(settings)){
      const title = document.createElement('div');
      title.className = 'bset-title';
      title.textContent = t('bset.g.' + g.key);
      const dl = document.createElement('dl');
      dl.className = 'kv bset-kv';
      for (const r of g.rows){
        const dt = document.createElement('dt'); dt.textContent = r.label;
        const dd = document.createElement('dd'); dd.className = 'num'; dd.dataset.key = r.k; dd.textContent = r.value;
        for (const note of r.sub){ const sub = document.createElement('span'); sub.className = 'rel'; sub.textContent = note; dd.appendChild(sub); }
        dl.append(dt, dd);
      }
      frag.append(title, dl);
    }
    el.groups.replaceChildren(frag);
  }

  el.read.addEventListener('click', async () => {
    const bat = getView().bat;
    if (!bat?.driver?.readSettings || busy) return;
    busy = true; error = null; render();
    try{
      const settings = await bat.driver.readSettings();
      bat.state.bmsSettings = settings; bat.state.bmsSettingsAt = Date.now();
    }catch(err){ error = { bat, msg: errMsg(err) }; }
    finally{ busy = false; render(); }
  });

  return { render };
}
