/* End-to-end tests: the real page in headless Chromium with a fake navigator.bluetooth
   (tests/e2e/mock-bluetooth.js) emulating JBD and JK BMSes byte-for-byte. */
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

/* Opens the app in a fresh context (own storage / service workers). */
async function openApp(query = '', { locale = 'ru-RU', base = server.url, context } = {}){
  const ctx = context || await browser.newContext({ locale, viewport: { width: 400, height: 860 } });
  const page = await ctx.newPage();
  const errors = [], external = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('request', r => { if (!r.url().startsWith(base)) external.push(r.url()); });
  await ctx.addInitScript(MOCK);
  await page.goto(base + 'index.html' + query);
  const done = async () => {
    assert.deepEqual(errors, [], 'page errors');
    assert.deepEqual(external, [], 'requests outside the app origin');
    await ctx.close();
  };
  return { page, ctx, errors, done };
}

const text = (page, sel) => page.textContent(sel);
/* Polls until the element text matches (string = exact, RegExp = test); fails with the last value. */
async function waitText(page, sel, expected, timeout = 6000){
  const ok = v => expected instanceof RegExp ? expected.test(v ?? '') : v === expected;
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end){
    last = await page.textContent(sel).catch(() => null);
    if (ok(last)) return last;
    await page.waitForTimeout(100);
  }
  assert.fail(`${sel}: expected ${expected}, got ${JSON.stringify(last)}`);
}
const visible = (page, sel) => page.isVisible(sel);
const count = (page, sel) => page.$$eval(sel, els => els.filter(e => !e.hidden && e.offsetParent !== null).length);

async function connectViaPicker(page){
  if (!(await page.evaluate(() => document.getElementById('dlg-picker').open))) await page.click('#btn-bt');
  await page.click('#btn-choose');
}

test('single JBD: values, cells, chart, details', async () => {
  const { page, done } = await openApp('?devices=jbd:xiaoxiang-test');
  assert.ok(await page.evaluate(() => document.getElementById('dlg-picker').open), 'picker opens when nothing is remembered');
  await connectViaPicker(page);
  await waitText(page, '#statusBar', 'xiaoxiang-test · JBD');
  await waitText(page, '#deltaVal', '72');
  assert.equal(await text(page, '#voltVal'), '53.20');
  assert.equal(await text(page, '#ampVal'), '-12.34');
  assert.equal(await text(page, '#socVal'), '80');
  assert.equal(await text(page, '#capRemVal'), '80.00');
  assert.equal(await text(page, '#capFullSub'), 'из 100 Ah');
  assert.equal(await text(page, '#etaLabel'), 'До разряда');
  assert.equal(await text(page, '#etaVal'), '6 ч 28 м');
  assert.equal(await text(page, '#flowText'), 'Разряд');
  assert.equal(await text(page, '#powerVal'), '656');
  assert.equal(await text(page, '#tempsVal'), '26.0');
  assert.equal(await text(page, '#tempsSub'), 'T1 25.0 · T2 26.0');
  assert.equal(await text(page, '#cyclesVal'), '42');
  assert.equal(await text(page, '#balancingText'), 'Балансировка вкл.');
  assert.equal(await page.getAttribute('#socGauge', 'data-level'), 'high');
  assert.equal(await page.getAttribute('#connChip', 'data-tone'), 'ok');
  assert.equal(await count(page, '.cell-card'), 16);
  assert.equal(await page.$$eval('.flag-min', els => els.map(e => e.textContent).join()), 'LOW');
  assert.equal(await page.$$eval('.cell-card.is-max', els => els.length), 1);
  assert.equal(await text(page, '#btnBtLabel'), 'Добавить');
  assert.equal(await visible(page, '#batBar'), false, 'switcher hidden with one battery');

  await page.click('#tab-details-btn');
  await waitText(page, '#detKind', 'JBD');
  assert.match(await text(page, '#rawInfo'), /Cells: 16 · Σ=53\.063 V/);

  await page.click('#tab-chart-btn');
  for (const m of ['i', 'v', 'soc', 'w']) await page.click(`#chartMetric [data-metric=${m}]`);
  const box = await page.locator('#chart').boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + 100);
  await waitText(page, '#chartNow', /-656\.5 W/);
  await done();
});

