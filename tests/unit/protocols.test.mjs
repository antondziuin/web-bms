import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jbdBuildRead, makeJbdFramer, parseJbdFrame, jbdErrors, jkBuildCmd, makeJkFramer, parseJkFrame, parseJk02, parseJk04, sumCrc } from '../../js/protocols.js';
import { jbdHwInfo, jbdCells, jbdVersion, jbdFrame, jk02, jkSettings, jkDeviceInfo, chunks, le16 } from '../fixtures/frames.mjs';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
function collect(makeFramer, parts){
  const out = [];
  const push = makeFramer(f => out.push(f));
  for (const p of parts) push(Uint8Array.from(p));
  return out;
}

test('JBD read request bytes', () => {
  assert.deepEqual([...jbdBuildRead(0x03)], [0xDD, 0xA5, 0x03, 0x00, 0xFF, 0xFD, 0x77]);
  assert.deepEqual([...jbdBuildRead(0x04)], [0xDD, 0xA5, 0x04, 0x00, 0xFF, 0xFC, 0x77]);
});

test('JBD basic info is parsed', () => {
  const p = parseJbdFrame(jbdHwInfo({ v: 5320, i: -1234, rem: 8000, full: 10000, cycles: 42, soc: 80, temps: [25, 26, 30] }));
  close(p.totalV, 53.2); close(p.current, -12.34); close(p.capRem, 80); close(p.capFull, 100);
  assert.equal(p.cycles, 42); assert.equal(p.soc, 80); assert.equal(p.balancing, true); assert.equal(p.errors, 'OK');
  close(p.temp1, 25); close(p.temp2, 26); close(p.tmos, 30);
});

test('JBD protection bits are named', () => {
  assert.equal(parseJbdFrame(jbdHwInfo({ prot: 0b10 })).errors, 'Cell undervoltage');
  assert.equal(jbdErrors(0b1000000001), 'Cell overvoltage; Discharging overcurrent');
});

test('JBD cells and version frames', () => {
  const p = parseJbdFrame(jbdCells([3300, 3310, 3250]));
  assert.deepEqual(p.cells.map(v => Math.round(v * 1000)), [3300, 3310, 3250]);
  assert.equal(parseJbdFrame(jbdVersion('JBD-SP04S034')).model, 'JBD-SP04S034');
});

test('JBD frame with non-zero status is ignored', () => {
  assert.equal(parseJbdFrame(jbdFrame(0x03, new Array(27).fill(0), 0x80)), null);
});

test('JBD framer reassembles chunks, skips junk and bad checksums', () => {
  const good = jbdHwInfo(), cells = jbdCells([3300, 3301]);
  const bad = jbdCells([3300, 3301]); bad[bad.length - 2] ^= 0xff;
  const stream = [0x00, 0x13, ...bad, ...good, ...cells];
  const frames = collect(makeJbdFramer, chunks(stream, 7));
  assert.equal(frames.length, 2);
  assert.equal(frames[0][1], 0x03);
  assert.equal(frames[1][1], 0x04);
});

test('JK command frame has the right header and checksum', () => {
  const f = jkBuildCmd(0x96);
  assert.deepEqual([...f.slice(0, 6)], [0xAA, 0x55, 0x90, 0xEB, 0x96, 0x00]);
  assert.equal(f.length, 20);
  assert.equal(f[19], sumCrc(f, 19));
});

test('JK02 24S: small 4S pack is accepted (regression)', () => {
  const p = parseJkFrame(jk02({ cells: [3300, 3301, 3302, 3303], currentMa: -5000, soc: 77 }));
  assert.equal(p.cells.filter(v => v > 0).length, 4);
  close(p.totalV, 13.206); close(p.current, -5); assert.equal(p.soc, 77);
  close(p.temp1, 25); close(p.temp2, 26); close(p.tmos, 30);
  close(p.capRem, 76); close(p.capFull, 100); assert.equal(p.cycles, 12);
  assert.equal(p.balancing, true); assert.equal(p.errors, 'OK');
});

test('JK02 24S: 20-cell pack keeps all cells', () => {
  const cells = Array.from({ length: 20 }, (_, i) => 3300 + i);
  const p = parseJkFrame(jk02({ cells }));
  assert.equal(p.cells.filter(v => v > 0).length, 20);
});

test('JK02 32S layout: values come from the shifted offsets', () => {
  const cells = Array.from({ length: 26 }, () => 3400);
  const p = parseJkFrame(jk02({ layout: 32, cells, currentMa: 12000, tmos: 415, errMask: 1 << 3, soc: 55 }));
  assert.equal(p.cells.filter(v => v > 0).length, 26);
  close(p.totalV, 88.4); close(p.current, 12); close(p.tmos, 41.5); assert.equal(p.soc, 55);
  assert.equal(p.errors, 'Cell Undervoltage');
});

test('JK02 rejects pack voltage that disagrees with the cell sum', () => {
  assert.equal(parseJk02(jk02({ cells: [3300, 3300, 3300, 3300], totalMv: 26400 }), 0), null);
});

test('JK04 parser rejects garbage', () => {
  assert.equal(parseJk04(jk02({ cells: [3300, 3301, 3302, 3303] })), null);
});

test('JK settings and device info', () => {
  const s = parseJkFrame(jkSettings({ uvp: 2800, ovp: 3650, soc100: 3450, soc0: 2900 }));
  assert.deepEqual([s.cfgUvpMv, s.cfgOvpMv, s.cfgSoc100mV, s.cfgSoc0mV], [2800, 3650, 3450, 2900]);
  assert.equal(parseJkFrame(jkDeviceInfo()).model, 'JK_B2A8S20P · HW 11.XW · SW 11.26');
});

test('JK framer: chunked frames, back-to-back frames, resync after corruption', () => {
  const a = jk02(), b = jkSettings();
  const corrupt = jk02(); corrupt[200] ^= 0x55;
  const stream = [1, 2, 3, ...corrupt.slice(0, 150), ...a, ...b, ...le16(0)];
  const frames = collect(makeJkFramer, chunks(stream, 20));
  assert.deepEqual(frames.map(f => f[4]), [0x02, 0x01]);
  assert.equal(frames[0].length, 300);
});
