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
  close(powerW(agg), 53.2 * -12.34 + 53.0 * 5);
  close(agg.soc, (80 * 53.2 + 30 * 53.0) / (100 * 53.2 + 50 * 53.0) * 100); // weighted by energy
  assert.equal(agg.temp1, 31); assert.equal(agg.tmos, 40); assert.equal(agg.balancing, true);
  assert.equal(agg.lastSummaryTs, 2);
});

test('aggregate of packs with different voltages: power is the sum of pack powers', () => {
  // two 4S packs charging at ~300 W each, a 14S pack idle: the system takes 600 W, not avgV × ΣI ≈ 1100 W
  const a = withState({ totalV: 14.0, current: 300 / 14, capRem: 50, capFull: 100, soc: 50, lastSummaryTs: 1 });
  const b = withState({ totalV: 14.0, current: 300 / 14, capRem: 50, capFull: 100, soc: 50, lastSummaryTs: 1 });
  const c = withState({ totalV: 50.0, current: 0, capRem: 80, capFull: 100, soc: 80, lastSummaryTs: 1 });
  const agg = aggregateStates([a, b, c]);
  close(powerW(agg), 600);
  assert.ok(Number.isNaN(agg.totalV) && Number.isNaN(agg.current), 'no average voltage / summed current across buses');
  assert.ok(Number.isNaN(agg.capRem) && Number.isNaN(agg.capFull), 'Ah of different voltages do not add up');
  close(agg.energyRemWh, 50 * 14 * 2 + 80 * 50); close(agg.energyFullWh, 100 * 14 * 2 + 100 * 50);
  close(agg.soc, 5400 / 7800 * 100);
  assert.deepEqual(estimateEta(agg), { mode: 'charge', hours: (7800 - 5400) / 600 });
  const dis = aggregateStates([withState({ ...a, current: -10 }), c]);
  close(powerW(dis), -140);
  assert.deepEqual(estimateEta(dis), { mode: 'discharge', hours: (700 + 4000) / 140 });
  assert.equal(estimateEta(aggregateStates([withState({ ...a, current: 0 }), c])).mode, 'idle');
});

test('aggregate: a pack that lost its link keeps its energy but not its current', () => {
  const a = withState({ totalV: 53.2, current: -10, capRem: 80, capFull: 100, lastSummaryTs: 1 });
  const b = withState({ totalV: 53.0, current: 20, capRem: 30, capFull: 50, lastSummaryTs: 2 });
  const agg = aggregateStates([a, b], s => s !== b);
  close(agg.current, -10); close(powerW(agg), -532); close(agg.capRem, 110);
});

test('aggregate ignores packs without data', () => {
  const a = withState({ totalV: 13.2, current: 2, capRem: 50, capFull: 100, lastSummaryTs: 5 });
  const agg = aggregateStates([a, createState()]);
  close(agg.totalV, 13.2); close(agg.current, 2); close(agg.soc, 50);
  assert.equal(aggregateStates([createState()]).lastSummaryTs, 0);
});
