import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, sessionAddSummary, sessionAddCells, SESSION_MAX_GAP_MS } from '../../js/session.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('constant charge current integrates to Ah and Wh', () => {
  const s = createSession(0);
  for (let t = 0; t <= 3600; t++) sessionAddSummary(s, { v: 50, i: 10, soc: 50 }, t * 1000);
  close(s.ahIn, 10); close(s.whIn, 500); assert.equal(s.ahOut, 0);
  assert.equal(s.peakChgA, 10); assert.equal(s.peakChgW, 500);
});

test('discharge goes to the out counters, trapezoid between samples', () => {
  const s = createSession(0);
  sessionAddSummary(s, { v: 50, i: -10 }, 0);
  sessionAddSummary(s, { v: 50, i: -20 }, 18000); // 18 s, average 15 A → 0.075 Ah
  close(s.ahOut, 0.075); close(s.whOut, 3.75); assert.equal(s.ahIn, 0);
  assert.equal(s.peakDisA, 20); assert.equal(s.peakDisW, 1000);
});

test('gaps longer than the limit are not integrated', () => {
  const s = createSession(0);
  sessionAddSummary(s, { v: 50, i: 10 }, 0);
  sessionAddSummary(s, { v: 50, i: 10 }, SESSION_MAX_GAP_MS + 1);
  assert.equal(s.ahIn, 0);
  sessionAddSummary(s, { v: 50, i: 10 }, SESSION_MAX_GAP_MS + 1 + 3600);
  close(s.ahIn, 0.01);
});

test('extremes: pack voltage, SOC, temperatures, cells', () => {
  const s = createSession(0);
  sessionAddSummary(s, { v: 52, i: 1, soc: 70, temps: [20, 22, NaN] }, 0);
  sessionAddSummary(s, { v: 54, i: 1, soc: 72, temps: [35] }, 1000);
  sessionAddSummary(s, { v: 53, i: 1, soc: 71 }, 2000);
  assert.equal(s.vMin, 52); assert.equal(s.vMax, 54);
  assert.equal(s.socStart, 70); assert.equal(s.socNow, 71); assert.equal(s.tMax, 35);
  sessionAddCells(s, [3.30, 3.25, 0, 3.32]);
  sessionAddCells(s, [3.31, 3.28, 0, 3.34]);
  assert.equal(s.cellMin, 3.25); assert.equal(s.cellMinIdx, 1);
  assert.equal(s.cellMax, 3.34); assert.equal(s.cellMaxIdx, 3);
  close(s.deltaMaxMv, 70);
});
