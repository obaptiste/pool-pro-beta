import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Reading } from '../../../src/types';
import { handleMcpRequest } from './handler';
import type { ListReadingsOptions, PoolDataSource } from './types';

const TOKEN = 'test-token-123';
const DAY = 86_400_000;
const now = Date.now();

const reading = (id: string, ageDays: number, values: Partial<Reading>): Reading => ({
  id,
  uid: 'owner',
  timestamp: new Date(now - ageDays * DAY),
  chlorine: null, totalChlorine: null, sanitisationMv: null, ph: null, alkalinity: null,
  temperature: null, differentialPressure: null, calciumHardness: null, cyanuricAcid: null,
  ...values,
});

// Newest first, like the Firestore source.
const READINGS: Reading[] = [
  reading('r1', 0, { chlorine: 1, totalChlorine: 3, ph: 7.6, alkalinity: 100, temperature: 28, calciumHardness: 250, notes: 'smells of chloramine' }),
  reading('r2', 1, { chlorine: 2, totalChlorine: 2.2, ph: 7.4, alkalinity: 100, temperature: 28, calciumHardness: 250 }),
  reading('r3', 2, { chlorine: 2.5, ph: 7.3 }),
  reading('r4', 10, { chlorine: 0, ph: 7.9 }),
];

const memorySource: PoolDataSource = {
  async listReadings({ since, until, before, limit }: ListReadingsOptions) {
    return READINGS
      .filter((r) => (!since || r.timestamp >= since) && (!until || r.timestamp <= until) && (!before || r.timestamp < before))
      .slice(0, limit);
  },
  async listTasks() {
    return [
      { id: 't1', uid: 'owner', title: 'Backwash filter', completed: false, priority: 'high', frequency: 'monthly', createdAt: new Date(now) },
      { id: 't2', uid: 'owner', title: 'Empty skimmer baskets', completed: true, priority: 'medium', frequency: 'daily', createdAt: new Date(now) },
    ];
  },
  async listInventory() {
    return [
      { id: 'i1', uid: 'owner', name: 'Soda Ash', quantity: 0.5, unit: 'kg', minThreshold: 1 },
      { id: 'i2', uid: 'owner', name: 'Chlorine Granules', quantity: 8, unit: 'kg', minThreshold: 2 },
    ];
  },
  async listEquipment() {
    return [
      { id: 'e1', uid: 'owner', name: 'Sand Filter', installDate: new Date(now - 400 * DAY), serviceIntervalMonths: 12 },
      { id: 'e2', uid: 'owner', name: 'Main Pump', installDate: new Date(now - 400 * DAY), lastServiceDate: new Date(now - 30 * DAY), serviceIntervalMonths: 12 },
    ];
  },
  async getSchedule() {
    return { uid: 'owner', testFrequency: 'weekly', lastTestDate: new Date(now - 10 * DAY), nextTestDate: new Date(now - 3 * DAY), remindersEnabled: true };
  },
};

let httpServer: Server;
let baseUrl: string;

