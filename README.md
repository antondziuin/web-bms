# web-bms

**English** · [Русский](README.ru.md)

Battery monitor for **JK** and **JBD** (Xiaoxiang) BMS over **Web Bluetooth** — a static web page, no build step.

**Live:** https://antondziuin.github.io/web-bms/

## Features

- SOC ring gauge, power, mode (charging / discharging / idle) and time to full or empty
- Voltage, current, remaining and full capacity, cell imbalance, temperatures (T1/T2/MOS), cycles
- Cell voltages (up to 32) with a min / avg / max summary and the extreme cells highlighted
- **Multiple batteries at once**: battery switcher and an "All" view — summed current,
  power and capacity, capacity-weighted SOC, overview of every battery; all connected
  batteries reconnect automatically next time the page is opened
- **Session counters**: charged / discharged (Ah, Wh), net, peak charge and discharge,
  pack and cell voltage min/max, SOC at start and now, max temperature and imbalance; reset
- Power, current, voltage and SOC charts (last 1000 points) with a hover/tap tooltip
- "Details" tab: device info, settings, raw data with a copy button
- **Offline mode** (opt-in): the app offers to save itself on the device and then opens
  without a network; it can be installed to the home screen
- Light and dark themes (follow the system), responsive layout for phones and desktops
- English, Russian and Ukrainian UI: the language follows the browser settings and can be
  changed manually in the "Details" tab
- Automatic reconnection when the link drops
- Optional: keep the screen on

## Requirements

- Chrome / Edge (desktop or Android). Firefox and Safari do not support Web Bluetooth;
  on iOS the Bluefy browser can be used.
- HTTPS (GitHub Pages) or `http://localhost`.

## Run locally

```sh
npm install
npm start          # http://localhost:8080
```

## Tests

```sh
npm test           # ESLint + unit tests + browser tests
npm run test:unit  # JK/JBD protocols, model, session counters, dictionaries (node:test)
npm run test:e2e   # the app in headless Chromium with a Bluetooth mock (Playwright)
```

The browser tests replace `navigator.bluetooth` with an emulator that sends byte-accurate
JBD and JK frames (`tests/fixtures/frames.mjs`) and check connecting, displayed values,
multiple batteries, sessions, reconnection, localization and offline mode.
Before the first run on your machine: `npx playwright install chromium`.

GitHub Actions runs the tests on every pull request (`.github/workflows/test.yml`),
and GitHub Pages is deployed only after the tests pass.

## Project layout

| File | Purpose |
| --- | --- |
| `index.html`, `css/styles.css` | markup and styles |
| `js/protocols.js` | JK / JBD frame parsing (no DOM, covered by unit tests) |
| `js/ble.js` | BLE drivers on top of GATT |
| `js/model.js`, `js/session.js` | battery state, multi-battery aggregate, session counters |
| `js/chart.js`, `js/i18n.js`, `js/offline.js` | chart, translations, offline mode |
| `js/app.js` | battery manager and UI |
| `sw.js` | service worker (registered only after the user opts in) |

## Deploying to GitHub Pages

The `.github/workflows/pages.yml` workflow deploys on every push to `main`
(or manually: *Actions → Deploy to GitHub Pages → Run workflow*).

Pages has to be enabled once: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
