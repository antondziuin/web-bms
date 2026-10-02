/* Layout regression test: no text may spill out of its container, get cut off, or make the page
   scroll sideways — across phone/tablet/desktop widths, all UI languages and the main UI states.
   The check itself lives in layout-audit.js (evaluated in the page). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer, ROOT } from '../serve.mjs';

const MOCK = fs.readFileSync(path.join(ROOT, 'tests/fixtures/frames.mjs'), 'utf8').replace(/^export /gm, '')
  + '\n' + fs.readFileSync(path.join(ROOT, 'tests/e2e/mock-bluetooth.js'), 'utf8');
const AUDIT = fs.readFileSync(path.join(ROOT, 'tests/e2e/layout-audit.js'), 'utf8');
const VIEWPORTS = [[320, 640], [390, 844], [768, 1024], [1280, 860]];
const LOCALES = ['en-US', 'ru-RU', 'uk-UA'];
const LONG_NAME = 'JK-B2A24S20P-Garage-Left-Rack';

let server, browser;
before(async () => { server = await startServer(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); await server?.close(); });

async function auditPage(page, label, found){
  for (const i of await page.evaluate(AUDIT)) found.push(`${label}: ${i.type} ${i.where} — ${i.detail}`);
}

for (const locale of LOCALES){
  test(`layout fits at every width (${locale})`, async () => {
    const found = [];
    for (const [width, height] of VIEWPORTS){
      const at = `${width}px`;
      // empty page with the offline suggestion, then the picker with a hostile long device name
      let ctx = await browser.newContext({ locale, viewport: { width, height } });
      await ctx.addInitScript(MOCK);
      let page = await ctx.newPage();
      await page.goto(server.url + `index.html?devices=jbd:${LONG_NAME}&granted=1`);
      await page.waitForSelector('#statusBar');
      await page.waitForTimeout(300);
      await page.click('#btn-bt');
      await page.click('#btn-reconnect');
      await page.waitForSelector('#recent-list .recent-item');
      await auditPage(page, `${at} picker`, found);
      await ctx.close();

      ctx = await browser.newContext({ locale, viewport: { width, height } });
      await ctx.addInitScript(MOCK);
      page = await ctx.newPage();
      await page.goto(server.url + 'index.html?devices=jbd:Bat-B');
      await page.click('#btn-close-picker');
      await auditPage(page, `${at} empty`, found);

      // three batteries: long-named JBD, JBD, JK — every view and tab
      await page.goto(server.url + `index.html?devices=jbd:${LONG_NAME},jbd:Bat-B,jk:JK-4S`);
      for (let n = 1; n <= 3; n++){
        if (!(await page.evaluate(() => document.getElementById('dlg-picker').open))) await page.click('#btn-bt');
        await page.click('#btn-choose');
        await page.waitForFunction(k => document.querySelectorAll('#batBar .bat-chip').length === (k > 1 ? k + 1 : 0)
          && !document.getElementById('dlg-picker').open, n);
      }
      await page.waitForTimeout(1500); // sessions and charts get a few samples
      for (let chip = 0; chip < 4; chip++){
        await page.click(`#batBar .bat-chip >> nth=${chip}`);
        for (const tab of ['cells', 'chart', 'session', 'log', 'details']){
          await page.click(`#tab-${tab}-btn`);
          if (tab === 'log' && chip > 0 && await page.isVisible('#memRead')){
            await page.click('#memRead');
            await page.waitForSelector('#memResult:not([hidden]), #memStatus:not([hidden])', { timeout: 8000 });
          }
          await page.waitForTimeout(60);
          await auditPage(page, `${at} battery#${chip} ${tab}`, found);
        }
      }
      await page.evaluate(() => window.__mock.devices[0].__drop());
      await page.click('#batBar .bat-chip >> nth=0');
      await page.click('#tab-cells-btn');
      await page.waitForTimeout(100);
      await auditPage(page, `${at} reconnecting`, found);
      await ctx.close();
    }
    assert.deepEqual([...new Set(found)], [], 'layout problems');
  });
}
