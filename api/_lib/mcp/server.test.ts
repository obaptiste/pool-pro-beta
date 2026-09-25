import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { InventoryItem, MaintenanceTask, Reading } from '../../../src/types';
import { handleMcpRequest } from './handler';
import { __resetRateLimitForTests } from '../rateLimit';
import { LATEST_READING_SEARCH_LIMIT, MAX_TREND_FETCH_ROWS, MAX_TREND_ROWS } from './server';
import { NotFoundError, UnitMismatchError, type AddTaskInput, type AdjustInventoryInput, type CreateReadingInput, type ListReadingsOptions, type PoolDataSource } from './types';

// Spread into every ad-hoc fixture below that only exercises read tools —
// keeps each of those focused on the one thing it's testing rather than
// repeating four stub methods it never calls.
const unimplementedWrites = {
  async createReading(): Promise<Reading> { throw new Error('createReading not used in this test'); },
  async addTask(): Promise<MaintenanceTask> { throw new Error('addTask not used in this test'); },
  async completeTask(): Promise<MaintenanceTask> { throw new Error('completeTask not used in this test'); },
  async adjustInventory(): Promise<InventoryItem> { throw new Error('adjustInventory not used in this test'); },
};

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
  ...unimplementedWrites,
};

// A separate, per-test mutable source for the write tools — memorySource
// above is shared by every read-tool test via the module-level httpServer
// and asserted against for exact fixture contents, so mutating it here
// would make those tests order-dependent. Ownership/ids mirror the
// Firestore source closely enough to exercise the same branches (unknown
// id -> NotFoundError, inventory clamped at 0) without needing Firestore.
function createWritableMemorySource(initialTasks: MaintenanceTask[] = [], initialInventory: InventoryItem[] = []): PoolDataSource {
  const tasks = [...initialTasks];
  const inventory = [...initialInventory];
  let nextId = 0;
  return {
    ...unimplementedWrites,
    async listReadings() { return []; },
    async listTasks() { return tasks; },
    async listInventory() { return inventory; },
    async listEquipment() { return []; },
    async getSchedule() { return null; },
    async createReading(input: CreateReadingInput): Promise<Reading> {
      return {
        id: `r${nextId++}`,
        uid: 'owner',
        timestamp: input.timestamp ?? new Date(now),
        chlorine: input.chlorine ?? null,
        totalChlorine: input.totalChlorine ?? null,
        sanitisationMv: input.sanitisationMv ?? null,
        ph: input.ph ?? null,
        alkalinity: input.alkalinity ?? null,
        temperature: input.temperature ?? null,
        differentialPressure: input.differentialPressure ?? null,
        calciumHardness: input.calciumHardness ?? null,
        cyanuricAcid: input.cyanuricAcid ?? null,
        notes: input.notes,
        photoUrl: `https://example.test/photos/${input.photo.contentType.split('/')[1]}-${input.photo.data.length}`,
      };
    },
    async addTask({ title, priority, frequency }: AddTaskInput): Promise<MaintenanceTask> {
      const task: MaintenanceTask = { id: `t${nextId++}`, uid: 'owner', title, completed: false, priority, frequency, isAI: true, createdAt: new Date(now) };
      tasks.push(task);
      return task;
    },
    async completeTask(id: string): Promise<MaintenanceTask> {
      const task = tasks.find((t) => t.id === id);
      if (!task) throw new NotFoundError(`No task with id "${id}".`);
      task.completed = true;
      return task;
    },
    async adjustInventory({ id, delta, unit }: AdjustInventoryInput): Promise<InventoryItem> {
      const item = inventory.find((i) => i.id === id);
      if (!item) throw new NotFoundError(`No inventory item with id "${id}".`);
      if (item.unit !== unit) throw new UnitMismatchError(`"${id}" is tracked in ${item.unit}, not ${unit}.`);
      item.quantity = Math.max(0, item.quantity + delta);
      return item;
    },
  };
}

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

// All MCP requests in this file come from 127.0.0.1 and share the rate
// limiter's one in-memory bucket for that key — without a reset, a test
// late in this growing file could trip the real per-IP limit purely from
// earlier tests' cumulative requests, not anything the failing test itself
// did wrong.
beforeEach(__resetRateLimitForTests);

async function connect(token: string | undefined): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  await client.connect(transport);
  return client;
}

