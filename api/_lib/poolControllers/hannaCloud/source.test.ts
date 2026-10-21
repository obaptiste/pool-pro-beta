import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { HannaCloudError } from './client.js';
import { HannaCloudSource, resolveDeviceClock } from './source.js';
import type { DeviceClock } from './source.js';

let calls: Array<{ url: string; body: Record<string, unknown> }> = [];
let responses: Array<{ status: number; body: unknown }> = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  responses = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const next = responses.shift();
    if (!next) throw new Error('No mock response queued for fetch call');
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const LOGIN_OK = { status: 200, body: { data: { login: [{ tokenType: 'accessToken', token: 'tok' }] } } };

function rawReading(messages: Record<string, unknown>, did = 'BL122_TEST') {
  return { status: 200, body: { data: { lastDeviceReadings: [{
    DID: did, DT: '2026-10-17T12:00:00Z', messages,
  }] } } };
}

test('raw BL122 telemetry reaches the source as real measurements, including abnormal values', async () => {
  for (const [ph, orp] of [[7.3, 680], [6.8, 233], [8.2, 850]]) {
    responses = [LOGIN_OK, rawReading({ RD: `${ph},${orp},29.1`, EV: '0,0,0' })];
    const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'BL122_TEST' });
    assert.deepEqual(await source.getLatestReading(), {
      ph, sanitisationMv: orp, temperature: 29.1, recordedAt: new Date('2026-10-17T12:00:00Z'),
    });
  }
});

test('raw placeholders do not invent zeroes and partial measurements remain usable', async () => {
  responses = [LOGIN_OK, rawReading({ RD: '--,680, ' })];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'BL122_TEST' });
  const reading = await source.getLatestReading();
  assert.equal(reading?.ph, null);
  assert.equal(reading?.sanitisationMv, 680);
  assert.equal(reading?.temperature, null);
});

test('offline, missing-probe, malformed, and empty raw snapshots remain unavailable', async () => {
  for (const messages of [
    { RD: '7.3,680,29', connectionState: 'offline' },
    { RD: '7.3,680,29', EV: '100000,0,0' },
    { RD: '--,--,--' }, { RD: '7.3,680' }, { RD: ',, ' },
  ]) {
    responses = [LOGIN_OK, rawReading(messages), dashboardReading(messages, 'BL122_TEST')];
    const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'BL122_TEST' });
    assert.equal(await source.getLatestReading(), null);
  }
});
function lastReading(parameters: Array<{ name: string; value: unknown }>, dt: unknown, did = 'dev-1') {
  return { status: 200, body: { data: { lastDeviceReadings: [{ DID: did, DT: dt, messages: { parameters } }] } } };
}

function dashboardReading(messages: Record<string, unknown>, did = 'dev-1') {
  return { status: 200, body: { data: { getDashboardData: { data: { readingsData: [{
    DID: did, DT: '2026-10-17T12:00:00Z', messages,
  }] } } } } };
}

test('maps ph/orp/temp parameters onto ph/sanitisationMv/temperature', async () => {
  responses = [
    LOGIN_OK,
    lastReading([{ name: 'ph', value: 7.4 }, { name: 'orp', value: 650 }, { name: 'temp', value: 28.1 }, { name: 'airTemp', value: 31 }], '2026-09-19T12:00:00.000Z'),
  ];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  const reading = await source.getLatestReading();

  assert.deepEqual(reading, {
    ph: 7.4,
    sanitisationMv: 650,
    temperature: 28.1,
    recordedAt: new Date('2026-09-19T12:00:00.000Z'),
  });
});

test('a blank or non-numeric parameter value maps to null rather than a fabricated 0', async () => {
  responses = [
    LOGIN_OK,
    // orp is a real measurement, so the reading as a whole isn't "nothing" —
    // ph/temp individually still fall back to null rather than a fabricated 0.
    lastReading([{ name: 'ph', value: '' }, { name: 'orp', value: 650 }, { name: 'temp', value: false }], '2026-09-19T12:00:00.000Z'),
  ];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  const reading = await source.getLatestReading();

  assert.equal(reading?.ph, null);
  assert.equal(reading?.sanitisationMv, 650);
  assert.equal(reading?.temperature, null);
});

