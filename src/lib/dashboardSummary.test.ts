import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describePhDrift,
  describeSync,
  getLsiStateWord,
  getRangeStatus,
  getTelemetrySource,
  getTrendGlyph,
  isReadingNominal,
  lsiMarkerPercent,
  startOfIsoWeek,
  summarizeAgentActivity,
  summarizeEquipment,
  summarizeInventory,
  summarizeWeek,
} from './dashboardSummary';
import { EquipmentItem, InventoryItem, Reading } from '../types';

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

const minutesAgo = (now: Date, m: number) => new Date(now.getTime() - m * 60_000);
const daysAgo = (now: Date, d: number) => new Date(now.getTime() - d * 24 * 60 * 60_000);

// A fixed Wednesday midday so week/day arithmetic is deterministic.
const NOW = new Date(2026, 9, 14, 12, 0, 0); // 14 Oct 2026, Wednesday

test('getRangeStatus: outside the range is critical, the outer 10 % is warning, the middle is good', () => {
  assert.equal(getRangeStatus(7.1, 7.2, 7.8), 'critical');
  assert.equal(getRangeStatus(7.9, 7.2, 7.8), 'critical');
  assert.equal(getRangeStatus(7.22, 7.2, 7.8), 'warning');
  assert.equal(getRangeStatus(7.78, 7.2, 7.8), 'warning');
  assert.equal(getRangeStatus(7.5, 7.2, 7.8), 'good');
});

test('getTelemetrySource: untouched auto-sync boilerplate is controller, anything else manual', () => {
  assert.equal(getTelemetrySource(reading({ notes: 'Auto-logged from hanna-cloud' })), 'controller');
  assert.equal(getTelemetrySource(reading({ notes: 'Auto-logged from hanna-cloud\nAdded 1 L acid' })), 'manual');
  assert.equal(getTelemetrySource(reading({})), 'manual');
});

test('describeSync: live within 15 min, stale after, manual shows the entry time', () => {
  assert.deepEqual(describeSync(undefined, NOW), { kind: 'none', label: 'NO DATA' });
  const live = describeSync(reading({ notes: 'Auto-logged from hanna-cloud', timestamp: minutesAgo(NOW, 2) }), NOW);
  assert.deepEqual(live, { kind: 'live', label: 'LIVE · 2 MIN' });
  const stale = describeSync(reading({ notes: 'Auto-logged from hanna-cloud', timestamp: minutesAgo(NOW, 42) }), NOW);
  assert.deepEqual(stale, { kind: 'stale', label: 'STALE · 42 MIN' });
  const old = describeSync(reading({ notes: 'Auto-logged from hanna-cloud', timestamp: minutesAgo(NOW, 180) }), NOW);
  assert.deepEqual(old, { kind: 'stale', label: 'STALE · 3 H' });
  const manual = describeSync(reading({ timestamp: new Date(2026, 9, 14, 9, 12) }), NOW);
  assert.equal(manual.kind, 'manual');
  assert.match(manual.label, /^MANUAL · /);
});

test('getTrendGlyph: compares the two most recent measurements of that field, ignoring nulls in between', () => {
  const rs = [
    reading({ ph: 7.8 }),
    reading({ ph: null }), // controller poll that omitted pH
    reading({ ph: 7.4 }),
  ];
  assert.equal(getTrendGlyph(rs, 'ph'), '↑');
  assert.equal(getTrendGlyph([reading({ ph: 7.4 }), reading({ ph: 7.8 })], 'ph'), '↓');
  assert.equal(getTrendGlyph([reading({ ph: 7.42 }), reading({ ph: 7.4 })], 'ph'), '→'); // within epsilon
  assert.equal(getTrendGlyph([reading({ ph: 7.4 })], 'ph'), null);
  assert.equal(getTrendGlyph([reading({ sanitisationMv: 700 }), reading({ sanitisationMv: 720 })], 'sanitisationMv'), '↓');
});

