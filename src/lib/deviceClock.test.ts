import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeDeviceClock,
  isCanonicalTimeZone,
  parseUtcOffset,
  resolveDeviceClockChoice,
  wallClockOffsets,
  zoneOffsetMinutesAt,
} from './deviceClock';

const asUtc = (s: string) => Date.parse(`${s}Z`);

test('zoneOffsetMinutesAt follows daylight saving', () => {
  assert.equal(zoneOffsetMinutesAt(asUtc('2026-07-01T12:00:00'), 'Europe/London'), 60);
  assert.equal(zoneOffsetMinutesAt(asUtc('2026-12-01T12:00:00'), 'Europe/London'), 0);
  assert.equal(zoneOffsetMinutesAt(asUtc('2026-07-01T12:00:00'), 'Asia/Kolkata'), 330);
});

test('wallClockOffsets gives one offset for an ordinary local time', () => {
  assert.deepEqual(wallClockOffsets(asUtc('2026-07-01T12:00:00'), 'Europe/London'), [60]);
  assert.deepEqual(wallClockOffsets(asUtc('2026-12-01T12:00:00'), 'Europe/London'), [0]);
});

test('wallClockOffsets gives both offsets, earlier instant first, when clocks go back', () => {
  // 2026-10-25 01:30 in London happens at 00:30Z (BST) and again at 01:30Z (GMT).
  assert.deepEqual(wallClockOffsets(asUtc('2026-10-25T01:30:00'), 'Europe/London'), [60, 0]);
});

test('wallClockOffsets gives none for a local time skipped when clocks go forward', () => {
  // 2026-03-29 01:30 never happens in London.
  assert.deepEqual(wallClockOffsets(asUtc('2026-03-29T01:30:00'), 'Europe/London'), []);
});

test('isCanonicalTimeZone accepts Region/City and UTC, and rejects abbreviations and offsets', () => {
  for (const zone of ['Europe/London', 'America/Argentina/Buenos_Aires', 'UTC']) {
    assert.equal(isCanonicalTimeZone(zone), true, zone);
  }
  for (const zone of ['BST', '+01:00', 'Europe/Nowhere', '', 'london']) {
    assert.equal(isCanonicalTimeZone(zone), false, zone);
  }
});

test('parseUtcOffset reads hours and optional minutes, with a required sign', () => {
  assert.equal(parseUtcOffset('+01:00'), 60);
  assert.equal(parseUtcOffset('+1'), 60);
  assert.equal(parseUtcOffset('-5'), -300);
  assert.equal(parseUtcOffset('+05:30'), 330);
  assert.equal(parseUtcOffset(' +00:00 '), 0);
  assert.equal(parseUtcOffset('+14:00'), 840);
});

test('parseUtcOffset rejects anything it cannot read exactly', () => {
  for (const text of ['', '1', '01:00', '+15', '+1:60', '+1:5', 'UTC+1', '+1.5', '+-1']) {
    assert.equal(parseUtcOffset(text), null, text);
  }
});

test('describeDeviceClock names each kind of clock', () => {
  assert.equal(describeDeviceClock({ kind: 'utc' }), 'UTC');
  assert.equal(describeDeviceClock({ kind: 'zone', timeZone: 'Europe/London' }), 'Europe/London');
  assert.equal(describeDeviceClock({ kind: 'offset', minutes: 60 }), 'UTC+01:00');
  assert.equal(describeDeviceClock({ kind: 'offset', minutes: -330 }), 'UTC-05:30');
});

test('resolveDeviceClockChoice builds a clock from a valid form entry', () => {
  const base = { timeZone: '', offset: '' };
  assert.deepEqual(resolveDeviceClockChoice({ ...base, kind: 'utc' }), { clock: { kind: 'utc' } });
  assert.deepEqual(resolveDeviceClockChoice({ ...base, kind: 'zone', timeZone: ' Europe/London ' }), {
    clock: { kind: 'zone', timeZone: 'Europe/London' },
  });
  assert.deepEqual(resolveDeviceClockChoice({ ...base, kind: 'zone', timeZone: 'UTC' }), { clock: { kind: 'utc' } });
  assert.deepEqual(resolveDeviceClockChoice({ ...base, kind: 'offset', offset: '+01:00' }), {
    clock: { kind: 'offset', minutes: 60 },
  });
});

test('resolveDeviceClockChoice has no default and explains an invalid entry', () => {
  const base = { timeZone: 'Europe/London', offset: '+01:00' };
  assert.match((resolveDeviceClockChoice({ ...base, kind: '' }) as { error: string }).error, /Choose/);
  assert.match((resolveDeviceClockChoice({ ...base, kind: 'zone', timeZone: 'BST' }) as { error: string }).error, /Europe\/London/);
  assert.match((resolveDeviceClockChoice({ ...base, kind: 'offset', offset: '1' }) as { error: string }).error, /\+01:00/);
});
