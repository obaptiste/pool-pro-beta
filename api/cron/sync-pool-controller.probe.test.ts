import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import handler from './sync-pool-controller.js';

type Reply = { status: number; body: any; headers: Record<string, string> };
const priorSecret = process.env.CRON_SECRET;
const priorEmail = process.env.HANNA_CLOUD_EMAIL;
const priorPassword = process.env.HANNA_CLOUD_PASSWORD;
const priorDeviceId = process.env.HANNA_CLOUD_DEVICE_ID;
const originalFetch = globalThis.fetch;

let calls: Array<{ url: string; body: any }> = [];
let answers: Array<{ status: number; body: any }> = [];

function fakeResponse(): { response: Reply; res: any } {
  const response: Reply = { status: 200, body: null, headers: {} };
  return {
    response,
    res: {
      status(code: number) { response.status = code; return this; },
      json(body: unknown) { response.body = body; },
      setHeader(name: string, value: string) { response.headers[name] = value; },
    },
  };
}
async function request(token = 'probe-test-secret', mode: string | undefined = 'probe', method = 'POST') {
  const { res, response } = fakeResponse();
  await handler({
    method,
    headers: { authorization: `Bearer ${token}` },
    query: mode === undefined ? {} : { mode },
  }, res);
  return response;
}
const AUTH_OK = { data: { login: [{ tokenType: 'accessToken', token: 'fake-access-token' }] } };
const DEVICE_OK = { data: { devices: [{ DID: 'dev-1', modelGroup: 'BL12x', DINFO: { deviceName: 'Test pool' } }] } };
const MEASUREMENT_OK = { data: { lastDeviceReadings: [{
  DID: 'dev-1',
  DT: new Date(Date.now() - 60_000).toISOString(),
  messages: { parameters: [
    { name: 'ph', value: 7.3 }, { name: 'orp', value: 680 }, { name: 'temp', value: 29.1 },
  ] },
}] } };

beforeEach(() => {
  calls = [];
  answers = [];
  process.env.CRON_SECRET = 'probe-test-secret';
  process.env.HANNA_CLOUD_EMAIL = 'test@example.com';
  process.env.HANNA_CLOUD_PASSWORD = 'test-password';
  delete process.env.HANNA_CLOUD_DEVICE_ID;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const answer = answers.shift();
    if (!answer) throw new Error('Unexpected outbound request');
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries({
    CRON_SECRET: priorSecret,
    HANNA_CLOUD_EMAIL: priorEmail,
    HANNA_CLOUD_PASSWORD: priorPassword,
    HANNA_CLOUD_DEVICE_ID: priorDeviceId,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test('probe uses Hanna read queries, returns only measurements, and does not require Firebase configuration', async () => {
  answers = [
    { status: 200, body: AUTH_OK },
    { status: 200, body: DEVICE_OK },
    { status: 200, body: MEASUREMENT_OK },
  ];
  const result = await request();
  assert.equal(result.status, 200);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.body.mode, 'probe');
  assert.equal(result.body.written, false);
  assert.equal(result.body.outcome, 'reading-available');
  assert.equal(result.body.reading.ph, 7.3);
  assert.equal(result.body.reading.sanitisationMv, 680);
  assert.equal(result.body.reading.temperature, 29.1);
  assert.equal(typeof result.body.reading.recordedAt, 'string');
  assert.deepEqual(calls.map((call) => call.body.operationName), ['Login', 'Devices', 'GetLastDeviceReading']);
  assert.equal(JSON.stringify(result.body).includes('fake-access-token'), false);
  assert.equal(JSON.stringify(result.body).includes('test-password'), false);
  assert.equal(JSON.stringify(result.body).includes('dev-1'), false);
});

test('missing bearer is rejected before contacting Hanna Cloud', async () => {
  const result = await request('');
  assert.equal(result.status, 401);
  assert.equal(calls.length, 0);
});

test('probe uses dashboard fallback measurements and remains read-only', async () => {
  process.env.HANNA_CLOUD_DEVICE_ID = 'BL122_TEST';
  const recordedAt = new Date(Date.now() - 60_000).toISOString();
  answers = [
    { status: 200, body: AUTH_OK },
    { status: 200, body: { data: { lastDeviceReadings: [{ DID: 'BL122_TEST', messages: { parameters: [] } }] } } },
    { status: 200, body: { data: { getDashboardData: { data: { readingsData: [{
      DID: 'BL122_TEST', messages: { lastUpdate: recordedAt, parameters: [
        { name: 'ph', value: '7.51' }, { name: 'orp', value: '718' }, { name: 'temp', value: '28.9' },
      ] },
    }] } } } } },
  ];
  const result = await request();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.reading, { recordedAt, ph: 7.51, sanitisationMv: 718, temperature: 28.9 });
  assert.equal(result.body.written, false);
  assert.deepEqual(calls.map((call) => call.body.operationName), ['Login', 'GetLastDeviceReading', 'GetDashboardData']);
  assert.equal(JSON.stringify(result.body).includes('fake-access-token'), false);
  assert.equal(JSON.stringify(result.body).includes('BL122_TEST'), false);
});

test('probe decodes raw BL122 RD telemetry without invoking the Firestore write path', async () => {
  process.env.HANNA_CLOUD_DEVICE_ID = 'BL122_TEST';
  answers = [
    { status: 200, body: AUTH_OK },
    { status: 200, body: { data: { lastDeviceReadings: [{
      DID: 'BL122_TEST', DT: new Date(Date.now() - 60_000).toISOString(),
      messages: { RD: '7.3,680,29.1', EV: '0,0,0' },
    }] } } },
  ];
  const result = await request();
  assert.equal(result.status, 200);
  assert.equal(result.body.written, false);
  assert.equal(result.body.outcome, 'reading-available');
  assert.equal(result.body.reading.ph, 7.3);
  assert.equal(result.body.reading.sanitisationMv, 680);
  assert.equal(result.body.reading.temperature, 29.1);
  assert.deepEqual(calls.map((call) => call.body.operationName), ['Login', 'GetLastDeviceReading']);
});

test('invalid mode fails closed before contacting Hanna Cloud', async () => {
  const result = await request('probe-test-secret', 'proeb');
  assert.equal(result.status, 400);
  assert.equal(calls.length, 0);
});

test('probe does not allow GET', async () => {
  const result = await request('probe-test-secret', 'probe', 'GET');
  assert.equal(result.status, 405);
  assert.equal(calls.length, 0);
});

test('probe returns a generic failure rather than Hanna upstream error text', async () => {
  answers = [{ status: 401, body: { error: 'secret-value-should-never-appear' } }];
  const result = await request();
  assert.equal(result.status, 502);
  assert.equal(result.body.error.includes('secret-value'), false);
  assert.equal(calls.length, 1);
});
