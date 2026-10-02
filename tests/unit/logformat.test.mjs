import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRecord, recordPoint, toCsv, toJson, parseLogFile, parseCsvRows, downsample, devicesOf } from '../../js/logformat.js';
import { createState } from '../../js/model.js';

const state = Object.assign(createState(), {
  totalV: 53.2, current: -12.345678, soc: 80, capRem: 80, capFull: 100, temp1: 25, temp2: 26.04, tmos: NaN,
  balancing: true, errors: 'Cell undervoltage', cells: [3.3, 3.25, 0, 3.32],
});

test('makeRecord rounds values, keeps only real cells, maps NaN to null', () => {
  const r = makeRecord(state, 'dev-1', 'House, A', 1000);
  assert.deepEqual(r, { t: 1000, dev: 'dev-1', name: 'House, A', v: 53.2, i: -12.346, soc: 80, rem: 80, full: 100,
    t1: 25, t2: 26, tm: null, bal: 1, err: 'Cell undervoltage', cells: [3300, 3250, 3320] });
  const p = recordPoint(r);
  assert.equal(Math.round(p.w * 10) / 10, -656.8);
  assert.equal(p.d, 70); assert.equal(p.tc, 26);
  assert.equal(makeRecord(createState(), 'x', 'x', 1).err, '');
});

test('CSV round trip, including commas and quotes in names', () => {
  const recs = [makeRecord(state, 'dev-1', 'House, "A"', Date.UTC(2026, 9, 2, 12)), makeRecord({ ...state, cells: [] }, 'dev-2', 'B', Date.UTC(2026, 9, 2, 12, 0, 10))];
  const csv = toCsv(recs);
  const rows = parseCsvRows(csv);
  assert.equal(rows[0][0], 'time');
  assert.ok(rows[0].includes('cell03_V'));
  assert.equal(rows.length, 3);
  const back = parseLogFile(csv);
  assert.equal(back.length, 2);
  assert.equal(back[0].name, 'House, "A"');
  assert.deepEqual(back[0].cells, [3300, 3250, 3320]);
  assert.equal(back[0].v, 53.2); assert.equal(back[0].err, 'Cell undervoltage');
  assert.deepEqual(back[1].cells, []);
  assert.deepEqual([...devicesOf(back).keys()], ['dev-1', 'dev-2']);
});

test('JSON round trip and validation', () => {
  const recs = [makeRecord(state, 'd', 'n', 2000), makeRecord(state, 'd', 'n', 1000)];
  const back = parseLogFile(toJson(recs));
  assert.deepEqual(back.map(r => r.t), [1000, 2000], 'sorted by time');
  assert.throws(() => parseLogFile('{"format":"other","records":[]}'), /not a web-bms JSON log/);
  assert.throws(() => parseLogFile('a,b\n1,2'), /not a web-bms CSV log/);
  assert.throws(() => parseLogFile(toJson([])), /no records/);
});

test('downsample averages into buckets and keeps gaps', () => {
  const pts = [];
  for (let t = 0; t < 3600e3; t += 1000) pts.push({ t, v: 50, i: t < 1800e3 ? 10 : -10, w: null, soc: null, d: null, tc: null });
  for (let t = 7200e3; t < 7300e3; t += 1000) pts.push({ t, v: 52, i: 0, w: null, soc: null, d: null, tc: null });
  const { points, bucketMs } = downsample(pts, 100);
  assert.ok(points.length <= 100);
  assert.ok(bucketMs > 0);
  assert.equal(points[0].v, 50); assert.equal(points[0].i, 10);
  assert.equal(points.at(-1).v, 52);
  const gap = points.findIndex((p, k) => k && p.t - points[k - 1].t > 3000e3);
  assert.ok(gap > 0, 'the one-hour gap survives');
  assert.equal(downsample(pts.slice(0, 10), 100).points.length, 10);
});
