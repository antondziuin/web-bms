/* E2E: "BMS parameters" on the Details tab — JK settings arrive by themselves on connect,
   JBD settings are read from EEPROM in factory mode, which is left without saving. */
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

async function openApp(query, locale = 'uk-UA'){
  const ctx = await browser.newContext({ locale, viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript("try{ localStorage.setItem('ui:offline', '0'); }catch{}");
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(server.url + 'index.html' + query);
  return { ctx, page, errors };
}
async function connect(page, kind){
  if (!(await page.evaluate(() => document.getElementById('dlg-picker').open))) await page.click('#btn-bt');
  await page.click('#btn-choose');
  await page.waitForFunction(k => !document.getElementById('dlg-picker').open
    && document.getElementById('statusBar').textContent.includes(k), kind);
}
const kv = (page) => page.$$eval('#bsetGroups dd', dds => Object.fromEntries(dds.map(dd => [dd.dataset.key, dd.textContent])));
const titles = (page) => page.$$eval('#bsetGroups .bset-title', els => els.map(e => e.textContent));

test('JK: parameters from the settings frame, without reading anything', async () => {
  const { ctx, page, errors } = await openApp('?devices=jk:JK-B2A8S20P');
  await connect(page, 'JK');
  await page.click('#tab-details-btn');
  await page.waitForSelector('#bsetGroups dd');
  assert.match(await page.textContent('#bsetSub'), /передає їх під час підключення/);
  assert.equal(await page.isVisible('#bsetRead'), false, 'nothing to read: JK sends the settings itself');
  assert.deepEqual(await titles(page), ['Напруга', 'Струм', 'Температура', 'Балансування', 'Батарея']);
  const v = await kv(page);
  assert.equal(v.cellOvp, '3.650 Vвідновлення 3.550 V');
  assert.equal(v.cellUvp, '2.800 Vвідновлення 2.900 V');
  assert.equal(v.chgOc, '100 Aзатримка 30 сповтор через 60 с');
  assert.equal(await page.$$eval('dd[data-key=chgOc] .rel', e => e.length), 2, 'each note on its own line');
  assert.equal(v.chgUt, '-5 °Cвідновлення 3 °C');
  assert.equal(v.balTrigger, '10 mV');
  assert.equal(v.designCap, '280 Ah');
  assert.equal(v.dsgSwitch, 'увімк.');
  assert.equal(v.rcv, undefined, 'values the BMS does not report are not shown');
  assert.equal(await page.textContent('dt:has(+ dd[data-key=cellOvp])'), 'Перенапруга комірки');
  // language switch re-labels the section
  await page.selectOption('#langSelect', 'en');
  await page.waitForFunction(() => document.querySelector('#bsetGroups .bset-title').textContent === 'Voltage');
  assert.equal((await kv(page)).dsgSwitch, 'on');
  assert.deepEqual(await page.evaluate(() => window.__mock.registerWrites), []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('JBD: read on request in factory mode, left without saving; hidden in the "All" view', async () => {
  const { ctx, page, errors } = await openApp('?devices=jbd:Bat-A,jbd:Bat-B', 'ru-RU');
  await connect(page, 'JBD');
  await page.click('#tab-details-btn');
  assert.match(await page.textContent('#bsetSub'), /режим настройки; настройки не меняются/);
  assert.equal(await page.$$eval('#bsetGroups dd', d => d.length), 0, 'nothing until read');
  await page.click('#bsetRead');
  await page.waitForSelector('#bsetGroups dd');
  assert.match(await page.textContent('#bsetStatus'), /^считано в \d\d:\d\d:\d\d$/);
  const v = await kv(page);
  assert.equal(v.cellOvp, '3.650 Vвозврат 3.500 V');
  assert.equal(v.packUvp, '40.00 Vвозврат 43.20 V');
  assert.equal(v.dsgOc, '100 A');
  assert.equal(v.dsgUt, '-20 °Cвозврат -10 °C');
  assert.equal(v.balChgOnly, 'вкл.');
  assert.equal(v.cellCount, '16');
  assert.deepEqual(await page.evaluate(() => window.__mock.registerWrites), [[0x00, 0x56, 0x78], [0x01, 0x00, 0x00]],
    'factory mode entered (0x5678) and left without saving (0x0000)');
  const writes = await page.evaluate(() => window.__mock.writes);
  await page.waitForTimeout(1500);
  assert.ok(await page.evaluate(() => window.__mock.writes) > writes, 'regular polling resumes');

  await connect(page, 'Bat-B · JBD');
  await page.click('#batBar .bat-chip >> nth=0');
  await page.waitForFunction(() => document.getElementById('bsetSub').textContent.startsWith('Выберите одну батарею'));
  assert.equal(await page.isVisible('#bsetRead'), false);
  assert.equal(await page.$$eval('#bsetGroups dd', d => d.length), 0);
  await page.click('#batBar .bat-chip >> nth=1');
  await page.waitForSelector('#bsetGroups dd');
  assert.deepEqual(errors, []);
  await ctx.close();
});
