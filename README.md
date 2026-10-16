<h1 align="center">
  <img src="icon.svg" width="72" alt=""><br>
  web-bms
</h1>

<p align="center">
  Battery monitor for <b>JK</b> and <b>JBD</b> (Xiaoxiang) BMS over <b>Web Bluetooth</b> — a static web page, no app to install.
</p>

<p align="center">
  <a href="https://antondziuin.github.io/web-bms/"><b>Open the app →</b></a>
  &nbsp;·&nbsp;
  <b>English</b> · <a href="README.uk.md">Українська</a> · <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <a href="https://github.com/antondziuin/web-bms/actions/workflows/pages.yml"><img src="https://github.com/antondziuin/web-bms/actions/workflows/pages.yml/badge.svg" alt="Deploy to GitHub Pages"></a>
  <a href="https://github.com/antondziuin/web-bms/actions/workflows/test.yml"><img src="https://github.com/antondziuin/web-bms/actions/workflows/test.yml/badge.svg" alt="Tests"></a>
</p>

<p align="center">
  <img src="docs/screenshots/desktop-dark-en.png" width="880" alt="Two batteries in the “All” view: summed power, current and capacity, and the power chart with a tooltip">
</p>

## Features

- **Live dashboard** — SOC ring, power, charging / discharging / idle, time to full or empty
- **Pack details** — voltage, current, remaining and full capacity, cell imbalance, temperatures (T1 / T2 / MOS), cycles, balancing, BMS errors
- **Cells** — up to 32 cell voltages with a min / avg / max summary; the lowest and highest cells are highlighted
- **Multiple batteries at once** — battery switcher and an “All” view: total power and energy (packs of different voltages, e.g. 4S next to 14S, add up correctly), energy-weighted SOC and time estimate, summed current and Ah for parallel packs, an overview card per battery; every connected battery reconnects automatically next time
- **Session counters** — charged / discharged (Ah, Wh), net, peak charge and discharge, pack and cell voltage extremes, SOC at start and now, max temperature and imbalance
- **Charts** — power, current, voltage and SOC for the last 1000 samples, with a hover / tap tooltip
- **BMS memory** — reads what the BMS itself stores: the **JK event log** (boots, protections and their release, MOSFET switching — last 50 entries, dated from the BMS run time) and the **JBD protection counters** (short circuit, over/undervoltage, overcurrent, temperature); CSV export
- **BMS parameters** (view only) — protection thresholds with their release values, delays, balancing and battery settings: JK sends them on connect, JBD settings are read from the BMS memory on request; nothing is written
- **Log in the browser** — records every battery at a chosen interval (5 s – 1 min) and keeps 7 days on the device; view it on the page as a chart and a table, download CSV (Excel) or JSON, open a saved file later; optional raw BLE frame capture for troubleshooting
- **Works offline** (opt-in) — the app offers to save itself on the device, then opens without a network and can be installed to the home screen
- **Reliable link** — automatic reconnection when the Bluetooth link drops; optional “keep screen on”
- **Light and dark themes**, responsive layout from 320 px phones to desktops
- **English, Ukrainian and Russian** UI, picked from the browser language (can be changed in *Details*)

## Screenshots

<table>
  <tr>
    <td align="center" width="33%"><img src="docs/screenshots/phone-overview-en.png" width="250" alt="Phone, dark theme: all batteries"><br><sub>All batteries</sub></td>
    <td align="center" width="33%"><img src="docs/screenshots/phone-session-en.png" width="250" alt="Phone, light theme: session counters"><br><sub>Session counters</sub></td>
    <td align="center" width="33%"><img src="docs/screenshots/phone-chart-en.png" width="250" alt="Phone, light theme: current chart"><br><sub>Current chart</sub></td>
  </tr>
</table>

<table>
  <tr>
    <td align="center" width="50%"><img src="docs/screenshots/desktop-light-en.png" alt="Desktop, light theme: one battery with its 16 cell voltages"><br><sub>One battery, light theme</sub></td>
    <td align="center" width="50%"><img src="docs/screenshots/desktop-log-en.png" alt="Log tab: event log read from a JK BMS and the log recorded in the browser"><br><sub>BMS event log and the browser log</sub></td>
  </tr>
