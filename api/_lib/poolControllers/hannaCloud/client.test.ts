import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { HannaAuthenticationError, HannaCloudClient } from './client';

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

let calls: Call[] = [];
let responses: Array<{ status: number; body: unknown }> = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  responses = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    const next = responses.shift();
    if (!next) throw new Error('No mock response queued for fetch call');
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const LOGIN_TOKENS = { data: { login: [{ tokenType: 'accessToken', token: 'access-123' }, { tokenType: 'refreshToken', token: 'refresh-456' }] } };

test('authenticate() AES-encrypts email/password as "<16-char iv>:<hex>" rather than sending them in the clear', async () => {
  responses = [{ status: 200, body: LOGIN_TOKENS }];
  const client = new HannaCloudClient('me@example.com', 'hunter2');
  await client.authenticate();

  const variables = calls[0].body.variables as { email: string; password: string };
  assert.match(variables.email, /^[A-Za-z0-9]{16}:[0-9a-f]+$/);
  assert.match(variables.password, /^[A-Za-z0-9]{16}:[0-9a-f]+$/);
  assert.ok(!variables.email.includes('me@example.com'));
});

test('subsequent requests carry the token authenticate() obtained', async () => {
  responses = [
    { status: 200, body: LOGIN_TOKENS },
    { status: 200, body: { data: { devices: [] } } },
  ];
  const client = new HannaCloudClient('me@example.com', 'hunter2');
  await client.authenticate();
  await client.getDevices();

  assert.equal(calls[1].headers.authorization, 'Bearer access-123');
});

test('getDevices()/getLastDeviceReading() reject before authenticate() has run', async () => {
  const client = new HannaCloudClient('me@example.com', 'hunter2');
  await assert.rejects(() => client.getDevices(), HannaAuthenticationError);
  await assert.rejects(() => client.getLastDeviceReading('dev-1'), HannaAuthenticationError);
  assert.equal(calls.length, 0);
});

test('a 403 on an authenticated call triggers one re-authentication and a retry', async () => {
  responses = [
    { status: 200, body: LOGIN_TOKENS }, // initial authenticate()
    { status: 403, body: {} }, // first attempt at the real call
    { status: 200, body: { data: { login: [{ tokenType: 'accessToken', token: 'access-789' }] } } }, // re-auth
    { status: 200, body: { data: { devices: [] } } }, // retried call
  ];
  const client = new HannaCloudClient('me@example.com', 'hunter2');
  await client.authenticate();
  const devices = await client.getDevices();

  assert.deepEqual(devices, []);
  assert.equal(calls.length, 4);
  assert.equal(calls[3].headers.authorization, 'Bearer access-789');
});

test('authenticate() throws HannaAuthenticationError if Hanna Cloud never returns an accessToken', async () => {
  responses = [
    { status: 200, body: { data: { login: [] } } },
    { status: 200, body: { data: { login: [] } } },
    { status: 200, body: { data: { login: [] } } },
  ];
  const client = new HannaCloudClient('me@example.com', 'wrong-password');
  await assert.rejects(() => client.authenticate(), HannaAuthenticationError);
  assert.equal(calls.length, 3);
});

test('getLastDeviceReading() maps the device parameters array', async () => {
  responses = [
    { status: 200, body: LOGIN_TOKENS },
    {
      status: 200,
      body: {
        data: {
          lastDeviceReadings: [
            {
              DID: 'dev-1',
              DT: '2026-09-19T12:00:00.000Z',
              messages: { parameters: [{ name: 'ph', value: 7.4 }, { name: 'orp', value: 650 }, { name: 'temp', value: 28.1 }] },
            },
          ],
        },
      },
    },
  ];
  const client = new HannaCloudClient('me@example.com', 'hunter2');
  await client.authenticate();
  const reading = await client.getLastDeviceReading('dev-1');

  assert.equal(reading.did, 'dev-1');
  assert.equal(reading.dt, '2026-09-19T12:00:00.000Z');
  assert.deepEqual(reading.parameters, [{ name: 'ph', value: 7.4 }, { name: 'orp', value: 650 }, { name: 'temp', value: 28.1 }]);
});
