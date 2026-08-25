import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTrendPoints, filterReadingsFrom, getOptimalValue } from './trends';
import { Reading } from '../types';

const reading = (id: string, timestamp: string, ph: number | null): Reading => ({
  id,
  timestamp: new Date(timestamp),
  chlorine: null,
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