test('link loss reconnects; user disconnect stops everything', async () => {
  const { page, done } = await openApp('?devices=jbd:xiaoxiang-test');
  await connectViaPicker(page);
  await waitText(page, '#statusBar', 'xiaoxiang-test · JBD');
  await page.evaluate(() => window.__mock.devices[0].__drop());
  await waitText(page, '#statusBar', /повтор через 1 с \(1\/8\)/);
  await waitText(page, '#statusBar', 'xiaoxiang-test · JBD');

  await page.click('#tab-details-btn');
  await page.click('#btn-disconnect');
  await waitText(page, '#statusBar', 'Отключено');
  const writes = await page.evaluate(() => window.__mock.writes);
  await page.waitForTimeout(2500);
  assert.equal(await page.evaluate(() => window.__mock.writes), writes, 'polling stopped');
  assert.equal(await text(page, '#statusBar'), 'Отключено', 'no reconnect after user disconnect');
  assert.equal(await text(page, '#btnBtLabel'), 'Подключить');
  await page.click('#tab-cells-btn');
  assert.equal(await visible(page, '#cellsEmpty'), true);
  await done();
});

test('JK 4S: legacy auto-connect to the first granted device; device names are not HTML', async () => {
  const { page, done } = await openApp('?devices=jk:JK-B2A8S20P&granted=1');
  await waitText(page, '#statusBar', 'JK-B2A8S20P · JK');
  await waitText(page, '#voltVal', '13.21');
  assert.equal(await text(page, '#ampVal'), '-5.00');
  assert.equal(await text(page, '#socVal'), '77');
  assert.equal(await count(page, '.cell-card'), 4);
  assert.equal(await text(page, '#tempsSub'), 'T1 25.0 · T2 26.0 · MOS 30.0');
  assert.equal(await text(page, '#cyclesVal'), '12');

  await page.click('#btn-bt');
  await page.click('#btn-reconnect');
  await waitText(page, '#recent-list', /<img src=x/);
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'no script injection from a device name');
  assert.equal(await page.$eval('#recent-list .recent-item button', b => b.disabled), true, 'connected device cannot be added twice');
  await done();
});

test('multiple batteries: switcher, aggregate view, auto-connect of remembered devices', async () => {
  const { page, ctx, done } = await openApp('?devices=jbd:Bat-A,jbd:Bat-B');
  await connectViaPicker(page);
  await waitText(page, '#statusBar', 'Bat-A · JBD');
  await connectViaPicker(page);
  await waitText(page, '#statusBar', 'Bat-B · JBD');
  await waitText(page, '#ampVal', '5.00');
  assert.equal(await visible(page, '#batBar'), true);
  assert.equal(await page.$$eval('#batBar .bat-chip', els => els.map(e => e.querySelector('.name').textContent).join('|')), 'Все · 2|Bat-A|Bat-B');

  await page.click('#batBar .bat-chip >> nth=0');
  await waitText(page, '#statusBar', '2 из 2 на связи');
  await waitText(page, '#ampVal', '-7.34');
  assert.equal(await text(page, '#voltVal'), '53.10');
  assert.equal(await text(page, '#capRemVal'), '110.00');
  assert.equal(await text(page, '#capFullSub'), 'из 150 Ah');
  assert.equal(await text(page, '#socVal'), '73');
  assert.equal(await count(page, '.bat-card'), 2);
  assert.equal(await visible(page, '#cellsSimple'), false);
  await page.click('#tab-chart-btn');
  await waitText(page, '#chartNow', /-?\d/);
  await page.click('#tab-cells-btn');

  await page.click('.bat-card >> nth=0');
  await waitText(page, '#ampVal', '-12.34');
  await waitText(page, '#statusBar', 'Bat-A · JBD');

  // link loss of one battery is visible in the aggregate status
  await page.click('#batBar .bat-chip >> nth=0');
  await page.evaluate(() => window.__mock.devices[1].__drop());
  await waitText(page, '#statusBar', '1 из 2 на связи');
  assert.equal(await page.getAttribute('#connChip', 'data-tone'), 'warn');
  await waitText(page, '#statusBar', '2 из 2 на связи');

  // both are remembered and reconnect after a reload, starting in the aggregate view
  await page.goto(page.url().replace('?', '?granted=1&'));
  await waitText(page, '#statusBar', '2 из 2 на связи');
  await waitText(page, '#ampVal', '-7.34');

  // disconnecting one forgets it
  await page.click('#batBar .bat-chip >> nth=2');
  await page.click('#tab-details-btn');
  await page.click('#btn-disconnect');
  await waitText(page, '#statusBar', 'Bat-A · JBD');
  assert.equal(await visible(page, '#batBar'), false);
  await page.reload();
  await waitText(page, '#statusBar', 'Bat-A · JBD');
  await page.waitForTimeout(500);
  assert.equal(await visible(page, '#batBar'), false, 'forgotten battery is not auto-connected');
  assert.ok(ctx);
  await done();
});

