/* E2E: the Log tab — reading the BMS memory (JK logbook, JBD protection counters) and the log
   recorded in the browser (IndexedDB): table, chart, CSV/JSON export, opening a file, raw frames. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer, ROOT } from '../serve.mjs';

const MOCK = fs.readFileSync(path.join(ROOT, 'tests/fixtures/frames.mjs'), 'utf8').replace(/^export /gm, '')
  + '\n' + fs.readFileSync(path.join(ROOT, 'tests/e2e/mock-bluetooth.js'), 'utf8');

let server, browser;
before(async () => { server = await startServer(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); await server?.close(); });

async function openApp(query, { clock } = {}){
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript("try{ localStorage.setItem('ui:offline', '0'); }catch{}");
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if (clock) await page.clock.install({ time: new Date('2026-10-02T12:00:00') });
  await page.goto(server.url + 'index.html' + query);
  return { ctx, page, errors };
}
async function connect(page, clock){
  await page.click('#btn-choose');
  if (clock) await page.clock.runFor(2000);
  await page.waitForFunction(() => !document.getElementById('dlg-picker').open);
}
async function downloadText(page, selector){
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
  return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), 'utf8') };
}
const text = (page, sel) => page.textContent(sel);

test('JK: event log read from the BMS memory', async () => {
  const { ctx, page, errors } = await openApp('?devices=jk:JK-B2A8S20P');
  await connect(page);
  await page.waitForFunction(() => document.getElementById('statusBar').textContent.includes('JK'));
  await page.click('#tab-log-btn');
  assert.match(await text(page, '#memSub'), /Журнал событий, который хранит сама BMS/);
  await page.click('#memRead');
  await page.waitForSelector('#memResult:not([hidden])');
  assert.match(await text(page, '#memSummary'), /^Записей в BMS: 5 · считано в \d\d:\d\d:\d\d$/);
  const rows = await page.$$eval('#memRows tr', trs => trs.map(tr => ({ cls: tr.className, cells: [...tr.cells].map(td => td.textContent) })));
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(r => r.cells[2]), ['Boot', 'Cell undervoltage protection', 'Cell undervoltage protection is released',
    'Charge overcurrent protection', 'Charge overcurrent protection is released']);
  assert.deepEqual(rows.map(r => r.cls), ['', 'warn', '', 'warn', '']);
  // dates are derived from the run time (3 d 01:00:00 at connect); the run time is shown under the date
  assert.match(rows[0].cells[1], /^\d{4}-\d\d-\d\d \d\d:\d\d0 д 00:10:00$/);
  assert.match(rows[4].cells[1], /3 д 00:30:00$/);
  const csv = await downloadText(page, '#memCsv');
  assert.match(csv.name, /^web-bms-bms-log-JK-B2A8S20P\.csv$/);
  const lines = csv.text.trim().split(/\r\n/);
  assert.equal(lines[0], 'index,bms_run_time_s,estimated_time,code,event');
  assert.match(lines[4], /^4,172830,\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,0x15,"Charge overcurrent protection"$/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('JBD: protection counters, factory mode is entered and left without saving', async () => {
  const { ctx, page, errors } = await openApp('?devices=jbd:Bat-A');
  await connect(page);
  await page.waitForFunction(() => document.getElementById('statusBar').textContent.includes('JBD'));
  await page.click('#tab-log-btn');
  assert.match(await text(page, '#memSub'), /Счётчики срабатываний защит/);
  await page.click('#memRead');
  await page.waitForSelector('#memResult:not([hidden])');
  const kv = await page.$$eval('#memCounters dt, #memCounters dd', els => els.map(e => e.textContent));
  assert.deepEqual(kv.slice(0, 10), ['Короткое замыкание', '2', 'Перегрузка по току заряда', '0', 'Перегрузка по току разряда', '1',
    'Перенапряжение ячейки', '5', 'Недонапряжение ячейки', '3']);
  assert.equal(kv.length, 22);
  assert.equal(await page.$$eval('#memCounters dd.hit', e => e.length), 5);
  assert.deepEqual(await page.evaluate(() => window.__mock.registerWrites), [[0x00, 0x56, 0x78], [0x01, 0x00, 0x00]],
    'factory mode entered (0x5678) and left without saving (0x0000)');
  const writes = await page.evaluate(() => window.__mock.writes);
  await page.waitForTimeout(1500);
  assert.ok(await page.evaluate(() => window.__mock.writes) > writes, 'regular polling resumes');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('browser log: recording, table, export, opening a file, persistence, clearing, raw frames', async () => {
  const { ctx, page, errors } = await openApp('?devices=jbd:Bat-A', { clock: true });
  await connect(page, true);
  await page.clock.runFor(3 * 60_000); // 3 minutes at the default 10 s interval
  await page.click('#tab-log-btn');
  await page.waitForFunction(() => /^Записей: \d+/.test(document.getElementById('logSummary').textContent));
  const n = Number((await text(page, '#logSummary')).match(/^Записей: (\d+)/)[1]);
  assert.ok(n >= 17 && n <= 20, `about 18 records in 3 min, got ${n}`);
  assert.equal(await page.$$eval('#logRows tr', trs => trs.length), n);
  assert.deepEqual(await page.$eval('#logRows tr', tr => [...tr.cells].slice(1, 6).map(td => td.textContent)), ['53.20', '-12.34', '-656', '80', '72']);
  assert.equal(await page.isVisible('#logChart'), true);
  for (const m of ['i', 'v', 'soc', 'd', 'tc', 'w']) await page.click(`#logMetric [data-metric=${m}]`);

  const csv = await downloadText(page, '#logCsv');
  assert.match(csv.name, /^web-bms-log-\d{8}-\d{4}\.csv$/);
  const csvLines = csv.text.trim().split(/\r\n/);
  assert.equal(csvLines.length, n + 1);
  assert.match(csvLines[0], /^time,timestamp_ms,device_id,device,voltage_V,current_A,power_W,soc_pct/);
  assert.match(csvLines[1], /,dev-0,Bat-A,53\.2,-12\.34,-656\.5,80,80,100,25,26,,1,,3\.25,3\.322,72,3\.32,/);

  const json = await downloadText(page, '#logJson');
  const tmp = path.join(ROOT, 'test-results'); fs.mkdirSync(tmp, { recursive: true });
  const jsonPath = path.join(tmp, 'saved-log.json');
  fs.writeFileSync(jsonPath, json.text);

  await page.setInputFiles('#logFile', jsonPath);
  await page.waitForSelector('#logFileBar:not([hidden])');
  assert.equal(await text(page, '#logFileName'), 'Файл: saved-log.json');
  assert.match(await text(page, '#logSummary'), new RegExp(`^Записей: ${n} `));
  await page.click('#logCloseFile');
  await page.waitForSelector('#logFileBar', { state: 'hidden' });

  // raw BLE frames
  await page.click('#rawEnabled');
  await page.clock.runFor(10_000);
  await page.clock.runFor(10_000); // the counter refreshes on the next tick
  assert.match(await text(page, '#rawSub'), /кадров: [1-9]\d*/);
  const frames = await downloadText(page, '#rawDownload');
  assert.match(frames.text, /\tBat-A\tJBD\tDD 03 00 1B /);
  assert.match(frames.text, /\tBat-A\tJBD\tDD 04 00 20 /);

  // records survive a reload; clearing empties the log
  await page.reload();
  await page.click('#btn-close-picker').catch(() => {});
  await page.click('#tab-log-btn');
  await page.waitForFunction(() => /^Записей: \d+/.test(document.getElementById('logSummary').textContent));
  page.once('dialog', d => d.accept());
  await page.click('#logClear');
  await page.waitForFunction(() => !document.getElementById('logEmpty').hidden);
  assert.equal(await text(page, '#logEmptyText'), 'Записей пока нет. Журнал пополняется, пока BMS подключена.');
  assert.deepEqual(errors, []);
  await ctx.close();
});