test('rejects a physically-impossible temperature sentinel, mapping it to null rather than persisting it', async () => {
  responses = [
    LOGIN_OK,
    // temp: -999 is a hardware error sentinel, well below a pool's physical
    // minimum -- getImpossibleValueError's min bound catches it.
    lastReading([{ name: 'ph', value: 7.4 }, { name: 'orp', value: 650 }, { name: 'temp', value: -999 }], '2026-09-19T12:00:00.000Z'),
  ];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  const reading = await source.getLatestReading();

  assert.equal(reading?.ph, 7.4);
  assert.equal(reading?.sanitisationMv, 650);
  assert.equal(reading?.temperature, null);
});

test('never rejects ph or ORP, even at a sentinel-looking extreme, since AGENTS.md says neither may ever be blocked', async () => {
  responses = [
    LOGIN_OK,
    // ph: -50 and orp: -999 look like hardware sentinels, but ORP is a
    // signed electrode potential and pH can go genuinely negative in an
    // acid-spill incident -- AGENTS.md is explicit that these two fields
    // must never be rejected, sentinel or not, so getImpossibleValueError
    // skips them entirely and both must pass through untouched.
    lastReading([{ name: 'ph', value: -50 }, { name: 'orp', value: -999 }, { name: 'temp', value: 28.1 }], '2026-09-19T12:00:00.000Z'),
  ];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  const reading = await source.getLatestReading();

  assert.equal(reading?.ph, -50);
  assert.equal(reading?.sanitisationMv, -999);
  assert.equal(reading?.temperature, 28.1);
});

test('does not catch an upper-bound sentinel on any field, matching the MCP write path\'s accepted gap', async () => {
  responses = [
    LOGIN_OK,
    // getImpossibleValueError never checks a maximum for any field, so an
    // upper-bound sentinel passes through the same as it would on the MCP
    // write path -- an accepted, documented gap, not a regression here.
    lastReading([{ name: 'ph', value: 20 }, { name: 'orp', value: 9999 }, { name: 'temp', value: 500 }], '2026-09-19T12:00:00.000Z'),
  ];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  const reading = await source.getLatestReading();

  assert.equal(reading?.ph, 20);
  assert.equal(reading?.sanitisationMv, 9999);
  assert.equal(reading?.temperature, 500);
});

test('leaves a genuinely abnormal-but-possible reading untouched', async () => {
  responses = [
    LOGIN_OK,
    // ORP at 30 mV -- a real algae-bloom-range reading per AGENTS.md's own
    // example, not a sentinel -- must still pass through.
    lastReading([{ name: 'ph', value: 7.4 }, { name: 'orp', value: 30 }, { name: 'temp', value: 28.1 }], '2026-09-19T12:00:00.000Z'),
  ];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  const reading = await source.getLatestReading();

  assert.equal(reading?.sanitisationMv, 30);
});

test('returns null (not an all-null reading) when every measurement is blank, non-numeric, or missing', async () => {
  responses = [
    LOGIN_OK,
    lastReading([{ name: 'ph', value: '' }, { name: 'orp', value: '   ' }, { name: 'temp', value: false }], '2026-09-19T12:00:00.000Z'),
    dashboardReading({ parameters: [] }),
  ];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  const reading = await source.getLatestReading();

  // Not just "all fields null" -- an all-null Reading would still get
  // written and would still advance sync.ts's dedupe watermark, hiding the
  // dashboard's previous real snapshot and silently rejecting a later
  // corrected response for the same instant.
  assert.equal(reading, null);
});

test('a missing parameter maps to null rather than throwing', async () => {
  responses = [LOGIN_OK, lastReading([{ name: 'ph', value: 7.2 }], '2026-09-19T12:00:00.000Z')];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  const reading = await source.getLatestReading();

  assert.equal(reading?.ph, 7.2);
  assert.equal(reading?.sanitisationMv, null);
  assert.equal(reading?.temperature, null);
});

test('rejects when the device timestamp is unparseable, rather than guessing "now"', async () => {
  responses = [LOGIN_OK, lastReading([{ name: 'ph', value: 7.2 }], { garbage: true })];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  await assert.rejects(() => source.getLatestReading());
});

test('rejects a calendar-invalid ISO-looking timestamp instead of silently normalizing it', async () => {
  // new Date('2026-02-30') silently normalizes to March 2nd rather than
  // throwing -- exactly the "wrong-but-plausible" value that would become a
  // bad permanent dedupe watermark in sync.ts.
  responses = [LOGIN_OK, lastReading([{ name: 'ph', value: 7.2 }], '2026-02-30T12:00:00Z')];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  await assert.rejects(() => source.getLatestReading(), HannaCloudError);
});

