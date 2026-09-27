import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { HannaCloudSource } from './source';

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
function lastReading(parameters: Array<{ name: string; value: unknown }>, dt: unknown) {
  return { status: 200, body: { data: { lastDeviceReadings: [{ DID: 'dev-1', DT: dt, messages: { parameters } }] } } };
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

test('rejects a physically-impossible sentinel value per field, mapping it to null rather than persisting it', async () => {
  responses = [
    LOGIN_OK,
    // ph: -50 and sanitisationMv: -999 are hardware error sentinels, not
    // real abnormal readings -- both fall below getHardValidationError's
    // minimum for their field. temp: -999 is likewise below the physical
    // minimum for a pool. airTemp is unrelated and untouched by this bound.
    lastReading([{ name: 'ph', value: -50 }, { name: 'orp', value: -999 }, { name: 'temp', value: -999 }], '2026-09-19T12:00:00.000Z'),
  ];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  const reading = await source.getLatestReading();

  // Every field rejected as impossible -> the reading as a whole is
  // "nothing", same as if every field had been blank or non-numeric.
  assert.equal(reading, null);
});

test('rejects an upper-bound sentinel too, not just a negative one', async () => {
  responses = [
    LOGIN_OK,
    lastReading([{ name: 'ph', value: 20 }, { name: 'orp', value: 9999 }, { name: 'temp', value: 7.4 }], '2026-09-19T12:00:00.000Z'),
  ];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  const reading = await source.getLatestReading();

  assert.equal(reading?.ph, null);
  assert.equal(reading?.sanitisationMv, null);
  // temp is a real (if oddly low for a pool) reading, well within bounds --
  // present so the overall reading isn't "nothing" despite the two rejections.
  assert.equal(reading?.temperature, 7.4);
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
    lastReading([{ name: 'ph', value: 7.5 }], '2026-09-19T12:00:00.000Z'),
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
