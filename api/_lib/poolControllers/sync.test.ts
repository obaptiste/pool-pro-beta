import assert from 'node:assert/strict';
import test from 'node:test';
import { syncLatestReading, type CarryForwardFields, type PoolControllerSyncStore } from './sync';
import type { PoolControllerReading, PoolControllerSource } from './types';
import type { Reading } from '../../../src/types';

class FakeSource implements PoolControllerSource {
  readonly id = 'fake-source';
  constructor(private reading: PoolControllerReading | null) {}
  async getLatestReading() {
    return this.reading;
  }
}

/** Mirrors the Firestore adapter's dedupe contract — synchronous JS execution stands in for the transaction's atomicity for the purposes of exercising the decision logic. */
class FakeSyncStore implements PoolControllerSyncStore {
  written: Array<Omit<Reading, 'id'>> = [];
  private lastReadingAt = new Map<string, number>();

  constructor(initialLastReadingAt?: Date) {
    if (initialLastReadingAt) this.lastReadingAt.set('fake-source', initialLastReadingAt.getTime());
  }

  async syncIfNewer(sourceId: string, reading: Omit<Reading, 'id'>): Promise<boolean> {
    const last = this.lastReadingAt.get(sourceId);
    if (last != null && reading.timestamp.getTime() <= last) return false;
    this.written.push(reading);
    this.lastReadingAt.set(sourceId, reading.timestamp.getTime());
    return true;
  }
}

const sampleReading: PoolControllerReading = {
  ph: 7.4,
  sanitisationMv: 650,
  temperature: 28.1,
  recordedAt: new Date('2026-09-19T12:00:00.000Z'),
};

test('writes a reading on first sync', async () => {
  const store = new FakeSyncStore();
  const result = await syncLatestReading({ source: new FakeSource(sampleReading), store, ownerUid: 'uid-1' });

  assert.deepEqual(result, { written: true, outcome: 'synced' });
  assert.equal(store.written.length, 1);
  assert.equal(store.written[0].ph, 7.4);
  assert.equal(store.written[0].sanitisationMv, 650);
  assert.equal(store.written[0].temperature, 28.1);
  assert.equal(store.written[0].uid, 'uid-1');
  assert.equal(store.written[0].notes, 'Auto-logged from fake-source');
});

test('without a carry-forward lookup, unmeasured chemistry fields stay null', async () => {
  const store = new FakeSyncStore();
  await syncLatestReading({ source: new FakeSource(sampleReading), store, ownerUid: 'uid-1' });

  assert.equal(store.written[0].chlorine, null);
  assert.equal(store.written[0].totalChlorine, null);
  assert.equal(store.written[0].alkalinity, null);
  assert.equal(store.written[0].calciumHardness, null);
  assert.equal(store.written[0].cyanuricAcid, null);
  assert.equal(store.written[0].differentialPressure, null);
});

test('carries forward the most recent known value for fields the controller does not measure', async () => {
  const store = new FakeSyncStore();
  const carryForward: Partial<CarryForwardFields> = { chlorine: 2.1, alkalinity: 90, calciumHardness: 220 };
  await syncLatestReading({
    source: new FakeSource(sampleReading),
    store,
    ownerUid: 'uid-1',
    getCarryForwardFields: async () => carryForward,
  });

  assert.equal(store.written[0].chlorine, 2.1);
  assert.equal(store.written[0].alkalinity, 90);
  assert.equal(store.written[0].calciumHardness, 220);
  // Fields the lookup didn't return anything for still fall back to null.
  assert.equal(store.written[0].totalChlorine, null);
  assert.equal(store.written[0].cyanuricAcid, null);
  assert.equal(store.written[0].differentialPressure, null);
});

test('the controller\'s own measurements (ph/sanitisationMv/temperature) are never overridden by carry-forward', async () => {
  const store = new FakeSyncStore();
  await syncLatestReading({
    source: new FakeSource(sampleReading),
    store,
    ownerUid: 'uid-1',
    getCarryForwardFields: async () => ({ chlorine: 2.1 } as Partial<CarryForwardFields>),
  });

  assert.equal(store.written[0].ph, sampleReading.ph);
  assert.equal(store.written[0].sanitisationMv, sampleReading.sanitisationMv);
  assert.equal(store.written[0].temperature, sampleReading.temperature);
});

test('is a no-op when the source has no reading at all', async () => {
  const store = new FakeSyncStore();
  const result = await syncLatestReading({ source: new FakeSource(null), store, ownerUid: 'uid-1' });

  assert.deepEqual(result, { written: false, outcome: 'no-reading-available' });
  assert.equal(store.written.length, 0);
});

test('is a no-op when the reading is not newer than the last synced one (repeat poll)', async () => {
  const store = new FakeSyncStore(sampleReading.recordedAt);
  const result = await syncLatestReading({ source: new FakeSource(sampleReading), store, ownerUid: 'uid-1' });

  assert.deepEqual(result, { written: false, outcome: 'not-newer-than-last-sync' });
  assert.equal(store.written.length, 0);
});

test('writes again once the controller reports a strictly newer reading', async () => {
  const store = new FakeSyncStore(new Date('2026-09-19T11:00:00.000Z'));
  const result = await syncLatestReading({ source: new FakeSource(sampleReading), store, ownerUid: 'uid-1' });

  assert.deepEqual(result, { written: true, outcome: 'synced' });
  assert.equal(store.written.length, 1);
});
