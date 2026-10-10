/* Visitor counter: loaded only on the real site and only online, hidden while offline.
   The app is served under a fake public host (routed to the local server), the counter script is stubbed. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer, ROOT } from '../serve.mjs';

const MOCK = fs.readFileSync(path.join(ROOT, 'tests/fixtures/frames.mjs'), 'utf8').replace(/^export /gm, '')
  + '\n' + fs.readFileSync(path.join(ROOT, 'tests/e2e/mock-bluetooth.js'), 'utf8');
const HOST = 'https://web-bms.test/';
// stub of s4u.js: renders the widget next to its own <script>, like the real one
const STUB = `const s = document.currentScript, w = document.createElement('a');
  w.id = 's4u-widget'; w.textContent = '42'; s.after(w);`;

let server, browser;
before(async () => { server = await startServer(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); await server?.close(); });

async function openSite({ offline = false } = {}){
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 400, height: 860 } });
  const counterRequests = [], errors = [];
  await ctx.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'www.stats4u.net'){ counterRequests.push(url.href); return route.fulfill({ contentType: 'text/javascript', body: STUB }); }
    if (url.origin + '/' === HOST) return route.fulfill({ response: await route.fetch({ url: server.url + url.pathname.slice(1) + url.search }) });
    return route.abort();
  });
  await ctx.addInitScript(MOCK);
  if (offline) await ctx.addInitScript(() => Object.defineProperty(Object.getPrototypeOf(navigator), 'onLine', { get: () => false }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HOST + 'index.html');
  await page.waitForSelector('#statusBar');
  return { ctx, page, counterRequests, errors };
}

test('counter is shown online and hidden while offline', async () => {
  const { ctx, page, counterRequests, errors } = await openSite();
  await page.waitForSelector('#counter #s4u-widget');
  assert.equal(await page.isVisible('#counter'), true);
  assert.deepEqual(counterRequests, ['https://www.stats4u.net/s4u.js']);
  assert.equal(await page.$eval('#counter script', s => `${s.dataset.id}/${s.dataset.style}`), '7078659379/904');

  await ctx.setOffline(true);
  await page.waitForFunction(() => document.getElementById('counter').hidden);
  await ctx.setOffline(false);
  await page.waitForFunction(() => !document.getElementById('counter').hidden);
  assert.equal(counterRequests.length, 1, 'loaded once');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('counter is not loaded when the app starts offline', async () => {
  const { ctx, page, counterRequests, errors } = await openSite({ offline: true });
  await page.waitForTimeout(500);
  assert.equal(await page.isVisible('#counter'), false);
  assert.equal(await page.$('#counter script'), null);
  assert.deepEqual(counterRequests, []);
  assert.deepEqual(errors, []);
  await ctx.close();
});