</table>

## Getting started

1. Open **https://antondziuin.github.io/web-bms/** in **Chrome** or **Edge** (Windows, Mac or Android; for iPhone and iPad see [below](#iphone-ipad-and-mac)).
2. Press **Connect** → **Choose device…** and pick your BMS in the system dialog. If a PIN is requested, it is usually `123456`.
3. To watch several packs, press **Add** and pick the next BMS; the **All** chip shows them combined.
4. To use the app without internet, accept the **Work offline** suggestion (or turn it on later in *Details → Settings*).
5. **Log** tab: **Read from BMS** shows the log / counters stored in the BMS; below is the log this browser records while a BMS is connected.

Firefox does not support Web Bluetooth. Web Bluetooth needs HTTPS or `http://localhost`.

### iPhone, iPad and Mac

- **iPhone and iPad.** Apple does not support Web Bluetooth: Safari, and also Chrome, Edge and Firefox for iOS (they all run on the Safari engine), cannot connect to a BMS. Use the [Bluefy](https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055) browser from the App Store: open **https://antondziuin.github.io/web-bms/** in it and press **Connect**. If the page is opened in Safari, the app shows this hint with a link to Bluefy.
- **Limits on iPhone and iPad.** iOS pauses the page when the screen turns off or you switch to another app, so the link to the BMS drops: keep Bluefy open on the screen. Bluefy supports less than Chrome: if it cannot list recent devices, pick the BMS in the list each time.
- **Mac.** Chrome and Edge on macOS support Web Bluetooth; Safari does not. On the first connection macOS asks to allow Bluetooth for the browser; if it was denied, turn it on in *System Settings → Privacy & Security → Bluetooth*.

## Development

```sh
npm install
npm start          # http://localhost:8080
```

### Tests

```sh
npm test           # ESLint + unit tests + browser tests
npm run test:unit  # JK/JBD protocols, model, session counters, dictionaries (node:test)
npm run test:e2e   # the app in headless Chromium with a Bluetooth mock (Playwright)
```

- The browser tests replace `navigator.bluetooth` with an emulator that sends byte-accurate JBD and JK frames (`tests/fixtures/frames.mjs`) and cover connecting, displayed values, multiple batteries, sessions, reconnection, localization and offline mode.
- A **layout test** opens every view at 320, 390, 768 and 1280 px in all three languages and fails if any text spills out of its container, gets cut off, or makes the page scroll sideways.
- Before the first run on your machine: `npx playwright install chromium`.
- GitHub Actions runs the tests on every pull request, and GitHub Pages is deployed only after they pass.

### Screenshots

`npm run screenshots` regenerates `docs/screenshots/` from the Bluetooth emulator with a simulated clock, so the images are reproducible.

### Project layout

| File | Purpose |
| --- | --- |
| `index.html`, `css/styles.css` | markup and styles |
| `js/protocols.js` | JK / JBD frame parsing (no DOM, unit-tested) |
| `js/ble.js` | BLE drivers on top of GATT |
| `js/model.js`, `js/session.js` | battery state, multi-battery aggregate, session counters |
| `js/chart.js`, `js/i18n.js`, `js/offline.js` | chart, translations, offline mode |
| `js/bmsmemory.js` | JK event log / JBD protection counters read from the BMS |
| `js/bmssettings.js` | BMS parameters (protections, balancing), view only |
| `js/log.js`, `js/logformat.js`, `js/logstore.js` | browser log: recording (IndexedDB), viewer, CSV / JSON |
| `js/app.js` | battery manager and UI |
| `sw.js` | service worker (registered only after the user opts in) |
| `tests/` | unit, browser and layout tests, Bluetooth emulator, screenshot script |

### Credits

The JK event-log command (`0xA1`), its frame layout and event names follow
[syssi/esphome-jk-bms](https://github.com/syssi/esphome-jk-bms) (Apache-2.0). The JBD protection counters
(register `0xAA`) follow the published JBD BMS communication protocol.

### Deploying

`.github/workflows/pages.yml` runs the tests and deploys to GitHub Pages on every push to `main` (or manually: *Actions → Deploy to GitHub Pages → Run workflow*). Pages has to be enabled once: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