test('rejects a non-ISO but JS-parseable timestamp string instead of accepting a locale-dependent format', async () => {
  // Hanna's API isn't documented to only ever send ISO-8601, so this must
  // not rely on new Date()'s permissive, locale-dependent parsing.
  responses = [LOGIN_OK, lastReading([{ name: 'ph', value: 7.2 }], '09/26/2026')];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  await assert.rejects(() => source.getLatestReading(), HannaCloudError);
});

test('reads an offset-less timestamp as UTC, not the server time zone', async () => {
  // Hanna sends offset-less times; Hanna's decoder reads them as UTC. Pinning
  // the Z explicitly keeps the result independent of the process TZ.
  const recent = new Date(Date.now() - 60_000).toISOString().slice(0, 19);
  responses = [LOGIN_OK, lastReading([{ name: 'ph', value: 7.2 }], recent)];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  const reading = await source.getLatestReading();
  assert.equal(reading?.recordedAt.getTime(), Date.parse(`${recent}Z`));
});

test('still rejects a calendar-invalid offset-less timestamp', async () => {
  responses = [LOGIN_OK, lastReading([{ name: 'ph', value: 7.2 }], '2026-02-30T12:00:00')];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  await assert.rejects(() => source.getLatestReading(), HannaCloudError);
});

test('accepts a numeric epoch-seconds timestamp', async () => {
  const epochSeconds = Math.floor((Date.now() - 60_000) / 1000); // one minute ago
  responses = [LOGIN_OK, lastReading([{ name: 'ph', value: 7.2 }], epochSeconds)];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  const reading = await source.getLatestReading();
  assert.equal(reading?.recordedAt.getTime(), epochSeconds * 1000);
});

test('rejects an implausibly far-future timestamp rather than adopting it as the new sync watermark', async () => {
  const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  responses = [LOGIN_OK, lastReading([{ name: 'ph', value: 7.2 }], oneDayFromNow)];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  await assert.rejects(() => source.getLatestReading());
});

test('rejects a zero epoch timestamp rather than silently producing an epoch-1970 Date', async () => {
  responses = [LOGIN_OK, lastReading([{ name: 'ph', value: 7.2 }], 0)];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  await assert.rejects(() => source.getLatestReading(), /implausibly far in the past/);
});

test('rejects a small negative epoch timestamp', async () => {
  responses = [LOGIN_OK, lastReading([{ name: 'ph', value: 7.2 }], -100)];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  await assert.rejects(() => source.getLatestReading(), /implausibly far in the past/);
});

test('tolerates a small clock-skew window rather than rejecting every future timestamp', async () => {
  const oneMinuteFromNow = new Date(Date.now() + 60_000).toISOString();
  responses = [LOGIN_OK, lastReading([{ name: 'ph', value: 7.2 }], oneMinuteFromNow)];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  const reading = await source.getLatestReading();
  assert.equal(reading?.recordedAt.toISOString(), oneMinuteFromNow);
});

test('auto-selects the device when exactly one is registered and no HANNA_CLOUD_DEVICE_ID is set', async () => {
  responses = [
    LOGIN_OK,
    { status: 200, body: { data: { devices: [{ DID: 'only-device', modelGroup: 'BL12x', DINFO: { deviceName: 'Backyard Pool' } }] } } },
    lastReading([{ name: 'ph', value: 7.5 }], '2026-09-19T12:00:00.000Z', 'only-device'),
  ];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw' });
  const reading = await source.getLatestReading();

  assert.equal(reading?.ph, 7.5);
  const deviceQuery = calls[2].body.variables as { deviceIds: string[] };
  assert.deepEqual(deviceQuery.deviceIds, ['only-device']);
});

test('throws with a clear message when the account has multiple devices and none is configured', async () => {
  responses = [
    LOGIN_OK,
    { status: 200, body: { data: { devices: [
      { DID: 'dev-a', modelGroup: 'BL12x', DINFO: { deviceName: 'Backyard Pool' } },
      { DID: 'dev-b', modelGroup: 'BL12x', DINFO: { deviceName: 'Spa' } },
    ] } } },
  ];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw' });
  await assert.rejects(() => source.getLatestReading(), /HANNA_CLOUD_DEVICE_ID/);
});

// --- Device clock: what an offset-less Hanna timestamp actually means ---

