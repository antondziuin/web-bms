import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, applyUpdate, powerW, estimateEta, estimateFullCapacityAh, aggregateStates, getCellScaleMv, cellDeltaMv } from '../../js/model.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const withState = (o) => Object.assign(createState(), o);

test('applyUpdate merges only finite values and reports what changed', () => {
  const s = createState();
  let r = applyUpdate(s, { totalV: 53.2, current: -10, soc: 80 }, 1000);
  assert.deepEqual(r, { summary: true, cells: false });
  r = applyUpdate(s, { cells: [3.3, 3.31], totalV: NaN }, 2000);
  assert.deepEqual(r, { summary: false, cells: true });
  assert.equal(s.totalV, 53.2);
  assert.equal(s.lastSummaryTs, 1000); assert.equal(s.lastCellsTs, 2000);
  close(powerW(s), -532);
  close(cellDeltaMv(s), 10);
});

test('ETA modes', () => {
  assert.deepEqual(estimateEta(withState({ current: -10, capRem: 50 })), { mode: 'discharge', hours: 5 });
  assert.equal(estimateEta(withState({ current: 0, capRem: 50 })).mode, 'idle');
  assert.deepEqual(estimateEta(withState({ current: 10, capRem: 50, capFull: 100, soc: 50 })), { mode: 'charge', hours: 5 });
  assert.deepEqual(estimateEta(withState({ current: 10, capRem: 100, soc: 100 })), { mode: 'charge', hours: 0 });
  assert.equal(estimateEta(withState({ current: 1 })).mode, null);
});

test('full capacity: from BMS, otherwise estimated from SOC', () => {
  assert.equal(estimateFullCapacityAh(withState({ capFull: 100, capRem: 50 })), 100);
  close(estimateFullCapacityAh(withState({ capRem: 50, soc: 25 })), 200);
  assert.ok(Number.isNaN(estimateFullCapacityAh(withState({ capRem: 50 }))));
});

test('cell scale falls back from SOC voltages to protection voltages to defaults', () => {
  assert.deepEqual(getCellScaleMv(withState({ cfgSoc0mV: 2900, cfgSoc100mV: 3450 })), [2900, 3450]);
  assert.deepEqual(getCellScaleMv(withState({ cfgUvpMv: 2800, cfgOvpMv: 3650 })), [2800, 3650]);
  assert.deepEqual(getCellScaleMv(createState()), [2900, 4200]);
});

test('aggregate of parallel packs', () => {
  const a = withState({ totalV: 53.2, current: -12.34, capRem: 80, capFull: 100, soc: 80, temp1: 25, lastSummaryTs: 1 });
  const b = withState({ totalV: 53.0, current: 5, capRem: 30, capFull: 50, soc: 60, temp1: 31, tmos: 40, balancing: true, lastSummaryTs: 2 });
  const agg = aggregateStates([a, b]);
  close(agg.totalV, 53.1); close(agg.current, -7.34); close(agg.capRem, 110); close(agg.capFull, 150);
  close(agg.soc, 110 / 150 * 100);
  assert.equal(agg.temp1, 31); assert.equal(agg.tmos, 40); assert.equal(agg.balancing, true);
  assert.equal(agg.lastSummaryTs, 2);
});

test('aggregate ignores packs without data', () => {
  const a = withState({ totalV: 13.2, current: 2, capRem: 50, capFull: 100, lastSummaryTs: 5 });
  const agg = aggregateStates([a, createState()]);
  close(agg.totalV, 13.2); close(agg.current, 2); close(agg.soc, 50);
  assert.equal(aggregateStates([createState()]).lastSummaryTs, 0);
});
