/* Fake navigator.bluetooth for the e2e suite. Runs in the page before the app; relies on the frame
   builders from tests/fixtures/frames.mjs, which the runner inlines in front of this file.
   URL params: devices=jbd:Name,jk:Name (ids dev-0, dev-1, …), granted=1 (getDevices returns them), nobt=1,
   wave=1 (JBD current follows a smooth time-based curve — used for README screenshots). */
(() => {
  const params = new URLSearchParams(location.search);
  if (params.has('nobt')) return;

  const PRESETS = {
    jbd: [
      { hw: { v: 5320, i: -1234, rem: 8000, full: 10000, cycles: 42, soc: 80, temps: [25, 26] },
        cells: Array.from({ length: 16 }, (_, i) => i === 5 ? 3250 : 3320 + (i % 3)),
        counters: [2, 0, 1, 5, 3, 0, 0, 0, 0, 0, 1] },
      { hw: { v: 5300, i: 500, rem: 3000, full: 5000, cycles: 7, soc: 60, temps: [30, 31] },
        cells: Array.from({ length: 16 }, () => 3312) },
    ],
    jk: [ { frame: {}, uptime: 3 * 86400 + 3600, logbook: [
      { ts: 600, code: 0x01 }, { ts: 86400 + 120, code: 0x1D }, { ts: 86400 + 900, code: 0x1E },
      { ts: 2 * 86400 + 30, code: 0x15 }, { ts: 3 * 86400 + 1800, code: 0x16 },
    ] } ],
  };
  const used = { jbd: 0, jk: 0 };
  const wave = params.has('wave');
  /* why: на скриншотах график должен быть живым; ток зависит только от Date.now(), поэтому кадры воспроизводимы */
  function liveHw(hw, phase){
    if (!wave) return hw;
    const t = Date.now() / 1000;
    const i = Math.round(hw.i + Math.abs(hw.i) * 0.45 * Math.sin(t / 55 + phase) + Math.abs(hw.i) * 0.15 * Math.sin(t / 9 + phase * 3));
    return { ...hw, i };
  }
  const mock = window.__mock = { writes: 0, devices: [], registerWrites: [] };

  class Chr extends EventTarget {
    constructor(onWrite){ super(); this.properties = { write: true, writeWithoutResponse: true, notify: true }; this.onWrite = onWrite; this.value = null; }
    async startNotifications(){ return this; }
    async stopNotifications(){ return this; }
    async writeValueWithoutResponse(f){ mock.writes++; setTimeout(() => this.onWrite(Array.from(f)), 5); }
    async writeValueWithResponse(f){ return this.writeValueWithoutResponse(f); }
    async writeValue(f){ return this.writeValueWithoutResponse(f); }
    emit(bytes){
      for (const part of chunks(bytes, 20)){
        this.value = new DataView(new Uint8Array(part).buffer);
        this.dispatchEvent(new Event('characteristicvaluechanged'));
      }
    }
  }

  function makeDevice(kind, name, id){
    const phase = used[kind];
    const preset = PRESETS[kind][used[kind]++ % PRESETS[kind].length];
    const dev = new EventTarget();
    dev.name = name; dev.id = id;
    let notify, ctrl;
    if (kind === 'jbd'){
      let factory = false;
      notify = new Chr(() => {});
      ctrl = new Chr(f => {
        if (!dev.gatt.connected) return;
        if (f[1] === 0x5A){ // register write: 0x00 ← 0x5678 enters factory mode, 0x01 leaves it
          mock.registerWrites.push([f[2], ...f.slice(4, 4 + f[3])]);
          if (f[2] === 0x00) factory = f[4] === 0x56 && f[5] === 0x78;
          if (f[2] === 0x01) factory = false;
          notify.emit(jbdWriteAck(f[2]));
          return;
        }
        if (f[2] === 0x03) notify.emit(jbdHwInfo(liveHw(preset.hw, phase)));
        if (f[2] === 0x04) notify.emit(jbdCells(preset.cells));
        // why: строгая прошивка отдаёт счётчики только в заводском режиме — проверяем этот путь
        if (f[2] === 0xAA) notify.emit(factory ? jbdCounters(preset.counters || []) : jbdCounters([], 0x80));
      });
    } else {
      notify = ctrl = new Chr(f => {
        if (!dev.gatt.connected) return;
        if (f[4] === 0x96) notify.emit(jk02(wave ? { ...preset.frame, currentMa: liveHw({ i: -5000 }, phase).i } : preset.frame));
        if (f[4] === 0x97) notify.emit(jkDeviceInfo({ uptime: preset.uptime }));
        if (f[4] === 0xA1) notify.emit(jkLogbook(preset.logbook));
      });
    }
    const svc = kind === 'jbd' ? '0000ff00-0000-1000-8000-00805f9b34fb' : '0000ffe0-0000-1000-8000-00805f9b34fb';
    const server = {
      connected: false, device: dev,
      async connect(){ server.connected = true; return server; },
      disconnect(){ if (!server.connected) return; server.connected = false; setTimeout(() => dev.dispatchEvent(new Event('gattserverdisconnected')), 0); },
      async getPrimaryService(uuid){
        if (uuid !== svc) throw new DOMException('no service', 'NotFoundError');
        return { async getCharacteristic(c){ return c.startsWith('0000ff02') ? ctrl : notify; } };
      },
    };
    dev.gatt = server;
    dev.__drop = () => server.disconnect(); // simulates losing the radio link
    return dev;
  }

  (params.get('devices') || 'jbd:xiaoxiang-test').split(',').forEach((spec, i) => {
    const [kind, name] = spec.split(':');
    mock.devices.push(makeDevice(kind, name || kind, `dev-${i}`));
  });
  const evil = makeDevice('jbd', '<img src=x onerror="window.__xss=1">', 'evil-id');
  let next = 0;
  Object.defineProperty(navigator, 'bluetooth', { value: {
    async requestDevice(){ return mock.devices[next++ % mock.devices.length]; },
    async getDevices(){ return params.get('granted') ? [...mock.devices, evil] : []; },
    async getAvailability(){ return true; },
  } });
})();
