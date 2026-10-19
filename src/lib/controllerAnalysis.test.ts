import assert from 'node:assert/strict';
import test from 'node:test';
import { controllerAnalysisEvidence } from './controllerAnalysis.js';
import type { ControllerLogWindow } from '../types.js';

function windowAt(hour: number, updates: Partial<ControllerLogWindow> = {}): ControllerLogWindow {
  const start = new Date(Date.UTC(2026, 9, 1, hour));
  const end = new Date(start.getTime() + 3_600_000);
  return {
    id: String(hour), uid: 'u', source: 'hanna-csv', deviceId: 'pool-1',
    location: null, start, end, startLocal: start.toISOString().slice(0, 19).replace('T', ' '),
    endLocal: end.toISOString().slice(0, 19).replace('T', ' '),
    phMin: null, phMax: null, orpMinMv: null, orpMaxMv: null,
    temperatureMinC: null, temperatureMaxC: null,
    acidBaseMinMl: null, acidBaseMaxMl: null, chlorineMinMl: null, chlorineMaxMl: null,
    importedAt: new Date(), ...updates,
  };
}

test('returns no evidence for an empty range', () => {
  assert.equal(controllerAnalysisEvidence([]), null);
});

test('counts risk windows, dose events and missing observations without inventing zeroes', () => {
  const a = controllerAnalysisEvidence([
    windowAt(0, { phMin: 7.1, phMax: 7.3, orpMinMv: 233, orpMaxMv: 700, temperatureMaxC: 33, chlorineMaxMl: 10 }),
    windowAt(1),
    windowAt(2, { phMin: 7.4, phMax: 7.9, orpMinMv: 701, orpMaxMv: 810, temperatureMaxC: 30 }),
  ]);
  assert.equal(a?.windows, 3);
  assert.equal(a?.measuredWindows, 2);
  assert.equal(a?.phWindowsBelow72, 1);
  assert.equal(a?.phWindowsAbove78, 1);
  assert.equal(a?.orpWindowsBelow650, 1);
  assert.equal(a?.orpWindowsAbove800, 1);
  assert.equal(a?.hotWindowsAbove32, 1);
  assert.equal(a?.doseEventWindows, 1);
  assert.deepEqual(a?.metrics.phMin, { count: 2, min: 7.1, max: 7.4, mean: 7.25 });
});

test('bounds the prompt to a subset even when years of history are selected', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => windowAt(i, { phMin: 6.8, phMax: 8.2 }));
  const a = controllerAnalysisEvidence(rows);
  assert.equal(a?.windows, 1000);
  assert.equal(a?.phWindowsBelow72, 1000);
  assert.equal(a?.samplesAreSubset, true);
  assert.ok((a?.sampleWindows.length ?? 0) <= 70);
});
