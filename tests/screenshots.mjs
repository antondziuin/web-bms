/* Regenerates the README screenshots in docs/screenshots/ (npm run screenshots).
   Uses the e2e Bluetooth mock in "wave" mode and Playwright's fake clock, so every run produces
   the same data and timestamps: ten minutes of history are simulated in a second. */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer, ROOT } from './serve.mjs';

const OUT = path.join(ROOT, 'docs/screenshots');
const MOCK = fs.readFileSync(path.join(ROOT, 'tests/fixtures/frames.mjs'), 'utf8').replace(/^export /gm, '')
  + '\n' + fs.readFileSync(path.join(ROOT, 'tests/e2e/mock-bluetooth.js'), 'utf8');
const START = new Date('2026-10-02T14:20:00');
const HIDE_OFFLINE_BANNER = "try{ localStorage.setItem('ui:offline', '0'); }catch{}";

const LANGS = { en: 'en-US', ru: 'ru-RU' };
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 680 };

fs.mkdirSync(OUT, { recursive: true });
const server = await startServer();
const browser = await chromium.launch();

/* Opens the app with two JBD packs connected and `minutes` of simulated history. */
async function setup({ locale, viewport, scale, scheme, minutes = 10 }){
  // reducedMotion: no CSS transitions caught half-way in a screenshot
  const ctx = await browser.newContext({ locale, viewport, deviceScaleFactor: scale, colorScheme: scheme, reducedMotion: 'reduce' });
  await ctx.addInitScript(HIDE_OFFLINE_BANNER);
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  await page.clock.install({ time: START });
  await page.goto(server.url + 'index.html?wave=1&devices=jbd:House-A,jbd:House-B');
  for (let n = 0; n < 2; n++){
    if (!(await page.evaluate(() => document.getElementById('dlg-picker').open))) await page.click('#btn-bt');
    await page.click('#btn-choose');
    await page.clock.runFor(1500);
  }
  await page.clock.runFor(minutes * 60_000);
  return { ctx, page };
}
async function show(page, { battery, tab, metric, scrollTo }){
  await page.click(`#batBar .bat-chip >> nth=${battery}`);
  await page.click(`#tab-${tab}-btn`);
  if (metric) await page.click(`#chartMetric [data-metric=${metric}]`);
  await page.clock.runFor(1200); // let the 1 s ticker and renders settle
  // place the section right under the sticky header
  if (scrollTo) await page.locator(scrollTo).evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - document.querySelector('.topbar').offsetHeight - 10));
  else await page.evaluate(() => window.scrollTo(0, 0));
}
async function hoverChart(page, at = 0.72){
  const box = await page.locator('#chart').boundingBox();
  await page.mouse.move(box.x + box.width * at, box.y + box.height * 0.45);
}
async function shoot(page, name){
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('  ' + path.relative(ROOT, path.join(OUT, name)));
}

for (const [lang, locale] of Object.entries(LANGS)){
  console.log(lang);
  // Desktop, dark: "All" view with the power chart
  let { ctx, page } = await setup({ locale, viewport: DESKTOP, scale: 1, scheme: 'dark' });
  await show(page, { battery: 0, tab: 'chart', metric: 'w' });
  await hoverChart(page);
  await shoot(page, `desktop-dark-${lang}.png`);
  // Desktop, light: one battery, cells
  await page.emulateMedia({ colorScheme: 'light' });
  await page.mouse.move(0, 0);
  await show(page, { battery: 1, tab: 'cells' });
  await shoot(page, `desktop-light-${lang}.png`);
  await ctx.close();

  // Phone, dark: overview of all batteries
  ({ ctx, page } = await setup({ locale, viewport: PHONE, scale: 2, scheme: 'dark' }));
  await show(page, { battery: 0, tab: 'cells' });
  await shoot(page, `phone-overview-${lang}.png`);
  // Phone, light: session counters and the current chart
  await page.emulateMedia({ colorScheme: 'light' });
  await show(page, { battery: 0, tab: 'session', scrollTo: '.panel-card' });
  await shoot(page, `phone-session-${lang}.png`);
  await show(page, { battery: 1, tab: 'chart', metric: 'i', scrollTo: '.panel-card' });
  await hoverChart(page, 0.6);
  await shoot(page, `phone-chart-${lang}.png`);
  await ctx.close();
}

await browser.close();
await server.close();
