import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Reading } from '../../../src/types';
import { handleMcpRequest } from './handler';
import { MAX_TREND_ROWS } from './server';
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

// Newest first, like the Firestore source. rTie1/rTie2 deliberately share a
// timestamp (age 8 days, clear of every other fixed window used below) to
// exercise the compound (timestamp, id) pagination cursor across a tie —
// ordered by id descending, matching the Firestore source's
// .orderBy('timestamp', 'desc').orderBy(FieldPath.documentId(), 'desc').
const READINGS: Reading[] = [
  // sanitisationMv: 800 is in the app's "elevated, usually acceptable"
  // 750-850 band (see getSoftWarning) — DEFAULT_RANGES' generic range
  // banding would wrongly call this 'critical' since it's above the
  // range's 750 max; the dedicated ORP classifier must call it 'warning'.
  reading('r1', 0, { chlorine: 1, totalChlorine: 3, sanitisationMv: 800, ph: 7.6, alkalinity: 100, temperature: 28, calciumHardness: 250, notes: 'smells of chloramine' }),
  reading('r2', 1, { chlorine: 2, totalChlorine: 2.2, ph: 7.4, alkalinity: 100, temperature: 28, calciumHardness: 250 }),
  reading('r3', 2, { chlorine: 2.5, ph: 7.3 }),
  reading('rTie2', 8, { chlorine: 1.8 }),
  reading('rTie1', 8, { chlorine: 1.9 }),
  reading('r4', 10, { chlorine: 0, ph: 7.9 }),
];

