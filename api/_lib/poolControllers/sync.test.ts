import assert from 'node:assert/strict';
import test from 'node:test';
import { syncLatestReading, type ReadingWriter, type SyncState, type SyncStateStore } from './sync';
import type { PoolControllerReading, PoolControllerSource } from './types';

class FakeSource implements PoolControllerSource {
  readonly id = 'fake-source';
  constructor(private reading: PoolControllerReading | null) {}
  async getLatestReading() {
    return this.reading;
  }
}

class FakeStateStore implements SyncStateStore {
  constructor(private state: SyncState | null = null) {}
  async get() {
    return this.state;
  }
  async set(state: SyncState) {
    this.state = state;
  }
}

class FakeWriter implements ReadingWriter {
  written: Array<Parameters<ReadingWriter['writeReading']>[0]> = [];
  async writeReading(reading: Parameters<ReadingWriter['writeReading']>[0]) {
    this.written.push(reading);
  }
}

const sampleReading: PoolControllerReading = {
  ph: 7.4,
  sanitisationMv: 650,
  temperature: 28.1,
  recordedAt: new Date('2026-09-19T12:00:00.000Z'),
};

test('writes a reading and advances sync state on first sync', async () => {
  const source = new FakeSource(sampleReading);
  const stateStore = new FakeStateStore(null);
  const writer = new FakeWriter();

  const result = await syncLatestReading({ source, stateStore, writer, ownerUid: 'uid-1' });

  assert.deepEqual(result, { written: true, outcome: 'synced' });
  assert.equal(writer.written.length, 1);
  assert.equal(writer.written[0].ph, 7.4);
  assert.equal(writer.written[0].sanitisationMv, 650);
  assert.equal(writer.written[0].temperature, 28.1);
  assert.equal(writer.written[0].uid, 'uid-1');
  assert.equal(writer.written[0].notes, 'Auto-logged from fake-source');
  assert.deepEqual(await stateStore.get(), { lastReadingAt: sampleReading.recordedAt });
});

test('unmapped chemistry fields (chlorine, alkalinity, etc.) stay null — a controller reading is not a full manual test', async () => {
  const writer = new FakeWriter();
  await syncLatestReading({ source: new FakeSource(sampleReading), stateStore: new FakeStateStore(null), writer, ownerUid: 'uid-1' });

  assert.equal(writer.written[0].chlorine, null);
  assert.equal(writer.written[0].totalChlorine, null);
  assert.equal(writer.written[0].alkalinity, null);
  assert.equal(writer.written[0].calciumHardness, null);
  assert.equal(writer.written[0].cyanuricAcid, null);
  assert.equal(writer.written[0].differentialPressure, null);
});

test('is a no-op when the source has no reading at all', async () => {
  const writer = new FakeWriter();
  const stateStore = new FakeStateStore(null);
  const result = await syncLatestReading({ source: new FakeSource(null), stateStore, writer, ownerUid: 'uid-1' });

  assert.deepEqual(result, { written: false, outcome: 'no-reading-available' });
  assert.equal(writer.written.length, 0);
  assert.equal(await stateStore.get(), null);
});

test('is a no-op when the reading is not newer than the last synced one (repeat poll)', async () => {
  const writer = new FakeWriter();
  const stateStore = new FakeStateStore({ lastReadingAt: sampleReading.recordedAt });
  const result = await syncLatestReading({ source: new FakeSource(sampleReading), stateStore, writer, ownerUid: 'uid-1' });

  assert.deepEqual(result, { written: false, outcome: 'not-newer-than-last-sync' });
  assert.equal(writer.written.length, 0);
});

test('writes again once the controller reports a strictly newer reading', async () => {
  const writer = new FakeWriter();
  const stateStore = new FakeStateStore({ lastReadingAt: new Date('2026-09-19T11:00:00.000Z') });
  const result = await syncLatestReading({ source: new FakeSource(sampleReading), stateStore, writer, ownerUid: 'uid-1' });

  assert.deepEqual(result, { written: true, outcome: 'synced' });
  assert.equal(writer.written.length, 1);
});
