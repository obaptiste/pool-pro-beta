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
  responses = [LOGIN_OK, lastReading([], 1789999200)];
  const source = new HannaCloudSource({ email: 'a@b.com', password: 'pw', deviceId: 'dev-1' });
  const reading = await source.getLatestReading();
  assert.equal(reading?.recordedAt.getTime(), 1789999200 * 1000);
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