function readingAt(dt: string) {
  return { status: 200, body: { data: { lastDeviceReadings: [{
    DID: 'BL122_TEST', DT: dt, messages: { RD: '7.4,720,29.1', EV: '0,0,0' },
  }] } } };
}

async function recordedAtWith(dt: string, deviceClock?: DeviceClock) {
  responses = [LOGIN_OK, readingAt(dt)];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'BL122_TEST', deviceClock });
  const reading = await source.getLatestReading();
  return reading?.recordedAt;
}

test('a fixed-offset device clock converts an offset-less timestamp to the right instant', async () => {
  assert.deepEqual(
    await recordedAtWith('2026-07-15T12:00:00', { kind: 'offset', minutes: 60 }),
    new Date('2026-07-15T11:00:00Z'),
  );
});

test('a zoned device clock applies that zone\'s summer offset', async () => {
  assert.deepEqual(
    await recordedAtWith('2026-07-15T12:00:00', { kind: 'zone', timeZone: 'Europe/London' }),
    new Date('2026-07-15T11:00:00Z'),
  );
});

test('a zoned device clock applies the winter offset for the same zone, so DST is not baked in', async () => {
  // The point of the zone form over a fixed offset: Europe/London is +1 in
  // July and +0 in January, and a device that follows local clock changes
  // needs the timestamp read differently in each.
  assert.deepEqual(
    await recordedAtWith('2026-01-15T12:00:00', { kind: 'zone', timeZone: 'Europe/London' }),
    new Date('2026-01-15T12:00:00Z'),
  );
});

test('a fixed offset does NOT follow DST, which is the whole difference from the zone form', async () => {
  assert.deepEqual(
    await recordedAtWith('2026-01-15T12:00:00', { kind: 'offset', minutes: 60 }),
    new Date('2026-01-15T11:00:00Z'),
  );
});

test('an offset Hanna sent is taken as given only when no device clock is configured', async () => {
  // Superseded rule: this used to assert the opposite, that a supplied
  // offset always won. It doesn't -- see the device-clock tests at the end
  // of this file for why Hanna's "Z" is their assumption about a bare
  // controller clock rather than a measurement of the device's offset.
  assert.deepEqual(
    await recordedAtWith('2026-07-15T12:00:00Z'),
    new Date('2026-07-15T12:00:00Z'),
  );
});

test('no configured device clock still reads an offset-less timestamp as UTC', async () => {
  assert.deepEqual(await recordedAtWith('2026-07-15T12:00:00'), new Date('2026-07-15T12:00:00Z'));
});

test('resolveDeviceClock defaults to UTC and prefers an explicit offset over a zone', () => {
  assert.deepEqual(resolveDeviceClock(undefined, undefined), { kind: 'utc' });
  assert.deepEqual(resolveDeviceClock('  ', ''), { kind: 'utc' });
  assert.deepEqual(resolveDeviceClock('Europe/London', undefined), { kind: 'zone', timeZone: 'Europe/London' });
  assert.deepEqual(resolveDeviceClock(undefined, '60'), { kind: 'offset', minutes: 60 });
  assert.deepEqual(resolveDeviceClock(undefined, '-330'), { kind: 'offset', minutes: -330 });
  assert.deepEqual(resolveDeviceClock('Europe/London', '60'), { kind: 'offset', minutes: 60 });
});

test('resolveDeviceClock throws on a bad value rather than silently reverting to UTC', () => {
  // Falling back would reinstate the exact bug this exists to fix, and leave
  // a diagnostic blaming the controller's clock for a configuration typo.
  for (const bad of ['Europe/Canterbury', 'BST', 'UTC+1']) {
    assert.throws(() => resolveDeviceClock(bad, undefined), (e: unknown) =>
      e instanceof HannaCloudError && e.diagnosticCode === 'HC_DEVICE_CLOCK_CONFIG');
  }
  for (const bad of ['sixty', '60.5', '900', '-900', 'NaN']) {
    assert.throws(() => resolveDeviceClock(undefined, bad), (e: unknown) =>
      e instanceof HannaCloudError && e.diagnosticCode === 'HC_DEVICE_CLOCK_CONFIG');
  }
});

// --- DST transitions: the two moments the zone form has to earn its name ---

async function recordedAtFrozen(dt: string, nowIso: string, deviceClock: DeviceClock) {
  const realNow = Date.now;
  // Only Date.now is faked: the fetch mock and node:test's own timers stay real.
  Date.now = () => Date.parse(nowIso);
  try {
    return await recordedAtWith(dt, deviceClock);
  } finally {
    Date.now = realNow;
  }
}