const equipment = (overrides: Partial<EquipmentItem>): EquipmentItem => ({
  id: 'e', name: 'Sand Filter', installDate: daysAgo(NOW, 400), uid: 'u', ...overrides,
});

test('summarizeEquipment: names the soonest service and counts the overdue ones', () => {
  const lastService = new Date(NOW);
  lastService.setMonth(lastService.getMonth() - 6);
  lastService.setDate(lastService.getDate() + 3); // due in 3 days
  const overdue = new Date(NOW);
  overdue.setMonth(overdue.getMonth() - 13); // 12-month interval → overdue
  const items = [
    equipment({ name: 'Sand Filter', lastServiceDate: lastService, serviceIntervalMonths: 6 }),
    equipment({ id: 'p', name: 'Main Pump', lastServiceDate: overdue, serviceIntervalMonths: 12 }),
    equipment({ id: 'v', name: 'Vacuum' }), // no interval → ignored
  ];
  const s = summarizeEquipment(items, NOW);
  assert.match(s.sub, /^Main Pump service overdue by \d+ d$/);
  assert.deepEqual(s.badge, { text: '1 DUE', status: 'warning' });

  const soon = summarizeEquipment([items[0]], NOW);
  assert.equal(soon.sub, 'Sand Filter service due in 3 d');
  assert.deepEqual(soon.badge, { text: 'OK', status: 'neutral' });

  // Never serviced: the install date is the baseline, so this one is overdue.
  const neverServiced = summarizeEquipment([equipment({ id: 'x', name: 'Main Pump', serviceIntervalMonths: 12 })], NOW);
  assert.match(neverServiced.sub, /^Main Pump service overdue by \d+ d$/);
  assert.deepEqual(neverServiced.badge, { text: '1 DUE', status: 'warning' });

  assert.equal(summarizeEquipment([], NOW).sub, 'No equipment registered');
  assert.equal(summarizeEquipment([items[2]], NOW).sub, 'No service intervals set');
});

const inv = (name: string, quantity: number, minThreshold: number, unit = 'kg'): InventoryItem => ({ id: name, name, quantity, minThreshold, unit, uid: 'u' });

test('summarizeInventory: lists up to two low items with their units, critical badge', () => {
  const s = summarizeInventory([inv('Muriatic Acid', 8, 10, 'L'), inv('Cal-hypo', 4, 5), inv('Soda Ash', 1, 2), inv('Bicarb', 10, 2)]);
  assert.equal(s.sub, 'Muriatic Acid 8 L · Cal-hypo 4 kg · +1 more');
  assert.deepEqual(s.badge, { text: '3 LOW', status: 'critical' });
  const ok = summarizeInventory([inv('Bicarb', 10, 2)]);
  assert.equal(ok.sub, '1 item above reorder level');
  assert.deepEqual(ok.badge, { text: 'STOCKED', status: 'neutral' });
});

test('startOfIsoWeek: Monday 00:00 local, including when today is Sunday', () => {
  assert.equal(startOfIsoWeek(NOW).getDay(), 1);
  assert.equal(startOfIsoWeek(NOW).getDate(), 12);
  const sunday = new Date(2026, 9, 18, 10);
  assert.equal(startOfIsoWeek(sunday).getDate(), 12);
});

test('isReadingNominal: null when nothing measured, false on any out-of-range field, ORP via its own bands', () => {
  assert.equal(isReadingNominal(reading({})), null);
  assert.equal(isReadingNominal(reading({ ph: 7.4, chlorine: 2 })), true);
  assert.equal(isReadingNominal(reading({ ph: 7.4, chlorine: 0.4 })), false);
  assert.equal(isReadingNominal(reading({ sanitisationMv: 700 })), true);
  assert.equal(isReadingNominal(reading({ sanitisationMv: 600 })), false);
});

