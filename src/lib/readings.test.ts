import assert from 'node:assert/strict';
import test from 'node:test';
import { getLatestReadingForDisplay } from './readings';
import { Reading } from '../types';

function reading(overrides: Partial<Reading>): Reading {
  return {
    id: 'id',
    timestamp: new Date(),
    chlorine: null,
    totalChlorine: null,
    sanitisationMv: null,
    ph: null,
    alkalinity: null,
    temperature: null,
    differentialPressure: null,
    calciumHardness: null,
    cyanuricAcid: null,
    uid: 'uid-1',
    ...overrides,
  };
}

test('returns undefined for an empty history', () => {
  assert.equal(getLatestReadingForDisplay([]), undefined);
});

test('returns the latest reading unchanged when it already has alkalinity and calciumHardness', () => {
  const latest = reading({ id: 'latest', alkalinity: 90, calciumHardness: 220 });
  const result = getLatestReadingForDisplay([latest, reading({ id: 'older', alkalinity: 100, calciumHardness: 250 })]);
  assert.deepEqual(result, latest);
});

test('backfills alkalinity and calciumHardness from the most recent reading that has them', () => {
  const latest = reading({ id: 'latest', ph: 7.4, sanitisationMv: 650, temperature: 28 }); // controller-only reading
  const older = reading({ id: 'older', alkalinity: 90, calciumHardness: 220 });
  const result = getLatestReadingForDisplay([latest, older]);

  assert.equal(result?.id, 'latest'); // still "is" the latest reading, just backfilled
  assert.equal(result?.alkalinity, 90);
  assert.equal(result?.calciumHardness, 220);
  assert.equal(result?.ph, 7.4);
  assert.equal(result?.sanitisationMv, 650);
});

test('never backfills chlorine, totalChlorine, cyanuricAcid, or differentialPressure', () => {
  const latest = reading({ id: 'latest' });
  const older = reading({ id: 'older', chlorine: 2.1, totalChlorine: 2.3, cyanuricAcid: 40, differentialPressure: 5 });
  const result = getLatestReadingForDisplay([latest, older]);

  assert.equal(result?.chlorine, null);
  assert.equal(result?.totalChlorine, null);
  assert.equal(result?.cyanuricAcid, null);
  assert.equal(result?.differentialPressure, null);
});

test('does not mutate the original readings array', () => {
  const latest = reading({ id: 'latest' });
  const older = reading({ id: 'older', alkalinity: 90, calciumHardness: 220 });
  getLatestReadingForDisplay([latest, older]);

  assert.equal(latest.alkalinity, null);
  assert.equal(latest.calciumHardness, null);
});

test('backfills each field independently from whichever earlier reading has it', () => {
  const latest = reading({ id: 'latest', alkalinity: 95 }); // has alkalinity but not calciumHardness
  const older = reading({ id: 'older', calciumHardness: 240 });
  const result = getLatestReadingForDisplay([latest, older]);

  assert.equal(result?.alkalinity, 95); // kept from latest, not overwritten
  assert.equal(result?.calciumHardness, 240); // backfilled
});

test('backfills from a value within the staleness window', () => {
  const now = new Date('2026-09-19T12:00:00.000Z');
  const latest = reading({ id: 'latest', timestamp: now });
  const twentyNineDaysAgo = reading({ id: 'recentish', timestamp: new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000), alkalinity: 90, calciumHardness: 220 });
  const result = getLatestReadingForDisplay([latest, twentyNineDaysAgo]);

  assert.equal(result?.alkalinity, 90);
  assert.equal(result?.calciumHardness, 220);
});

test('does not backfill from a value older than the staleness window — e.g. from before a drain/refill', () => {
  const now = new Date('2026-09-19T12:00:00.000Z');
  const latest = reading({ id: 'latest', timestamp: now });
  const sixMonthsAgo = reading({ id: 'ancient', timestamp: new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000), alkalinity: 90, calciumHardness: 220 });
  const result = getLatestReadingForDisplay([latest, sixMonthsAgo]);

  assert.equal(result?.alkalinity, null);
  assert.equal(result?.calciumHardness, null);
});

test('skips a stale value and backfills from a more recent one within the window instead', () => {
  const now = new Date('2026-09-19T12:00:00.000Z');
  const latest = reading({ id: 'latest', timestamp: now });
  const fiveDaysAgo = reading({ id: 'fresh', timestamp: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), alkalinity: 95, calciumHardness: 230 });
  const sixMonthsAgo = reading({ id: 'ancient', timestamp: new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000), alkalinity: 90, calciumHardness: 220 });
  const result = getLatestReadingForDisplay([latest, fiveDaysAgo, sixMonthsAgo]);

  assert.equal(result?.alkalinity, 95);
  assert.equal(result?.calciumHardness, 230);
});
