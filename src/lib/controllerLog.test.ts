import assert from 'node:assert/strict';
import test from 'node:test';
import {
  controllerLogFromDoc, devicesByRecency, findGaps, formatRange, formatSince, isDose, metricRange, sortWindows, windowGrade, windowsInRange,
} from './controllerLog';
import { ControllerLogWindow } from '../types';

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 14, 12, 0, 0);

function win(i: number, overrides: Partial<ControllerLogWindow> = {}): ControllerLogWindow {
  const start = new Date(T0 + i * H);
  return {
    id: `uid_dev_${i}`, uid: 'uid', source: 'hanna-csv', deviceId: 'dev', location: null,
    startLocal: '2026-10-14 12:00:00', endLocal: '2026-10-14 12:45:00',
    start, end: new Date(start.getTime() + 45 * 60_000),
    phMin: 7.4, phMax: 7.5, orpMinMv: 700, orpMaxMv: 710, temperatureMinC: 28, temperatureMaxC: 29,
    acidBaseMinMl: 0, acidBaseMaxMl: 0, chlorineMinMl: 0, chlorineMaxMl: 0,
    importedAt: new Date(T0 + 100 * H),
    ...overrides,
  };
}

test('controllerLogFromDoc restores Timestamp-like fields and treats non-numbers as null', () => {
  const ts = (ms: number) => ({ toDate: () => new Date(ms) });
  const w = controllerLogFromDoc({
    id: 'a', uid: 'u', source: 'hanna-csv', deviceId: 'd', location: 'Joy Lane', startLocal: 's', endLocal: 'e',
    start: ts(T0), end: ts(T0 + H), importedAt: ts(T0 + 2 * H),
    phMin: 7.4, phMax: null, orpMinMv: 'x', orpMaxMv: 700,
  });
  assert.equal(w.start.getTime(), T0);
  assert.equal(w.importedAt.getTime(), T0 + 2 * H);
  assert.equal(w.phMax, null);
  assert.equal(w.orpMinMv, null);
  assert.equal(w.orpMaxMv, 700);
  assert.equal(w.temperatureMinC, null);
});

test('sortWindows orders by the measured instant, not the local text', () => {
  const a = win(2, { startLocal: '2026-10-25 01:12:00' });
  const b = win(1, { startLocal: '2026-10-25 01:12:00' });
  assert.deepEqual(sortWindows([a, b]).map((w) => w.id), [b.id, a.id]);
});

test('devicesByRecency puts the device with the newest window first', () => {
  const ws = [win(0, { deviceId: 'old' }), win(5, { deviceId: 'new' }), win(3, { deviceId: 'old' })];
  assert.deepEqual(devicesByRecency(ws), ['new', 'old']);
});

test('windowsInRange measures back from the latest window, not from now', () => {
  const ws = Array.from({ length: 100 }, (_, i) => win(i)); // 100 hourly windows
  const last48 = windowsInRange(ws, '48h');
  assert.equal(last48.length, 48);
  assert.equal(last48[last48.length - 1].id, ws[99].id);
  assert.equal(windowsInRange(ws, 'all').length, 100);
  assert.deepEqual(windowsInRange([], '7d'), []);
});

test('metricRange collapses a missing end and returns null when both are missing', () => {
  assert.deepEqual(metricRange(win(0), 'ph'), [7.4, 7.5]);
  assert.deepEqual(metricRange(win(0, { phMin: null }), 'ph'), [7.5, 7.5]);
  assert.equal(metricRange(win(0, { orpMinMv: null, orpMaxMv: null }), 'orp'), null);
});

test('findGaps flags missing time beyond 1.5x the usual spacing', () => {
  const ws = [win(0), win(1), win(2), win(5), win(6)];
  const gaps = findGaps(ws);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].from.getTime(), ws[2].end.getTime());
  assert.equal(gaps[0].to.getTime(), ws[3].start.getTime());
  assert.deepEqual(findGaps([win(0), win(1), win(2), win(3)]), []);
});

test('isDose spots either pump running', () => {
  assert.equal(isDose(win(0)), false);
  assert.equal(isDose(win(0, { acidBaseMaxMl: 120 })), true);
  assert.equal(isDose(win(0, { chlorineMaxMl: 50 })), true);
});

test('windowGrade uses the shared import tiers: watch 7.6–7.8, warning beyond', () => {
  assert.equal(windowGrade(win(0), 'ph'), null);
  assert.equal(windowGrade(win(0, { phMax: 7.7 }), 'ph')?.level, 'watch');
  assert.equal(windowGrade(win(0, { phMin: 7.1, phMax: 7.7 }), 'ph')?.level, 'warning');
  assert.equal(windowGrade(win(0, { orpMinMv: 600 }), 'orp')?.level, 'warning');
  assert.equal(windowGrade(win(0, { orpMaxMv: 780 }), 'orp'), null);
  assert.equal(windowGrade(win(0, { temperatureMaxC: 38 }), 'temperature'), null);
});

test('formatSince switches to days after 48 hours', () => {
  const now = new Date(T0);
  assert.equal(formatSince(new Date(T0 - 30_000), now), 'just now');
  assert.equal(formatSince(new Date(T0 - 5 * 60_000), now), '5m ago');
  assert.equal(formatSince(new Date(T0 - 3 * H), now), '3h ago');
  assert.equal(formatSince(new Date(T0 - 72 * H), now), '3 days ago');
});

test('formatRange shows a single value when min equals max', () => {
  assert.equal(formatRange([7.5, 7.5], 'ph'), '7.50');
  assert.equal(formatRange([700, 712], 'orp'), '700–712 mV');
  assert.equal(formatRange(null, 'temperature'), 'No data');
});
