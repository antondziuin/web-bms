/* Fake navigator.bluetooth for the e2e suite. Runs in the page before the app; relies on the frame
   builders from tests/fixtures/frames.mjs, which the runner inlines in front of this file.
   URL params: devices=jbd:Name,jk:Name (ids dev-0, dev-1, …), granted=1 (getDevices returns them), nobt=1. */
(() => {
  const params = new URLSearchParams(location.search);
  if (params.has('nobt')) return;

  const PRESETS = {
    jbd: [
      { hw: { v: 5320, i: -1234, rem: 8000, full: 10000, cycles: 42, soc: 80, temps: [25, 26] },
        cells: Array.from({ length: 16 }, (_, i) => i === 5 ? 3250 : 3320 + (i % 3)) },
      { hw: { v: 5300, i: 500, rem: 3000, full: 5000, cycles: 7, soc: 60, temps: [30, 31] },
        cells: Array.from({ length: 16 }, () => 3312) },
    ],
    jk: [ { frame: {} } ],
  };
  const used = { jbd: 0, jk: 0 };
  const mock = window.__mock = { writes: 0, devices: [] };

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
    const preset = PRESETS[kind][used[kind]++ % PRESETS[kind].length];
    const dev = new EventTarget();
    dev.name = name; dev.id = id;
    let notify, ctrl;
    if (kind === 'jbd'){
      notify = new Chr(() => {});
      ctrl = new Chr(f => {
        if (!dev.gatt.connected) return;
        if (f[2] === 0x03) notify.emit(jbdHwInfo(preset.hw));
        if (f[2] === 0x04) notify.emit(jbdCells(preset.cells));
      });
    } else {
      notify = ctrl = new Chr(f => { if (dev.gatt.connected && f[4] === 0x96) notify.emit(jk02(preset.frame)); });
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