test('session counters: single battery and all batteries', async () => {
  const { page, done } = await openApp('?devices=jbd:Bat-A,jbd:Bat-B');
  await page.click('#btn-close-picker');
  await page.click('#tab-session-btn');
  assert.equal(await visible(page, '#sessionEmpty'), true);
  await connectViaPicker(page);
  await waitText(page, '#statusBar', 'Bat-A · JBD');
  await page.waitForTimeout(3500);
  const ahOut = parseFloat(await text(page, '#sesAhOut'));
  assert.ok(ahOut > 0 && ahOut < 0.05, `discharged ${ahOut} Ah`);
  assert.equal(await text(page, '#sesAhIn'), '0.000 Ah');
  assert.match(await text(page, '#sesAhNet'), /^−0\.0\d\d Ah$/);
  assert.equal(await text(page, '#sesPeakDis'), '656 W · 12.3 A');
  assert.equal(await text(page, '#sesPeakChg'), '—');
  assert.equal(await text(page, '#sesPackV'), '53.20 / 53.20 V');
  assert.equal(await text(page, '#sesSoc'), '80% → 80%');
  assert.equal(await text(page, '#sesCellV'), '3.250 V (#6) / 3.322 V (#3)');
  assert.equal(await text(page, '#sesDelta'), '72 mV');
  assert.equal(await text(page, '#sesTMax'), '26.0 °C');
  assert.match(await text(page, '#sesDuration'), /^\d+ с$/);
  await page.click('#sesReset');
  assert.equal(await text(page, '#sesAhOut'), '0.000 Ah');

  await connectViaPicker(page);
  await waitText(page, '#statusBar', 'Bat-B · JBD');
  await page.click('#batBar .bat-chip >> nth=0');
  await page.waitForTimeout(3000);
  assert.equal(await visible(page, '#sesNote'), true);
  assert.ok(parseFloat(await text(page, '#sesAhIn')) > 0, 'charging battery B counted');
  assert.match(await text(page, '#sesCellV'), /^3\.250 V \(Bat-A #6\) \/ 3\.3\d\d V \(Bat-/);
  assert.equal(await text(page, '#sesSoc'), '73% → 73%', 'aggregate SOC restarts when a battery joins');
  await done();
});

test('localization follows the browser and can be overridden', async () => {
  const en = await openApp('?devices=jbd:xiaoxiang-test', { locale: 'en-US' });
  const page = en.page;
  assert.equal(await page.getAttribute('html', 'lang'), 'en');
  await waitText(page, '#statusBar', 'Not connected');
  assert.equal(await text(page, '#btn-choose'), 'Choose device…');
  assert.equal(await text(page, '#picker-status'), 'Press “Choose device…” (the browser requires a user gesture).');
  await page.click('#btn-choose');
  await waitText(page, '#flowText', 'Discharging');
  await waitText(page, '#etaVal', '6 h 28 m');
  assert.equal(await text(page, '#capFullSub'), 'of 100 Ah');
  assert.equal(await text(page, '#tab-session-btn'), 'Session');
  assert.equal(await text(page, '#btnBtLabel'), 'Add');
  assert.ok((await page.getAttribute('meta[name=description]', 'content')).startsWith('BMS monitor'));
  await page.click('#tab-details-btn');
  assert.equal(await page.$eval('#langSelect option[value=auto]', o => o.textContent), 'Automatic (English)');
  await page.selectOption('#langSelect', 'uk');
  await waitText(page, '#flowText', 'Розряд');
  assert.equal(await text(page, '#statusBar'), 'xiaoxiang-test · JBD');
  assert.equal(await text(page, '#btn-disconnect'), 'Відключити');
  await waitText(page, '#etaVal', '6 год 28 хв');
  await page.reload();
  await waitText(page, '#statusBar', 'Не підключено');
  assert.equal(await page.getAttribute('html', 'lang'), 'uk');
  await page.click('#btn-close-picker');
  await page.click('#tab-details-btn');
  await page.selectOption('#langSelect', 'auto');
  await waitText(page, '#statusBar', 'Not connected');
  await en.done();

  const uk = await openApp('', { locale: 'uk-UA' });
  await waitText(uk.page, '#statusBar', 'Не підключено');
  assert.equal(await text(uk.page, '#tab-cells-btn'), 'Комірки');
  await uk.done();

  const de = await openApp('', { locale: 'de-DE' });
  await waitText(de.page, '#statusBar', 'Not connected');
  assert.equal(await de.page.getAttribute('html', 'lang'), 'en');
  await de.done();
});

test('offline mode: suggestion banner, opt-in, works without the server', async () => {
  // "Not now" is remembered
  const later = await openApp('');
  assert.equal(await visible(later.page, '#offlineBanner'), true, 'banner suggested on first visit');
  await later.page.click('#btn-close-picker');
  await later.page.click('#offlineLater');
  assert.equal(await visible(later.page, '#offlineBanner'), false);
  await later.page.reload();
  await later.page.waitForTimeout(300);
  assert.equal(await visible(later.page, '#offlineBanner'), false, 'not suggested again');
  await later.done();

  // enabling caches the app; it then loads while the server is down
  const own = await startServer();
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 400, height: 860 } });
  const app = await openApp('', { base: own.url, context: ctx });
  const page = app.page;
  await page.click('#btn-close-picker');
  await page.click('#offlineEnable');
  await waitText(page, '#offlineBannerText', 'Готово — приложение работает без интернета.');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), true, 'page is controlled by the service worker');
  assert.equal(await visible(page, '#offlineBanner'), false, 'no banner once enabled');
  await page.click('#btn-close-picker');
  await page.click('#tab-details-btn');
  assert.equal(await page.isChecked('#offlineChk'), true);

  await own.close();
  await page.reload();
  await waitText(page, '#statusBar', 'Не подключено');
  assert.equal(await page.title(), 'Battery monitor — Web Bluetooth');
  await page.click('#btn-close-picker');
  await page.click('#tab-details-btn');
  await page.click('#offlineChk'); // turning it off unregisters the worker and clears the cache
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistrations()).length === 0);
  assert.deepEqual(await page.evaluate(async () => (await caches.keys()).filter(k => k.startsWith('web-bms-'))), []);
  await ctx.close();
});

test('browser without Web Bluetooth', async () => {
  const { page: p, done } = await openApp('?nobt=1');
  await waitText(p, '#statusBar', 'Web Bluetooth не поддерживается — нужен Chrome / Edge');
  assert.equal(await p.$eval('#btn-bt', b => b.disabled), true);
  await done();
});
