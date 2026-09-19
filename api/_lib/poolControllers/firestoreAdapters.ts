import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { Reading } from '../../../src/types';
import type { ReadingWriter, SyncState, SyncStateStore } from './sync';

// Sync state lives in its own collection rather than being inferred from
// the readings collection (e.g. "the newest reading with this notes tag")
// so dedupe stays correct even if a user edits or deletes an auto-logged
// reading from History. locked down to server-only access in
// firestore.rules — the Admin SDK bypasses rules anyway, but a doc ID of
// "{ownerUid}_{sourceId}" is still only meaningful to this job.
const SYNC_STATE_COLLECTION = 'poolControllerSyncState';

export function createFirestoreSyncStateStore(db: Firestore, ownerUid: string, sourceId: string): SyncStateStore {
  const doc = db.collection(SYNC_STATE_COLLECTION).doc(`${ownerUid}_${sourceId}`);

  return {
    async get(): Promise<SyncState | null> {
      const snapshot = await doc.get();
      const data = snapshot.data();
      if (!snapshot.exists || !(data?.lastReadingAt instanceof Timestamp)) return null;
      return { lastReadingAt: data.lastReadingAt.toDate() };
    },
    async set(state: SyncState): Promise<void> {
      await doc.set({ lastReadingAt: Timestamp.fromDate(state.lastReadingAt), updatedAt: Timestamp.now() });
    },
  };
}

export function createFirestoreReadingWriter(db: Firestore): ReadingWriter {
  return {
    async writeReading(reading: Omit<Reading, 'id'>): Promise<void> {
      await db.collection('readings').add({
        ...reading,
        timestamp: Timestamp.fromDate(reading.timestamp),
      });
    },
  };
}