const memorySource: PoolDataSource = {
  async listReadings({ since, until, before, limit }: ListReadingsOptions) {
    return READINGS
      .filter((r) => (!since || r.timestamp >= since) && (!until || r.timestamp <= until))
      .filter((r) => {
        if (!before) return true;
        const rt = r.timestamp.getTime();
        const bt = before.timestamp.getTime();
        return rt !== bt ? rt < bt : r.id < before.id;
      })
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

  it('returns 503 when the data source fails to initialize, without connecting a server', async () => {
    // Simulates a misconfigured deployment (e.g. FIREBASE_SERVICE_ACCOUNT
    // set but POOLSTATUS_OWNER_UID/EMAIL missing): getSource rejects, and
    // the handler must surface that as 503 rather than proceeding to
    // connect an MCP server that would only fail once a tool queries data.
    const server = createServer((req, res) => {
      handleMcpRequest(req, res, {
        bearerToken: TOKEN,
        getSource: () => Promise.reject(new Error('owner not configured')),
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: '{}',
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.match(body.error, /owner not configured/);
    server.close();
  });

  it('rejects a GET with no Accept header', async () => {
    const res = await fetch(baseUrl, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 406);
  });

  it('accepts GET to open a standalone SSE stream', async () => {
    // GET isn't rejected outright: with the right Accept header it opens a
    // standalone SSE stream for server-initiated messages, which is valid
    // even without session management. The transport's stateless-mode 405
    // ("each request must use a fresh transport") only fires on a *second*
    // request through the same transport instance — since every request
    // here (GET included) gets a brand-new transport, that path never
    // triggers. Abort once headers arrive so the open stream doesn't hang
    // the test.
    const controller = new AbortController();
    const res = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json, text/event-stream' },
      signal: controller.signal,
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
    controller.abort();
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
    assert.equal(out.reading.fieldStatus.sanitisationMv, 'warning'); // 800 mV is the "elevated, usually acceptable" band, not critical
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

    // r3 and the tied rTie2/rTie1 pair are next; a timestamp-only cursor
    // would either skip or duplicate one side of a tie straddling a page
    // boundary, so this walks a third page specifically to land the
    // boundary in the middle of the tie and prove neither happens.
    const page2 = structured<typeof page1>(
      await client.callTool({ name: 'poolstatus_list_readings', arguments: { limit: 2, before: page1.next_before } }),
    );
    assert.deepEqual(page2.readings.map((r) => r.id), ['r3', 'rTie2']);
    assert.equal(page2.has_more, true);
    assert.ok(page2.next_before);

    const page3 = structured<typeof page1>(
      await client.callTool({ name: 'poolstatus_list_readings', arguments: { limit: 2, before: page2.next_before } }),
    );
    assert.deepEqual(page3.readings.map((r) => r.id), ['rTie1', 'r4']);
    assert.equal(page3.has_more, false);

    const recent = structured<typeof page1>(
      await client.callTool({ name: 'poolstatus_list_readings', arguments: { since: new Date(now - 5 * DAY).toISOString() } }),
    );
    assert.deepEqual(recent.readings.map((r) => r.id), ['r1', 'r2', 'r3']);
    await client.close();
  });

  it('list_readings rejects a garbled pagination cursor', async () => {
    const client = await connect(TOKEN);
    const result = await client.callTool({ name: 'poolstatus_list_readings', arguments: { before: 'not-a-real-cursor' } });
    assert.equal(result.isError, true);
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
    const out = structured<{ readings_considered: number; truncated: boolean; metrics: Record<string, { count: number; latest: number | null; average: number | null; direction: string | null; status: string | null }> }>(
      await client.callTool({ name: 'poolstatus_get_reading_trends', arguments: { days: 7 } }),
    );
    assert.equal(out.readings_considered, 3); // r4 is 10 days old
    assert.equal(out.truncated, false);
    assert.equal(out.metrics.chlorine.count, 3);
    assert.equal(out.metrics.chlorine.latest, 1);
    assert.equal(out.metrics.chlorine.average, 1.83);
    assert.equal(out.metrics.chlorine.direction, 'falling');
    assert.equal(out.metrics.combinedChlorine.count, 2);
    assert.equal(out.metrics.combinedChlorine.status, 'critical');
    assert.equal(out.metrics.sanitisationMv.latest, 800);
    assert.equal(out.metrics.sanitisationMv.status, 'warning'); // elevated band, not critical
    assert.equal(out.metrics.lsi.count, 2);
    assert.equal(out.metrics.cyanuricAcid.count, 0);
    assert.equal(out.metrics.cyanuricAcid.latest, null);
    await client.close();
  });

  it('get_reading_trends reports truncation and adjusts from when the window exceeds the row cap', async () => {
    // A dedicated in-memory source with more rows than MAX_TREND_ROWS, one
    // minute apart — isolated from the shared fixture above so this
    // doesn't perturb readings_considered in the other trends test.
    const bigSource: PoolDataSource = {
      async listReadings({ limit }: ListReadingsOptions) {
        const total = MAX_TREND_ROWS + 50;
        return Array.from({ length: Math.min(limit, total) }, (_, i) =>
          reading(`big${i}`, i / (24 * 60), { chlorine: 2 }),
        );
      },
      async listTasks() { return []; },
      async listInventory() { return []; },
      async listEquipment() { return []; },
      async getSchedule() { return null; },
    };
    const bigServer = createServer((req, res) => {
      handleMcpRequest(req, res, { bearerToken: TOKEN, getSource: () => bigSource }).catch((error) => {
        res.writeHead(500).end(String(error));
      });
    });
    await new Promise<void>((resolve) => bigServer.listen(0, '127.0.0.1', resolve));
    const { port } = bigServer.address() as { port: number };
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/`), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }));

    const out = structured<{ readings_considered: number; truncated: boolean; from: string }>(
      await client.callTool({ name: 'poolstatus_get_reading_trends', arguments: { days: 1 } }),
    );
    assert.equal(out.readings_considered, MAX_TREND_ROWS);
    assert.equal(out.truncated, true);
    // 'from' should be the oldest row actually included (MAX_TREND_ROWS - 1
    // minutes ago) rather than the full 1-day requested window.
    const fromAgeMinutes = (Date.now() - new Date(out.from).getTime()) / 60_000;
    assert.ok(Math.abs(fromAgeMinutes - (MAX_TREND_ROWS - 1)) < 1, `expected 'from' ~${MAX_TREND_ROWS - 1} min ago, got ${fromAgeMinutes}`);

    await client.close();
    bigServer.close();
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
