import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTrendPoints,
  filterReadingsFrom,
  getOptimalValue,
  getTrendWindowStart,
  isTrendRange,
} from './trends';
import { Reading } from '../types';

const reading = (id: string, timestamp: string, ph: number | null): Reading => ({
  id,
  timestamp: new Date(timestamp),
  chlorine: null,
  totalChlorine: null,
  sanitisationMv: null,
  ph,
  alkalinity: null,
  temperature: null,
  differentialPressure: null,
  calciumHardness: null,
  cyanuricAcid: null,
  uid: 'test-user',
});

test('uses the midpoint of the configured target as the optimal trend', () => {
  assert.equal(getOptimalValue('sanitisationMv'), 700);
  assert.equal(getOptimalValue('ph'), 7.5);
});

test('keeps readings on or after a reset without deleting earlier evidence', () => {
  const readings = [
    reading('before', '2026-01-01T08:00:00Z', 8.1),
    reading('after', '2026-01-02T08:00:00Z', 7.4),
  ];
  assert.deepEqual(filterReadingsFrom(readings, new Date('2026-01-02T00:00:00Z')).map(({ id }) => id), ['after']);
  assert.equal(readings.length, 2);
});

test('shows an optimal guide even before a new actual reading is logged', () => {
  const points = buildTrendPoints([], 'ph', () => 'date', new Date('2026-01-01T00:00:00Z'));
  assert.equal(points.length, 2);
  assert.ok(points.every((point) => point.actual === null && point.optimal === 7.5));
});

test('superimposes abnormal actual readings without filtering them out', () => {
  const points = buildTrendPoints([reading('low', '2026-01-01T00:00:00Z', 6.5)], 'ph', () => 'date');
  assert.equal(points[0].actual, 6.5);
  assert.equal(points[0].optimalMin, 7.2);
});

const NOW = new Date('2026-01-15T12:00:00Z');

test('each day range starts exactly N days before now when there is no reset', () => {
  assert.equal(getTrendWindowStart('4d', null, NOW)?.toISOString(), '2026-01-11T12:00:00.000Z');
  assert.equal(getTrendWindowStart('7d', null, NOW)?.toISOString(), '2026-01-08T12:00:00.000Z');
  assert.equal(getTrendWindowStart('14d', null, NOW)?.toISOString(), '2026-01-01T12:00:00.000Z');
});

test('all time has no window of its own and falls back to the reset', () => {
  assert.equal(getTrendWindowStart('all', null, NOW), null);
  const resetAt = new Date('2025-06-01T00:00:00Z');
  assert.equal(getTrendWindowStart('all', resetAt, NOW), resetAt);
});

test('a reset inside the window wins; an older reset is overridden by the window', () => {
  const recentReset = new Date('2026-01-14T00:00:00Z');
  assert.equal(getTrendWindowStart('7d', recentReset, NOW), recentReset);
  const oldReset = new Date('2025-12-01T00:00:00Z');
  assert.equal(getTrendWindowStart('7d', oldReset, NOW)?.toISOString(), '2026-01-08T12:00:00.000Z');
});

test('a reading exactly on the window start is included, one just before is not', () => {
  const readings = [
    reading('edge', '2026-01-11T12:00:00Z', 7.4),
    reading('outside', '2026-01-11T11:59:59Z', 7.4),
    reading('inside', '2026-01-14T08:00:00Z', 7.4),
  ];
  const kept = filterReadingsFrom(readings, getTrendWindowStart('4d', null, NOW)).map(({ id }) => id);
  assert.deepEqual(kept, ['edge', 'inside']);
});

test('only known ranges pass the stored-value guard', () => {
  assert.ok(isTrendRange('14d'));
  assert.ok(isTrendRange('all'));
  assert.ok(!isTrendRange('30d'));
  assert.ok(!isTrendRange(null));
});
