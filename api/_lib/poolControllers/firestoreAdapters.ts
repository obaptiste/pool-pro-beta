import { randomUUID } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { Reading } from '../../../src/types';
import { CARRY_FORWARD_FIELDS, type CarryForwardFields, type PoolControllerSyncStore } from './sync';

// Sync state lives in its own collection rather than being inferred from
// the readings collection (e.g. "the newest reading with this notes tag")
// so dedupe stays correct even if a user edits or deletes an auto-logged
// reading from History. Locked down to server-only access in
// firestore.rules — the Admin SDK bypasses rules anyway, but a doc ID of
// "{ownerUid}_{sourceId}" is still only meaningful to this job.
const SYNC_STATE_COLLECTION = 'poolControllerSyncState';

export function createFirestoreSyncStore(db: Firestore, ownerUid: string): PoolControllerSyncStore {
  return {
    async syncIfNewer(sourceId: string, reading: Omit<Reading, 'id'>): Promise<boolean> {
      const stateRef = db.collection(SYNC_STATE_COLLECTION).doc(`${ownerUid}_${sourceId}`);
      const recordedAt = reading.timestamp;

      // The dedupe check, the reading write, and the state advance all
      // happen inside one transaction: Vercel Cron and the GitHub Actions
      // poller both hit this job on independent schedules and can overlap
      // (both fire at 06:00 UTC daily), so a plain read-then-write would
      // let two concurrent runs each see the old marker and double-write.
      // A transaction also means a crash between "write the reading" and
      // "advance the marker" can't happen — it's one atomic commit.
      return db.runTransaction(async (tx) => {
        const stateSnap = await tx.get(stateRef);
        const lastReadingAt = stateSnap.data()?.lastReadingAt;
        if (lastReadingAt instanceof Timestamp && recordedAt.getTime() <= lastReadingAt.toDate().getTime()) {
          return false;
        }

        // App.tsx's reading listener spreads `doc.data()` without
        // restoring `doc.id` (see handleSaveReading, which stores the
        // same id both as the doc's own ID and as an `id` field) — a
        // reading missing that field renders with `id: undefined`,
        // breaking React keys and History's edit/delete.
        const id = randomUUID();
        const readingRef = db.collection('readings').doc(id);
        tx.set(readingRef, { ...reading, id, timestamp: Timestamp.fromDate(recordedAt) });
        tx.set(stateRef, { lastReadingAt: Timestamp.fromDate(recordedAt), updatedAt: Timestamp.now() });
        return true;
      });
    },
  };
}

/**
 * Builds a lookup for the most recent known value of each
 * CARRY_FORWARD_FIELDS field, scanning a bounded window of recent
 * readings (of any source) rather than a single fixed query per field.
 */
export function createFirestoreCarryForwardLookup(db: Firestore, ownerUid: string, sampleSize = 50): () => Promise<Partial<CarryForwardFields>> {
  return async () => {
    const snapshot = await db
      .collection('readings')
      .where('uid', '==', ownerUid)
      .orderBy('timestamp', 'desc')
      .limit(sampleSize)
      .get();

    const result: Partial<CarryForwardFields> = {};
    for (const doc of snapshot.docs) {
      const data = doc.data();
      for (const field of CARRY_FORWARD_FIELDS) {
        if (result[field] === undefined && typeof data[field] === 'number') {
          result[field] = data[field];
        }
      }
      if (Object.keys(result).length === CARRY_FORWARD_FIELDS.length) break;
    }
    return result;
  };
}
