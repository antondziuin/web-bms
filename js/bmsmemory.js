/* "BMS memory" section of the Log tab: reads what the BMS itself keeps —
   JK: the event logbook (command 0xA1); JBD: protection counters (register 0xAA). */
import { isNum, errMsg, hhmmss } from './util.js';
import { t } from './i18n.js';
import { jkLogEventName, JBD_PROTECTION_KEYS, JK_LOGBOOK_MAX } from './protocols.js';
import { localTime } from './logformat.js';
import { download } from './log.js';

const $ = sel => document.querySelector(sel);
const p2 = x => String(x).padStart(2, '0');

/* BMS run time (seconds) as "12 d 03:04:05". */
export function formatRunTime(sec){
  const d = Math.floor(sec / 86400), r = sec % 86400;
  return `${d} ${t('unit.d')} ${p2(Math.floor(r / 3600))}:${p2(Math.floor(r % 3600 / 60))}:${p2(r % 60)}`;
}
/* Wall-clock time of a logbook entry, from the run time reported in the device-info frame. */
export function estimateEntryTime(ts, uptime, uptimeAt){
  return isNum(uptime) && uptimeAt && ts <= uptime ? uptimeAt - (uptime - ts) * 1000 : NaN;
}
function isAlarm(name){ return /protection|abnormal|failed|incorrect/i.test(name) && !/releas|cancel/i.test(name); }

/* getView(): { bat } for one battery, { all:true } for the aggregate, or { none:true }. */
export function createBmsMemory({ getView }){
  const el = {
    sub: $('#memSub'), read: $('#memRead'), status: $('#memStatus'), result: $('#memResult'), summary: $('#memSummary'),
    csv: $('#memCsv'), tableWrap: $('#memTableWrap'), rows: $('#memRows'), note: $('#memNote'), counters: $('#memCounters'),
  };
  let busy = false;

  function setStatus(text, isError){
    el.status.hidden = !text;
    el.status.textContent = text || '';
    el.status.classList.toggle('err', !!isError);
  }

  function render(){
    const v = getView();
    const bat = v.bat;
    const kind = bat?.driver?.kind;
    el.sub.textContent = v.all ? t('mem.allView')
      : !bat || !kind ? t('mem.noBattery')
      : kind === 'JK' ? t('mem.jkSub', { n: JK_LOGBOOK_MAX }) : t('mem.jbdSub');
    el.read.hidden = !bat || !kind;
    el.read.disabled = busy || !bat?.connected;
    el.read.textContent = busy ? t('mem.reading') : t('mem.read');
    const mem = bat?.memory;
    el.result.hidden = !mem;
    if (!mem) return;

    if (mem.kind === 'JK'){
      const { count, entries } = mem.logbook;
      el.summary.textContent = `${t('mem.jkCount', { n: count })} · ${t('mem.readAt', { time: hhmmss(mem.at) })}`;
      el.tableWrap.hidden = !entries.length;
      el.counters.replaceChildren();
      el.csv.hidden = !entries.length;
      const anyEstimated = entries.some(e => isNum(estimateEntryTime(e.ts, mem.uptime, mem.uptimeAt)));
      el.note.textContent = !entries.length ? t('mem.empty') : anyEstimated ? t('mem.timeNote') : '';
      const frag = document.createDocumentFragment();
      entries.forEach((e, i) => {
        const name = jkLogEventName(e.code);
        const at = estimateEntryTime(e.ts, mem.uptime, mem.uptimeAt);
        const tr = document.createElement('tr');
        if (isAlarm(name)) tr.className = 'warn';
        const tdN = document.createElement('td'); tdN.textContent = String(i + 1);
        const tdT = document.createElement('td');
        tdT.textContent = isNum(at) ? localTime(at).slice(0, 16) : formatRunTime(e.ts);
        if (isNum(at)){ const rel = document.createElement('span'); rel.className = 'rel'; rel.textContent = formatRunTime(e.ts); tdT.appendChild(rel); }
        const tdE = document.createElement('td'); tdE.textContent = name;
        tr.append(tdN, tdT, tdE);
        frag.appendChild(tr);
      });
      el.rows.replaceChildren(frag);
    } else {
      el.summary.textContent = t('mem.readAt', { time: hhmmss(mem.at) });
      el.tableWrap.hidden = true; el.csv.hidden = true; el.note.textContent = '';
      el.counters.replaceChildren(...mem.counts.flatMap((n, i) => {
        const dt = document.createElement('dt');
        dt.textContent = JBD_PROTECTION_KEYS[i] ? t('mem.cnt.' + JBD_PROTECTION_KEYS[i]) : t('mem.cnt.extra', { n: i + 1 });
        const dd = document.createElement('dd');
        dd.textContent = String(n);
        if (n > 0) dd.className = 'hit';
        return [dt, dd];
      }));
    }
  }

  el.read.addEventListener('click', async () => {
    const bat = getView().bat;
    if (!bat?.driver || busy) return;
    busy = true; setStatus(''); render();
    try{
      if (bat.driver.kind === 'JK'){
        const logbook = await bat.driver.readLogbook();
        bat.memory = { kind: 'JK', at: Date.now(), logbook, uptime: bat.state.uptime, uptimeAt: bat.state.uptimeAt };
      } else {
        const counts = await bat.driver.readCounters();
        bat.memory = { kind: 'JBD', at: Date.now(), counts };
      }
    }catch(err){ setStatus(t('mem.failed', { msg: errMsg(err) }), true); }
    finally{ busy = false; render(); }
  });

  el.csv.addEventListener('click', () => {
    const bat = getView().bat, mem = bat?.memory;
    if (mem?.kind !== 'JK') return;
    const lines = ['index,bms_run_time_s,estimated_time,code,event'];
    mem.logbook.entries.forEach((e, i) => {
      const at = estimateEntryTime(e.ts, mem.uptime, mem.uptimeAt);
      lines.push([i + 1, e.ts, isNum(at) ? localTime(at) : '', '0x' + e.code.toString(16).toUpperCase().padStart(2, '0'), `"${jkLogEventName(e.code)}"`].join(','));
    });
    download(`web-bms-bms-log-${(bat.device.name || bat.id).replace(/[^\w.-]+/g, '_')}.csv`, lines.join('\r\n') + '\r\n', 'text/csv');
  });

  return { render };
}