const LONDON: DeviceClock = { kind: 'zone', timeZone: 'Europe/London' };

test('autumn fall-back: the repeated hour resolves to whichever occurrence the server clock says it is', async () => {
  // UK DST ends 2026-10-25 at 02:00 BST -> 01:00 GMT, so local 01:30 happens
  // twice: 00:30Z (BST) and 01:30Z (GMT). Picking blindly sent the first
  // occurrence an hour into the future, where the skew guard rejected it --
  // the controller going dark for an hour every single year.
  assert.deepEqual(
    await recordedAtFrozen('2026-10-25T01:30:00', '2026-10-25T00:35:00Z', LONDON),
    new Date('2026-10-25T00:30:00Z'),
  );
  assert.deepEqual(
    await recordedAtFrozen('2026-10-25T01:30:00', '2026-10-25T01:35:00Z', LONDON),
    new Date('2026-10-25T01:30:00Z'),
  );
});

test('autumn fall-back: a reading from the first occurrence is no longer rejected as future-dated', async () => {
  // The regression this guards: the resolved instant must not land beyond
  // MAX_CLOCK_SKEW_MS of the server clock. Previously this threw
  // HC_TIMESTAMP_FUTURE at 3300s ahead.
  const recordedAt = await recordedAtFrozen('2026-10-25T01:30:00', '2026-10-25T00:35:00Z', LONDON);
  assert.ok(recordedAt);
  assert.ok(recordedAt.getTime() <= Date.parse('2026-10-25T00:35:00Z'),
    `resolved instant ${recordedAt.toISOString()} should not be in the future`);
});

test('spring forward: a local time that never existed still yields a reading rather than dropping it', async () => {
  // UK DST starts 2026-03-29 at 01:00 GMT -> 02:00 BST, so local 01:30 never
  // happens. Nothing can be correct; keeping the reading beats losing it.
  const recordedAt = await recordedAtFrozen('2026-03-29T01:30:00', '2026-03-29T01:35:00Z', LONDON);
  assert.ok(recordedAt instanceof Date);
  assert.ok(Number.isFinite(recordedAt.getTime()));
});

test('an unambiguous zoned time ignores the server clock entirely', async () => {
  // Outside a transition there is only one real offset, so a wrong-looking
  // "now" must not drag the answer around.
  for (const now of ['2026-07-15T11:05:00Z', '2026-07-20T00:00:00Z']) {
    assert.deepEqual(
      await recordedAtFrozen('2026-07-15T12:00:00', now, LONDON),
      new Date('2026-07-15T11:00:00Z'),
    );
  }
});

// --- A configured device clock outranks an offset Hanna supplied ---

test('a configured device clock reinterprets a timestamp even when Hanna sent its own offset', async () => {
  // The dashboard path (client.ts assigns messages.lastUpdate over the
  // decoded DT) can deliver a "Z" that is Hanna's own dayjs.utc assumption
  // about a bare controller clock, not a measurement of the device's offset.
  // Treating it as authoritative meant a configured device clock was never
  // consulted on that path — the Joy Lane failure exactly.
  assert.deepEqual(
    await recordedAtWith('2026-07-15T12:00:00Z', { kind: 'offset', minutes: 60 }),
    new Date('2026-07-15T11:00:00Z'),
  );
  assert.deepEqual(
    await recordedAtWith('2026-07-15T12:00:00Z', LONDON),
    new Date('2026-07-15T11:00:00Z'),
  );
  // A numeric offset is reinterpreted the same way: it is the wall clock that
  // carries the meaning, not whatever Hanna appended to it.
  assert.deepEqual(
    await recordedAtWith('2026-07-15T12:00:00+05:00', { kind: 'offset', minutes: 60 }),
    new Date('2026-07-15T11:00:00Z'),
  );
});

test('with no device clock configured, an offset Hanna sent is still taken as given', async () => {
  // The default must not change: unset means UTC for a bare value and
  // untouched for one carrying an offset.
  assert.deepEqual(await recordedAtWith('2026-07-15T12:00:00Z'), new Date('2026-07-15T12:00:00Z'));
  assert.deepEqual(await recordedAtWith('2026-07-15T12:00:00+02:00'), new Date('2026-07-15T10:00:00Z'));
  assert.deepEqual(await recordedAtWith('2026-07-15T12:00:00'), new Date('2026-07-15T12:00:00Z'));
});