// For tests that need a PoolDataSource other than the shared fixture above
// (a different row count, or data crafted to hit one specific branch)
// without perturbing the assertions that read from that shared fixture.
async function connectToSource(source: PoolDataSource): Promise<{ client: Client; close: () => void }> {
  const server = createServer((req, res) => {
    handleMcpRequest(req, res, { bearerToken: TOKEN, getSource: () => source }).catch((error) => {
      res.writeHead(500).end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  }));
  return { client, close: () => server.close() };
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
  it('lists the seven read-only tools and four write tools', async () => {
    const client = await connect(TOKEN);
    const { tools } = await client.listTools();
    const readOnly = ['poolstatus_get_latest_reading', 'poolstatus_get_reading_trends', 'poolstatus_get_schedule', 'poolstatus_list_equipment', 'poolstatus_list_inventory', 'poolstatus_list_readings', 'poolstatus_list_tasks'];
    const write = ['poolstatus_add_task', 'poolstatus_adjust_inventory', 'poolstatus_complete_task', 'poolstatus_log_reading'];
    assert.deepEqual(tools.map((t) => t.name).sort(), [...readOnly, ...write].sort());
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const name of readOnly) assert.equal(byName.get(name)?.annotations?.readOnlyHint, true, name);
    for (const name of write) assert.equal(byName.get(name)?.annotations?.readOnlyHint, false, name);
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
    assert.equal(
      (out.reading as unknown as { fieldWarnings: Record<string, string> }).fieldWarnings.sanitisationMv,
      'High ORP (750–850 mV), usually acceptable depending on context.',
    );
    const text = (result.content as { type: string; text: string }[])[0].text;
    assert.match(text, /Combined chlorine: 2\.0 ppm \(critical\)/);
    assert.match(text, /smells of chloramine/);
    assert.match(text, /ORP \/ sanitisation: 800 mV \(warning\) — High ORP \(750–850 mV\), usually acceptable depending on context\./);
    await client.close();
  });

  it('get_latest_reading includes the specific warning for a dangerously low ORP reading', async () => {
    // A bare 'critical' status doesn't tell a client what's wrong or what
    // to check — fieldWarnings carries the app's own explanation
    // (getSoftWarning, the same text History's badges show).
    const source: PoolDataSource = {
      async listReadings() { return [reading('low-orp', 0, { sanitisationMv: 233 })]; },
      async listTasks() { return []; },
      async listInventory() { return []; },
      async listEquipment() { return []; },
      async getSchedule() { return null; },
      ...unimplementedWrites,
    };
    const { client, close } = await connectToSource(source);
    const result = await client.callTool({ name: 'poolstatus_get_latest_reading', arguments: {} });
    const out = structured<{ reading: { fieldStatus: Record<string, string>; fieldWarnings: Record<string, string> } }>(result);
    assert.equal(out.reading.fieldStatus.sanitisationMv, 'critical');
    assert.equal(out.reading.fieldWarnings.sanitisationMv, 'Sanitisation may be too low (<650 mV).');
    const text = (result.content as { type: string; text: string }[])[0].text;
    assert.match(text, /ORP \/ sanitisation: 233 mV \(critical\) — Sanitisation may be too low \(<650 mV\)\./);
    await client.close();
    close();
  });

  it('get_latest_reading explains a near-edge warning that getSoftWarning has no message for', async () => {
    // chlorine 1.0 is inside the 1-3 range but within getRangeStatus's 10%
    // edge buffer -> 'warning', yet getSoftWarning only fires for values
    // truly outside the range, so it returns nothing for this one. Without
    // a fallback, fieldWarnings would have no entry despite fieldStatus
    // flagging the field.
    const source: PoolDataSource = {
      async listReadings() { return [reading('edge', 0, { chlorine: 1.0 })]; },
      async listTasks() { return []; },
      async listInventory() { return []; },
      async listEquipment() { return []; },
      async getSchedule() { return null; },
      ...unimplementedWrites,
    };
    const { client, close } = await connectToSource(source);
    const result = await client.callTool({ name: 'poolstatus_get_latest_reading', arguments: {} });
    const out = structured<{ reading: { fieldStatus: Record<string, string>; fieldWarnings: Record<string, string> } }>(result);
    assert.equal(out.reading.fieldStatus.chlorine, 'warning');
    assert.match(out.reading.fieldWarnings.chlorine, /Near the edge of the normal range \(1–3 ppm\)/);
    await client.close();
    close();
  });

  it('get_latest_reading skips a trailing note-only log to find the last real measurement', async () => {
    // A note saved after the actual test (handleSaveReading in App.tsx
    // doesn't count it as a completed test either) must not hide that
    // test's numbers behind an all-null "latest" row.
    const source: PoolDataSource = {
      async listReadings() {
        return [
          reading('note', 0, { notes: 'Backwashed the filter' }),
          reading('measurement', 0.1, { chlorine: 2, ph: 7.4 }),
        ];
      },
      async listTasks() { return []; },
      async listInventory() { return []; },
      async listEquipment() { return []; },
      async getSchedule() { return null; },
      ...unimplementedWrites,
    };
    const { client, close } = await connectToSource(source);
    const out = structured<{ reading: { id: string } | null }>(
      await client.callTool({ name: 'poolstatus_get_latest_reading', arguments: {} }),
    );
    assert.equal(out.reading?.id, 'measurement');
    await client.close();
    close();
  });

  it('get_latest_reading gives up after LATEST_READING_SEARCH_LIMIT note-only logs', async () => {
    const allNotes: PoolDataSource = {
      async listReadings({ limit }: ListReadingsOptions) {
        return Array.from({ length: Math.min(limit, LATEST_READING_SEARCH_LIMIT) }, (_, i) =>
          reading(`note${i}`, i, { notes: 'no test today' }),
        );
      },
      async listTasks() { return []; },
      async listInventory() { return []; },
      async listEquipment() { return []; },
      async getSchedule() { return null; },
      ...unimplementedWrites,
    };
    const { client, close } = await connectToSource(allNotes);
    const out = structured<{ reading: unknown }>(
      await client.callTool({ name: 'poolstatus_get_latest_reading', arguments: {} }),
    );
    assert.equal(out.reading, null);
    await client.close();
    close();
  });

  it('get_latest_reading and list_readings expose previousValues for an amended reading', async () => {
    // totalChlorine covers the amendment *clearing* a field (3 -> null):
    // the markdown must still show it (rather than skipping it as
    // "not measured") since that's exactly the amendment evidence this
    // field exists to preserve.
    const amended = reading('amended', 0, {
      chlorine: 1.5, ph: 7.6, totalChlorine: null,
      previousValues: { chlorine: 2.5, ph: null, totalChlorine: 3 },
    });
    amended.editedAt = new Date();
    const source: PoolDataSource = {
      async listReadings() { return [amended]; },
      async listTasks() { return []; },
      async listInventory() { return []; },
      async listEquipment() { return []; },
      async getSchedule() { return null; },
      ...unimplementedWrites,
    };
    const { client, close } = await connectToSource(source);
    const result = await client.callTool({ name: 'poolstatus_get_latest_reading', arguments: {} });
    const out = structured<{ reading: { previousValues: Record<string, number | null> } }>(result);
    assert.deepEqual(out.reading.previousValues, { chlorine: 2.5, ph: null, totalChlorine: 3 });
    const text = (result.content as { type: string; text: string }[])[0].text;
    assert.match(text, /Free chlorine: 1\.5 ppm \(was 2\.5 ppm\)/);
    assert.match(text, /pH: 7\.6 .*\(was not measured\)/);
    assert.match(text, /Total chlorine: not measured \(was 3 ppm\)/);
    await client.close();
    close();
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

  it('list_readings treats a date-only until as inclusive of the whole day', async () => {
    // A bare "2026-09-01" parses to that day's midnight start — used as-is
    // for an upper bound, it would exclude everything later that same day.
    const lateOnDay = { ...reading('late', 0, {}), timestamp: new Date('2026-09-01T23:30:00Z') };
    const nextDay = { ...reading('next', 0, {}), timestamp: new Date('2026-09-02T00:05:00Z') };
    const source: PoolDataSource = {
      async listReadings({ until }: ListReadingsOptions) {
        return [nextDay, lateOnDay].filter((r) => !until || r.timestamp <= until);
      },
      async listTasks() { return []; },
      async listInventory() { return []; },
      async listEquipment() { return []; },
      async getSchedule() { return null; },
      ...unimplementedWrites,
    };
    const { client, close } = await connectToSource(source);
    const out = structured<{ readings: { id: string }[] }>(
      await client.callTool({ name: 'poolstatus_list_readings', arguments: { until: '2026-09-01' } }),
    );
    assert.deepEqual(out.readings.map((r) => r.id), ['late']);
    await client.close();
    close();
  });

  it('list_readings rejects a malformed date', async () => {
    const client = await connect(TOKEN);
    const result = await client.callTool({ name: 'poolstatus_list_readings', arguments: { since: 'yesterday' } });
    assert.equal(result.isError, true);
    await client.close();
  });

  it('list_readings rejects a calendar-invalid date', async () => {
    // Date.parse would silently roll 2026-02-30 forward to March 2 instead
    // of rejecting it, querying a window the caller never asked for.
    const client = await connect(TOKEN);
    const result = await client.callTool({ name: 'poolstatus_list_readings', arguments: { since: '2026-02-30' } });
    assert.equal(result.isError, true);
    const valid = await client.callTool({ name: 'poolstatus_list_readings', arguments: { since: '2026-02-28T12:00:00Z' } });
    assert.notEqual(valid.isError, true);
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
      ...unimplementedWrites,
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

  it('get_reading_trends pages past note-only logs rather than letting them displace measurements', async () => {
    // Alternating measurement/note rows, cursor-respecting like the real
    // Firestore source, so a single MAX_TREND_ROWS+1-sized page never has
    // enough measurements on its own — this only passes if fetchTrendRows
    // actually continues to a second page rather than settling for what
    // one page found.
    const totalRawRows = (MAX_TREND_ROWS + 1) * 2 + 10;
    const interleaved: Reading[] = Array.from({ length: totalRawRows }, (_, i) =>
      reading(`r${i}`, i / (24 * 60), i % 2 === 0 ? { chlorine: 2 } : { notes: 'no test today' }),
    );
    const source: PoolDataSource = {
      async listReadings({ before, limit }: ListReadingsOptions) {
        return interleaved
          .filter((r) => {
            if (!before) return true;
            const rt = r.timestamp.getTime();
            const bt = before.timestamp.getTime();
            return rt !== bt ? rt < bt : r.id < before.id;
          })
          .slice(0, limit);
      },
      async listTasks() { return []; },
      async listInventory() { return []; },
      async listEquipment() { return []; },
      async getSchedule() { return null; },
      ...unimplementedWrites,
    };
    const { client, close } = await connectToSource(source);
    const out = structured<{ readings_considered: number; truncated: boolean; metrics: { chlorine: { count: number } } }>(
      await client.callTool({ name: 'poolstatus_get_reading_trends', arguments: { days: 1 } }),
    );
    assert.equal(out.readings_considered, MAX_TREND_ROWS);
    assert.equal(out.truncated, true);
    // Every one of the 500 kept rows must be a real measurement — none of
    // the interleaved notes leaked in, and none of the 500 real
    // measurements among the raw rows scanned were dropped.
    assert.equal(out.metrics.chlorine.count, MAX_TREND_ROWS);
    await client.close();
    close();
  });

  it('get_reading_trends stops at the fetch ceiling when a window is overwhelmingly note-only', async () => {
    let totalServed = 0;
    const allNotes: PoolDataSource = {
      async listReadings({ limit }: ListReadingsOptions) {
        // Always returns a full page of note-only rows — an unbounded loop
        // without the fetch ceiling; with it, this must still return.
        totalServed += limit;
        return Array.from({ length: limit }, (_, i) => reading(`note${i}`, i, { notes: 'no test' }));
      },
      async listTasks() { return []; },
      async listInventory() { return []; },
      async listEquipment() { return []; },
      async getSchedule() { return null; },
      ...unimplementedWrites,
    };
    const { client, close } = await connectToSource(allNotes);
    const out = structured<{ readings_considered: number; truncated: boolean }>(
      await client.callTool({ name: 'poolstatus_get_reading_trends', arguments: { days: 7 } }),
    );
    assert.equal(out.readings_considered, 0);
    assert.equal(out.truncated, true);
    // Confirms the ceiling actually bounded it rather than this mock
    // happening to stop on its own (it never would) — allow one page of
    // slack for the fetch that pushes the running total past the ceiling.
    assert.ok(totalServed <= MAX_TREND_FETCH_ROWS + (MAX_TREND_ROWS + 1), `expected bounded fetching, served ${totalServed} rows`);
    await client.close();
    close();
  });

  it('get_reading_trends explains flagged metrics, including the synthetic combinedChlorine and lsi series', async () => {
    // The same "why is this flagged" gap poolstatus_get_latest_reading had
    // (a bare status with no explanation) applied here too, for every
    // metric — including the two that aren't a raw Reading field and so
    // have no getSoftWarning of their own.
    const source: PoolDataSource = {
      async listReadings() {
        return [reading('bad', 0, {
          sanitisationMv: 233, chlorine: 1, totalChlorine: 3,
          ph: 8.5, temperature: 30, calciumHardness: 500, alkalinity: 300,
        })];
      },
      async listTasks() { return []; },
      async listInventory() { return []; },
      async listEquipment() { return []; },
      async getSchedule() { return null; },
      ...unimplementedWrites,
    };
    const { client, close } = await connectToSource(source);
    const result = await client.callTool({ name: 'poolstatus_get_reading_trends', arguments: { days: 1 } });
    const out = structured<{ metrics: Record<string, { status: string; warning: string | null }> }>(result);
    assert.equal(out.metrics.sanitisationMv.warning, 'Sanitisation may be too low (<650 mV).');
    assert.equal(out.metrics.combinedChlorine.status, 'critical');
    assert.match(out.metrics.combinedChlorine.warning ?? '', /Combined chlorine 2\.0 ppm \(>1\)/);
    assert.equal(out.metrics.lsi.status, 'critical');
    assert.match(out.metrics.lsi.warning ?? '', /LSI is scale-forming/);
    const text = (result.content as { type: string; text: string }[])[0].text;
    assert.match(text, /⚠ ORP \/ sanitisation: Sanitisation may be too low/);
    assert.match(text, /⚠ Combined chlorine: Combined chlorine 2\.0 ppm/);
    assert.match(text, /⚠ LSI: LSI is scale-forming/);
    await client.close();
    close();
  });

  it('get_reading_trends omits inconsistent free/total chlorine pairs from combined chlorine', async () => {
    // total < free is a measurement error (getCombinedChlorineWarning tells
    // the user to re-test), not a valid zero — it must not sneak into the
    // combined-chlorine average as combinedChlorineOf's clamped 0.
    const source: PoolDataSource = {
      async listReadings() {
        return [
          reading('good', 0, { chlorine: 1, totalChlorine: 2 }), // combined = 1
          reading('bad', 0.1, { chlorine: 2, totalChlorine: 1 }), // inconsistent — must be excluded
        ];
      },
      async listTasks() { return []; },
      async listInventory() { return []; },
      async listEquipment() { return []; },
      async getSchedule() { return null; },
      ...unimplementedWrites,
    };
    const { client, close } = await connectToSource(source);
    const out = structured<{ metrics: { combinedChlorine: { count: number; latest: number; average: number } } }>(
      await client.callTool({ name: 'poolstatus_get_reading_trends', arguments: { days: 1 } }),
    );
    assert.equal(out.metrics.combinedChlorine.count, 1);
    assert.equal(out.metrics.combinedChlorine.latest, 1);
    assert.equal(out.metrics.combinedChlorine.average, 1);
    await client.close();
    close();
  });

  it('get_reading_trends excludes note-only logs from readings_considered', async () => {
    // A log with no measurements (just a note) isn't a completed test per
    // handleSaveReading in App.tsx either — it must not inflate
    // readings_considered or produce a "1 reading" heading over an
    // otherwise-empty metrics table.
    const notesOnlySource: PoolDataSource = {
      async listReadings() {
        return [reading('note-only', 0, { notes: 'Topped up water level, no test today' })];
      },
      async listTasks() { return []; },
      async listInventory() { return []; },
      async listEquipment() { return []; },
      async getSchedule() { return null; },
      ...unimplementedWrites,
    };
    const { client, close } = await connectToSource(notesOnlySource);
    const out = structured<{ readings_considered: number }>(
      await client.callTool({ name: 'poolstatus_get_reading_trends', arguments: { days: 1 } }),
    );
    assert.equal(out.readings_considered, 0);
    await client.close();
    close();
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

// Real JPEG magic bytes (FF D8 FF) followed by filler — matchesImageSignature
// (server.ts) only checks the header, not that the rest is a well-formed
// image, so this is enough to pass without needing an actual photo file.
const samplePhoto = { data_base64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]).toString('base64'), content_type: 'image/jpeg' as const };

describe('MCP write tools', () => {
  it('log_reading requires at least one measurement — a photo alone is not a completed test', async () => {
    const { client, close } = await connectToSource(createWritableMemorySource());
    const result = await client.callTool({ name: 'poolstatus_log_reading', arguments: { photo: samplePhoto } });
    assert.equal(result.isError, true);
    assert.match((result.content as { type: string; text: string }[])[0].text, /at least one measurement/i);
    await client.close();
    close();
  });

  it('log_reading rejects a genuinely impossible value (negative concentration) without writing anything', async () => {
    const { client, close } = await connectToSource(createWritableMemorySource());
    const result = await client.callTool({ name: 'poolstatus_log_reading', arguments: { photo: samplePhoto, chlorine: -5 } });
    assert.equal(result.isError, true);
    assert.match((result.content as { type: string; text: string }[])[0].text, /Free Chlorine cannot be negative/);
    await client.close();
    close();
  });

  it('log_reading saves a negative ORP reading instead of blocking it — ORP is a signed potential, not a concentration', async () => {
    const { client, close } = await connectToSource(createWritableMemorySource());
    const result = await client.callTool({ name: 'poolstatus_log_reading', arguments: { photo: samplePhoto, sanitisation_mv: -50 } });
    assert.equal(result.isError, undefined);
    const out = structured<{ reading: { measurements: { sanitisationMv: number }; fieldWarnings: Record<string, string> } }>(result);
    assert.equal(out.reading.measurements.sanitisationMv, -50);
    assert.equal(out.reading.fieldWarnings.sanitisationMv, 'Sanitisation may be too low (<650 mV).');
    await client.close();
    close();
  });

  it('log_reading rejects malformed base64 without writing anything', async () => {
    const { client, close } = await connectToSource(createWritableMemorySource());
    const result = await client.callTool({
      name: 'poolstatus_log_reading',
      arguments: { photo: { data_base64: 'not-valid-base64!!', content_type: 'image/jpeg' }, ph: 7.4 },
    });
    assert.equal(result.isError, true);
    assert.match((result.content as { type: string; text: string }[])[0].text, /not valid base64/i);
    await client.close();
    close();
  });

  it('log_reading rejects valid base64 that is not actually the declared image type', async () => {
    const { client, close } = await connectToSource(createWritableMemorySource());
    const result = await client.callTool({
      name: 'poolstatus_log_reading',
      // Well-formed base64, but plain text, not a JPEG — must not satisfy
      // the photo-evidence requirement just because it decodes cleanly.
      arguments: { photo: { data_base64: Buffer.from('just some text, not a photo').toString('base64'), content_type: 'image/jpeg' }, ph: 7.4 },
    });
    assert.equal(result.isError, true);
    assert.match((result.content as { type: string; text: string }[])[0].text, /doesn't look like a valid image\/jpeg/);
    await client.close();
    close();
  });

  it('log_reading saves an extreme-but-conceivable value instead of blocking it (AGENTS.md: out-of-range must not prevent submission)', async () => {
    const { client, close } = await connectToSource(createWritableMemorySource());
    // Well past getHardValidationError's old pH<=14 ceiling — the manual
    // form still blocks this, but the MCP tool must not: a value this far
    // outside DEFAULT_RANGES still surfaces a warning via getSoftWarning.
    const result = await client.callTool({ name: 'poolstatus_log_reading', arguments: { photo: samplePhoto, ph: 20 } });
    assert.equal(result.isError, undefined);
    const out = structured<{ reading: { measurements: { ph: number }; fieldWarnings: Record<string, string> } }>(result);
    assert.equal(out.reading.measurements.ph, 20);
    assert.ok(out.reading.fieldWarnings.ph);
    await client.close();
    close();
  });

  it('log_reading rejects an implausibly far-future timestamp without writing anything', async () => {
    const { client, close } = await connectToSource(createWritableMemorySource());
    const result = await client.callTool({
      name: 'poolstatus_log_reading',
      arguments: { photo: samplePhoto, ph: 7.4, timestamp: '2099-01-01T00:00:00Z' },
    });
    assert.equal(result.isError, true);
    assert.match((result.content as { type: string; text: string }[])[0].text, /implausibly far in the future/);
    await client.close();
    close();
  });

  it('log_reading saves a value outside the normal range with a warning, same as the manual form', async () => {
    const { client, close } = await connectToSource(createWritableMemorySource());
    const result = await client.callTool({ name: 'poolstatus_log_reading', arguments: { photo: samplePhoto, sanitisation_mv: 233, notes: 'from a photo of the meter' } });
    assert.equal(result.isError, undefined);
    const out = structured<{ reading: { measurements: { sanitisationMv: number }; photoUrl: string; fieldWarnings: Record<string, string> } }>(result);
    assert.equal(out.reading.measurements.sanitisationMv, 233);
    assert.ok(out.reading.photoUrl);
    assert.equal(out.reading.fieldWarnings.sanitisationMv, 'Sanitisation may be too low (<650 mV).');
    const text = (result.content as { type: string; text: string }[])[0].text;
    assert.match(text, /Reading logged\./);
    assert.match(text, /Photo evidence: /);
    assert.match(text, /Sanitisation may be too low/);
    await client.close();
    close();
  });

  it('add_task defaults priority/frequency and marks the task AI-suggested', async () => {
    const { client, close } = await connectToSource(createWritableMemorySource());
    const result = await client.callTool({ name: 'poolstatus_add_task', arguments: { title: 'Backwash the filter' } });
    const out = structured<{ task: { title: string; priority: string; frequency: string; isAI: boolean } }>(result);
    assert.equal(out.task.title, 'Backwash the filter');
    assert.equal(out.task.priority, 'medium');
    assert.equal(out.task.frequency, 'once');
    assert.equal(out.task.isAI, true);
    await client.close();
    close();
  });

  it('complete_task marks the task done and errors on an unknown id', async () => {
    const source = createWritableMemorySource([
      { id: 't1', uid: 'owner', title: 'Backwash filter', completed: false, priority: 'high', frequency: 'monthly', createdAt: new Date(now) },
    ]);
    const { client, close } = await connectToSource(source);
    const done = structured<{ task: { completed: boolean } }>(
      await client.callTool({ name: 'poolstatus_complete_task', arguments: { id: 't1' } }),
    );
    assert.equal(done.task.completed, true);

    const missing = await client.callTool({ name: 'poolstatus_complete_task', arguments: { id: 'nope' } });
    assert.equal(missing.isError, true);
    assert.match((missing.content as { type: string; text: string }[])[0].text, /No task with id "nope"/);
    await client.close();
    close();
  });

  it('adjust_inventory adds and consumes stock, clamping at 0, and errors on an unknown id', async () => {
    const source = createWritableMemorySource([], [
      { id: 'i1', uid: 'owner', name: 'Soda Ash', quantity: 2, unit: 'kg', minThreshold: 1 },
    ]);
    const { client, close } = await connectToSource(source);
    const added = structured<{ item: { quantity: number } }>(
      await client.callTool({ name: 'poolstatus_adjust_inventory', arguments: { id: 'i1', delta: 3, unit: 'kg' } }),
    );
    assert.equal(added.item.quantity, 5);

    const consumed = structured<{ item: { quantity: number; low: boolean } }>(
      await client.callTool({ name: 'poolstatus_adjust_inventory', arguments: { id: 'i1', delta: -100, unit: 'kg' } }),
    );
    assert.equal(consumed.item.quantity, 0);
    assert.equal(consumed.item.low, true);

    const missing = await client.callTool({ name: 'poolstatus_adjust_inventory', arguments: { id: 'nope', delta: 1, unit: 'kg' } });
    assert.equal(missing.isError, true);
    assert.match((missing.content as { type: string; text: string }[])[0].text, /No inventory item with id "nope"/);
    await client.close();
    close();
  });

  it('adjust_inventory rejects a unit that does not match the item\'s own unit, without applying the delta', async () => {
    const source = createWritableMemorySource([], [
      { id: 'i1', uid: 'owner', name: 'Muriatic Acid', quantity: 5, unit: 'L', minThreshold: 1 },
    ]);
    const { client, close } = await connectToSource(source);
    // "2 gallons" against a litres-tracked item must not be silently
    // treated as "2 L" — that would misrecord how much is actually left.
    const result = await client.callTool({ name: 'poolstatus_adjust_inventory', arguments: { id: 'i1', delta: -2, unit: 'gallons' } });
    assert.equal(result.isError, true);
    assert.match((result.content as { type: string; text: string }[])[0].text, /tracked in L, not gallons/);

    const unchanged = structured<{ items: { quantity: number }[] }>(
      await client.callTool({ name: 'poolstatus_list_inventory', arguments: {} }),
    );
    assert.equal(unchanged.items[0].quantity, 5);
    await client.close();
    close();
  });
});