test('summarizeWeek: counts Monday-to-today days with readings and how many stayed nominal', () => {
  const mon = new Date(2026, 9, 12, 9);
  const tue = new Date(2026, 9, 13, 9);
  const wed = new Date(2026, 9, 14, 9);
  const s = summarizeWeek([
    reading({ timestamp: mon, ph: 7.4 }),
    reading({ timestamp: tue, ph: 7.9 }), // out of range
    reading({ timestamp: tue, ph: 7.4 }),
    reading({ timestamp: wed }), // no measurements → not counted
    reading({ timestamp: daysAgo(NOW, 10), ph: 9 }), // last week → ignored
  ], NOW);
  assert.equal(s.daysWithReadings, 2);
  assert.equal(s.daysNominal, 1);
  assert.equal(s.sub, 'Mon–Wed · 1 of 2 days nominal');
  assert.deepEqual(s.badge, { text: 'READY', status: 'good' });

  const empty = summarizeWeek([], NOW);
  assert.equal(empty.sub, 'Mon–Wed · no readings logged yet');
  assert.equal(empty.badge.status, 'neutral');

  const monday = summarizeWeek([reading({ timestamp: mon, ph: 7.4 })], new Date(2026, 9, 12, 12));
  assert.equal(monday.sub, 'Mon · 1 of 1 day nominal');
});

test('describePhDrift: least-squares slope per day over 7 days, steady under the threshold', () => {
  const rising = [0, 1, 2, 3].map((d) => reading({ timestamp: daysAgo(NOW, 3 - d), ph: 7.2 + d * 0.1 }));
  assert.equal(describePhDrift(rising, NOW), 'pH drifting +0.1 / day since Sun');
  const falling = [0, 1, 2].map((d) => reading({ timestamp: daysAgo(NOW, 2 - d), ph: 7.6 - d * 0.05 }));
  assert.equal(describePhDrift(falling, NOW), 'pH drifting −0.05 / day since Mon');
  const steady = [0, 1, 2].map((d) => reading({ timestamp: daysAgo(NOW, 2 - d), ph: 7.4 }));
  assert.equal(describePhDrift(steady, NOW), 'pH steady over 7 d');
  assert.equal(describePhDrift([reading({ ph: 7.4 })], NOW), 'Open 7-day charts');
  // Three points inside one day is a comparison, not a trend.
  const sameDay = [0, 1, 2].map((h) => reading({ timestamp: minutesAgo(NOW, h * 60), ph: 7.2 + h * 0.2 }));
  assert.equal(describePhDrift(sameDay, NOW), 'Open 7-day charts');
});

test('summarizeAgentActivity: only photo-backed (MCP) readings count, live within 24 h', () => {
  const none = summarizeAgentActivity([reading({ ph: 7.4 })], NOW);
  assert.deepEqual(none, { readingsToday: 0, lastAt: null, live: false, sub: 'No agent activity yet' });

  const today = summarizeAgentActivity([
    reading({ photoUrl: 'https://x/1', timestamp: minutesAgo(NOW, 30) }),
    reading({ photoUrl: 'https://x/2', timestamp: minutesAgo(NOW, 90) }),
    reading({ timestamp: minutesAgo(NOW, 5) }),
  ], NOW);
  assert.equal(today.readingsToday, 2);
  assert.equal(today.live, true);
  assert.equal(today.sub, 'Agents logged 2 readings today');

  const old = summarizeAgentActivity([reading({ photoUrl: 'https://x/1', timestamp: daysAgo(NOW, 3) })], NOW);
  assert.equal(old.readingsToday, 0);
  assert.equal(old.live, false);
  assert.equal(old.sub, 'Last agent reading 72h ago');
});

test('lsiMarkerPercent maps −0.5…+0.5 onto 0…100 and clamps', () => {
  assert.equal(lsiMarkerPercent(0), 50);
  assert.equal(lsiMarkerPercent(0.18), 68);
  assert.equal(lsiMarkerPercent(-0.9), 0);
  assert.equal(lsiMarkerPercent(1.2), 100);
});

test('getLsiStateWord', () => {
  assert.equal(getLsiStateWord(-0.05), 'Balanced');
  assert.equal(getLsiStateWord(0.18), 'Scale Tendency');
  assert.equal(getLsiStateWord(-0.3), 'Corrosive');
});