before(async () => {
  httpServer = createServer((req, res) => {
    handleMcpRequest(req, res, { bearerToken: TOKEN, getSource: () => memorySource }).catch((error) => {
      res.writeHead(500).end(String(error));
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  baseUrl = `http://127.0.0.1:${address.port}/api/mcp`;
});

after(() => new Promise<void>((resolve) => httpServer.close(() => resolve())));

async function connect(token: string | undefined): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  await client.connect(transport);
  return client;
}

const structured = <T,>(result: unknown): T => (result as { structuredContent?: unknown }).structuredContent as T;

describe('MCP endpoint auth', () => {
  it('rejects a missing bearer token with 401', async () => {
    const res = await fetch(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('www-authenticate'), 'Bearer');
  });

  it('rejects a wrong bearer token with 401', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nope' },
      body: '{}',
    });
    assert.equal(res.status, 401);
  });

  it('refuses to serve when no token is configured', async () => {
    const server = createServer((req, res) => {
      handleMcpRequest(req, res, { bearerToken: undefined, getSource: () => memorySource });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 503);
    server.close();
  });

  it('rejects GET (no sessions in stateless mode)', async () => {
    // The transport checks the Accept header before the method, so a bare
    // GET without one gets 406, not 405 — still correctly refused.
    const res = await fetch(baseUrl, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json, text/event-stream' } });
    assert.equal(res.status, 405);
  });
});

describe('MCP tools', () => {
  it('lists the seven read-only tools', async () => {
    const client = await connect(TOKEN);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      [
        'poolstatus_get_latest_reading',
        'poolstatus_get_reading_trends',
        'poolstatus_get_schedule',
        'poolstatus_list_equipment',
        'poolstatus_list_inventory',
        'poolstatus_list_readings',
        'poolstatus_list_tasks',
      ],
    );
    assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
    await client.close();
  });

  it('get_latest_reading derives LSI and combined chlorine', async () => {
    const client = await connect(TOKEN);
    const result = await client.callTool({ name: 'poolstatus_get_latest_reading', arguments: {} });
    const out = structured<{ reading: { id: string; derived: Record<string, unknown>; fieldStatus: Record<string, string> } }>(result);
    assert.equal(out.reading.id, 'r1');
    assert.equal(out.reading.derived.combinedChlorine, 2);
    assert.equal(out.reading.derived.combinedChlorineStatus, 'critical');
    assert.ok(typeof out.reading.derived.combinedChlorineWarning === 'string');
    assert.equal(typeof out.reading.derived.lsi, 'number');
    assert.equal(out.reading.fieldStatus.chlorine, 'warning'); // 1 ppm is within 10% of the 1–3 range's bottom edge
    const text = (result.content as { type: string; text: string }[])[0].text;
    assert.match(text, /Combined chlorine: 2\.0 ppm \(critical\)/);
    assert.match(text, /smells of chloramine/);
    await client.close();
  });

  it('list_readings paginates with before cursor and honours since', async () => {
    const client = await connect(TOKEN);
    const page1 = structured<{ count: number; readings: { id: string }[]; has_more: boolean; next_before: string | null }>(
      await client.callTool({ name: 'poolstatus_list_readings', arguments: { limit: 2 } }),
    );
    assert.deepEqual(page1.readings.map((r) => r.id), ['r1', 'r2']);
    assert.equal(page1.has_more, true);
    assert.ok(page1.next_before);

    const page2 = structured<typeof page1>(
      await client.callTool({ name: 'poolstatus_list_readings', arguments: { limit: 2, before: page1.next_before } }),
    );
    assert.deepEqual(page2.readings.map((r) => r.id), ['r3', 'r4']);
    assert.equal(page2.has_more, false);

    const recent = structured<typeof page1>(
      await client.callTool({ name: 'poolstatus_list_readings', arguments: { since: new Date(now - 5 * DAY).toISOString() } }),
    );
    assert.deepEqual(recent.readings.map((r) => r.id), ['r1', 'r2', 'r3']);
    await client.close();
  });

  it('list_readings rejects a malformed date', async () => {
    const client = await connect(TOKEN);
    const result = await client.callTool({ name: 'poolstatus_list_readings', arguments: { since: 'yesterday' } });
    assert.equal(result.isError, true);
    await client.close();
  });

  it('get_reading_trends summarises the window including derived metrics', async () => {
    const client = await connect(TOKEN);
    const out = structured<{ readings_considered: number; metrics: Record<string, { count: number; latest: number | null; average: number | null; direction: string | null; status: string | null }> }>(
      await client.callTool({ name: 'poolstatus_get_reading_trends', arguments: { days: 7 } }),
    );
    assert.equal(out.readings_considered, 3); // r4 is 10 days old
    assert.equal(out.metrics.chlorine.count, 3);
    assert.equal(out.metrics.chlorine.latest, 1);
    assert.equal(out.metrics.chlorine.average, 1.83);
    assert.equal(out.metrics.chlorine.direction, 'falling');
    assert.equal(out.metrics.combinedChlorine.count, 2);
    assert.equal(out.metrics.combinedChlorine.status, 'critical');
    assert.equal(out.metrics.lsi.count, 2);
    assert.equal(out.metrics.cyanuricAcid.count, 0);
    assert.equal(out.metrics.cyanuricAcid.latest, null);
    await client.close();
  });

  it('list_tasks filters by status and frequency', async () => {
    const client = await connect(TOKEN);
    const open = structured<{ tasks: { id: string }[] }>(await client.callTool({ name: 'poolstatus_list_tasks', arguments: {} }));
    assert.deepEqual(open.tasks.map((t) => t.id), ['t1']);
    const daily = structured<{ tasks: { id: string }[] }>(await client.callTool({ name: 'poolstatus_list_tasks', arguments: { status: 'all', frequency: 'daily' } }));
    assert.deepEqual(daily.tasks.map((t) => t.id), ['t2']);
    await client.close();
  });

  it('list_inventory flags low stock', async () => {
    const client = await connect(TOKEN);
    const out = structured<{ low_count: number; items: { name: string; low: boolean }[] }>(
      await client.callTool({ name: 'poolstatus_list_inventory', arguments: { low_only: true } }),
    );
    assert.equal(out.low_count, 1);
    assert.deepEqual(out.items.map((i) => i.name), ['Soda Ash']);
    await client.close();
  });

  it('list_equipment computes service due from last service or install', async () => {
    const client = await connect(TOKEN);
    const out = structured<{ due_count: number; items: { name: string; serviceDue: boolean; nextServiceDate: string | null }[] }>(
      await client.callTool({ name: 'poolstatus_list_equipment', arguments: {} }),
    );
    assert.equal(out.due_count, 1);
    const filter = out.items.find((i) => i.name === 'Sand Filter');
    const pump = out.items.find((i) => i.name === 'Main Pump');
    assert.equal(filter?.serviceDue, true);   // installed 400 days ago, never serviced, 12-month interval
    assert.equal(pump?.serviceDue, false);    // serviced 30 days ago
    await client.close();
  });

  it('get_schedule reports overdue', async () => {
    const client = await connect(TOKEN);
    const out = structured<{ schedule: { overdue: boolean; testFrequency: string } }>(
      await client.callTool({ name: 'poolstatus_get_schedule', arguments: {} }),
    );
    assert.equal(out.schedule.testFrequency, 'weekly');
    assert.equal(out.schedule.overdue, true);
    await client.close();
  });
});
