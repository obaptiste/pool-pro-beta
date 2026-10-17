import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePoolControllerProbeResponse } from './poolControllerProbe.js';

const valid = {
  mode: 'probe', written: false, outcome: 'reading-available',
  reading: { ph: 7.3, sanitisationMv: 233, temperature: null, recordedAt: '2026-10-17T12:00:00Z' },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('preserves partial and abnormal readings without saving', async () => {
  assert.deepEqual(await parsePoolControllerProbeResponse(json(valid)), valid);
});

test('accepts an explicit connected-but-no-reading result', async () => {
  const empty = { mode: 'probe', written: false, outcome: 'no-reading-available', reading: null };
  assert.deepEqual(await parsePoolControllerProbeResponse(json(empty)), empty);
});

test('surfaces a server configuration error', async () => {
  await assert.rejects(parsePoolControllerProbeResponse(json({ error: 'HANNA_CLOUD_EMAIL is not configured' }, 503)), /HANNA_CLOUD_EMAIL/);
});

test('reports HTTP status for non-JSON authentication errors', async () => {
  await assert.rejects(parsePoolControllerProbeResponse(new Response('<html>Sign in</html>', { status: 401 })), /401/);
});

test('rejects an HTML login page returned with HTTP 200', async () => {
  await assert.rejects(parsePoolControllerProbeResponse(new Response('<html>Sign in</html>')), /unexpected response/);
});

test('rejects empty, unrelated, inconsistent, or write-mode JSON', async () => {
  for (const body of [{}, null, [], { ...valid, mode: 'sync' }, { ...valid, written: true },
    { ...valid, reading: null }, { ...valid, outcome: 'no-reading-available' }]) {
    await assert.rejects(parsePoolControllerProbeResponse(json(body)), /unexpected response/);
  }
});

test('rejects malformed timestamps and measurements instead of displaying success', async () => {
  for (const reading of [{ ...valid.reading, recordedAt: 'invalid' },
    { ...valid.reading, ph: '7.2' }, { ...valid.reading, ph: null, sanitisationMv: null },
    { ...valid.reading, temperature: undefined }]) {
    await assert.rejects(parsePoolControllerProbeResponse(json({ ...valid, reading })), /unexpected response/);
  }
});
