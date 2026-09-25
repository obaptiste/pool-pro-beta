import { randomUUID } from 'node:crypto';
import { FieldPath, Timestamp, type Firestore, type Query } from 'firebase-admin/firestore';
import { getDownloadURL } from 'firebase-admin/storage';
import { FirebaseAdminConfigError, getAdminApp, getFirestoreAdmin, getStorageAdmin, resolveOwnerUid } from '../firebaseAdmin';
import { NUMERIC_READING_FIELDS } from '../../../src/lib/readingValidation';
import type { EquipmentItem, InventoryItem, MaintenanceSchedule, MaintenanceTask, Reading } from '../../../src/types';
import { NotFoundError, type AddTaskInput, type AdjustInventoryInput, type CreateReadingInput, type ListReadingsOptions, type PoolDataSource } from './types';

export const McpConfigError = FirebaseAdminConfigError;

const toDate = (value: unknown): Date | null => (value instanceof Timestamp ? value.toDate() : null);
const numOrNull = (value: unknown): number | null => (typeof value === 'number' ? value : null);

// handleUpdateReading in App.tsx stores the fields an edit overwrote as a
// map keyed by field name (present, even as null, only for fields that
// actually changed) — the original evidence behind an amended reading.
// Without mapping it here, an MCP client asking about a reading has no
// way to recover what it originally said before an edit.
function toPreviousValues(value: unknown): Reading['previousValues'] {
  if (!value || typeof value !== 'object') return undefined;
  const result: NonNullable<Reading['previousValues']> = {};
  for (const field of NUMERIC_READING_FIELDS) {
    const raw = (value as Record<string, unknown>)[field];
    if (raw === null || typeof raw === 'number') result[field] = raw as number | null;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

const PHOTO_EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Uploads a reading's evidence photo and returns a stable, unexpiring
 * download URL via the Admin SDK's own getDownloadURL() helper — chosen
 * over a signed URL because Google Cloud Storage caps V4 signed URLs at 7
 * days, which would silently break the link long after the reading it
 * evidences is still on record. Access is gated by the download token
 * being unguessable, not by bucket-wide public ACLs.
 */
async function uploadReadingPhoto(ownerUid: string, readingId: string, photo: CreateReadingInput['photo']): Promise<string> {
  const extension = PHOTO_EXTENSION_BY_CONTENT_TYPE[photo.contentType] ?? 'bin';
  const path = `readingPhotos/${ownerUid}/${readingId}.${extension}`;
  const file = getStorageAdmin().file(path);
  await file.save(photo.data, {
    contentType: photo.contentType,
    metadata: { metadata: { firebaseStorageDownloadTokens: randomUUID() } },
  });
  return getDownloadURL(file);
}

// Mirrors handleSaveReading's daysToAdd map in App.tsx — kept in sync by
// hand since it's a small, stable literal not worth a shared import for.
const DAYS_BY_TEST_FREQUENCY: Record<MaintenanceSchedule['testFrequency'], number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
};

/**
 * Advances schedules/{ownerUid} the same way handleSaveReading (App.tsx)
 * does after a manual reading with at least one measurement: lastTestDate
 * to this reading's own timestamp, nextTestDate that many days out per
 * the current cadence. Defaults testFrequency to 'weekly' (App.tsx's own
 * initial state) when no schedule doc exists yet, so logging a reading
 * before the operator has ever opened schedule settings still creates a
 * sensible one rather than leaving nextTestDate unset.
 */
async function advanceSchedule(db: Firestore, ownerUid: string, testedAt: Date): Promise<void> {
  const ref = db.collection('schedules').doc(ownerUid);
  const existing = (await ref.get()).data();
  const testFrequency: MaintenanceSchedule['testFrequency'] = existing?.testFrequency ?? 'weekly';
  const nextTest = new Date(testedAt);
  nextTest.setDate(nextTest.getDate() + DAYS_BY_TEST_FREQUENCY[testFrequency]);
  await ref.set(
    {
      uid: ownerUid,
      testFrequency,
      remindersEnabled: Boolean(existing?.remindersEnabled),
      lastTestDate: Timestamp.fromDate(testedAt),
      nextTestDate: Timestamp.fromDate(nextTest),
    },
    { merge: true },
  );
}

/**
 * Builds the Firestore-backed data source. This is `async` and does all
 * of its configuration checks and the owner-uid lookup up front, rather
 * than deferring them to the first query: `api/mcp.ts` awaits this once
 * per warm instance before ever connecting the MCP server, so a
 * misconfigured deployment (missing/invalid service account, no owner
 * set, an owner email that doesn't resolve) surfaces as a clean 503 on
 * connection instead of every tool call failing in-band after the client
 * has already been told the server is healthy.
 */
export async function createFirestoreSource(): Promise<PoolDataSource> {
  // api/mcp.ts retries a failed create by calling this again on the next
  // request — getAdminApp() reuses the existing default app rather than
  // recreating it, so a transient failure after the app already
  // initialized (e.g. the owner-email lookup) can be retried without
  // hitting "the default Firebase app already exists".
  const ownerUid = await resolveOwnerUid(getAdminApp());
  const db = getFirestoreAdmin();

  // The Admin SDK bypasses firestore.rules entirely, so this uid pin is
  // the only thing standing between a valid bearer token and every user's
  // data — every query below goes through it.
  const ownedBy = (collection: string): Query => db.collection(collection).where('uid', '==', ownerUid);

  return {
    async listReadings({ since, until, before, limit }: ListReadingsOptions): Promise<Reading[]> {
      // Ordered by timestamp then document ID so the pair forms a total
      // order even when two readings share a timestamp — `before`'s
      // startAfter cursor relies on that same compound key to page
      // correctly across a tie instead of skipping or repeating rows.
      let query = ownedBy('readings').orderBy('timestamp', 'desc').orderBy(FieldPath.documentId(), 'desc');
      if (since) query = query.where('timestamp', '>=', Timestamp.fromDate(since));
      if (until) query = query.where('timestamp', '<=', Timestamp.fromDate(until));
      if (before) query = query.startAfter(Timestamp.fromDate(before.timestamp), before.id);
      const snapshot = await query.limit(limit).get();
      return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          uid: String(data.uid),
          timestamp: toDate(data.timestamp) ?? new Date(0),
          chlorine: numOrNull(data.chlorine),
          totalChlorine: numOrNull(data.totalChlorine),
          sanitisationMv: numOrNull(data.sanitisationMv),
          ph: numOrNull(data.ph),
          alkalinity: numOrNull(data.alkalinity),
          temperature: numOrNull(data.temperature),
          differentialPressure: numOrNull(data.differentialPressure),
          calciumHardness: numOrNull(data.calciumHardness),
          cyanuricAcid: numOrNull(data.cyanuricAcid),
          notes: typeof data.notes === 'string' && data.notes ? data.notes : undefined,
          photoUrl: typeof data.photoUrl === 'string' ? data.photoUrl : undefined,
          editedAt: toDate(data.editedAt) ?? undefined,
          previousValues: toPreviousValues(data.previousValues),
        };
      });
    },

    async listTasks(): Promise<MaintenanceTask[]> {
      const snapshot = await ownedBy('tasks').orderBy('createdAt', 'desc').get();
      return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          uid: String(data.uid),
          title: String(data.title ?? ''),
          completed: Boolean(data.completed),
          priority: data.priority,
          frequency: data.frequency,
          isAI: Boolean(data.isAI),
          createdAt: toDate(data.createdAt) ?? new Date(0),
        };
      });
    },

    async listInventory(): Promise<InventoryItem[]> {
      const snapshot = await ownedBy('inventory').get();
      return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          uid: String(data.uid),
          name: String(data.name ?? ''),
          quantity: numOrNull(data.quantity) ?? 0,
          unit: String(data.unit ?? ''),
          minThreshold: numOrNull(data.minThreshold) ?? 0,
        };
      });
    },

    async listEquipment(): Promise<EquipmentItem[]> {
      const snapshot = await ownedBy('equipment').get();
      return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          uid: String(data.uid),
          name: String(data.name ?? ''),
          installDate: toDate(data.installDate) ?? new Date(0),
          lastServiceDate: toDate(data.lastServiceDate) ?? undefined,
          serviceIntervalMonths: numOrNull(data.serviceIntervalMonths) ?? undefined,
        };
      });
    },

    async getSchedule(): Promise<MaintenanceSchedule | null> {
      const doc = await db.collection('schedules').doc(ownerUid).get();
      const data = doc.data();
      if (!doc.exists || !data) return null;
      return {
        uid: ownerUid,
        testFrequency: data.testFrequency,
        lastTestDate: toDate(data.lastTestDate),
        nextTestDate: toDate(data.nextTestDate),
        remindersEnabled: Boolean(data.remindersEnabled),
      };
    },

    async createReading(input: CreateReadingInput): Promise<Reading> {
      // The doc's own id doubles as the photo's storage path, so the
      // reference is allocated before the write — same reason sync.ts
      // assigns an id up front (App.tsx's listener needs doc.id restored).
      const ref = db.collection('readings').doc();
      const photoUrl = await uploadReadingPhoto(ownerUid, ref.id, input.photo);
      const timestamp = input.timestamp ?? new Date();
      const record = {
        // App.tsx's readings listener spreads doc.data() without restoring
        // doc.id (see handleSaveReading and sync.ts) — a reading document
        // missing this field renders with id: undefined, breaking React
        // keys and History's edit/delete targets.
        id: ref.id,
        uid: ownerUid,
        timestamp: Timestamp.fromDate(timestamp),
        chlorine: input.chlorine ?? null,
        totalChlorine: input.totalChlorine ?? null,
        sanitisationMv: input.sanitisationMv ?? null,
        ph: input.ph ?? null,
        alkalinity: input.alkalinity ?? null,
        temperature: input.temperature ?? null,
        differentialPressure: input.differentialPressure ?? null,
        calciumHardness: input.calciumHardness ?? null,
        cyanuricAcid: input.cyanuricAcid ?? null,
        ...(input.notes ? { notes: input.notes } : {}),
        photoUrl,
      };
      await ref.set(record);
      // Every poolstatus_log_reading call carries at least one measurement
      // (server.ts rejects a photo-only call), so — like handleSaveReading
      // in App.tsx — this always counts as a completed test and advances
      // the schedule the same way a manual save does; otherwise the
      // dashboard and poolstatus_get_schedule would keep reporting the
      // last *manual* test as due even right after a photo-backed one.
      await advanceSchedule(db, ownerUid, timestamp);
      return {
        id: ref.id,
        uid: ownerUid,
        timestamp,
        chlorine: record.chlorine,
        totalChlorine: record.totalChlorine,
        sanitisationMv: record.sanitisationMv,
        ph: record.ph,
        alkalinity: record.alkalinity,
        temperature: record.temperature,
        differentialPressure: record.differentialPressure,
        calciumHardness: record.calciumHardness,
        cyanuricAcid: record.cyanuricAcid,
        notes: input.notes,
        photoUrl,
      };
    },

    async addTask({ title, priority, frequency }: AddTaskInput): Promise<MaintenanceTask> {
      const ref = db.collection('tasks').doc();
      const createdAt = new Date();
      // isAI: true to match GeminiAssistant's own task-creation flow — a
      // task an MCP conversation asked for is the same kind of
      // AI-suggested item, so poolstatus_list_tasks labels it the same way.
      const record = { uid: ownerUid, title, completed: false, priority, frequency, isAI: true, createdAt: Timestamp.fromDate(createdAt) };
      await ref.set(record);
      return { id: ref.id, uid: ownerUid, title, completed: false, priority, frequency, isAI: true, createdAt };
    },

    async completeTask(id: string): Promise<MaintenanceTask> {
      const ref = db.collection('tasks').doc(id);
      const doc = await ref.get();
      const data = doc.data();
      if (!doc.exists || !data || data.uid !== ownerUid) {
        throw new NotFoundError(`No task with id "${id}".`);
      }
      await ref.update({ completed: true });
      return {
        id: doc.id,
        uid: ownerUid,
        title: String(data.title ?? ''),
        completed: true,
        priority: data.priority,
        frequency: data.frequency,
        isAI: Boolean(data.isAI),
        createdAt: toDate(data.createdAt) ?? new Date(0),
      };
    },

    async adjustInventory({ id, delta }: AdjustInventoryInput): Promise<InventoryItem> {
      const ref = db.collection('inventory').doc(id);
      // Read-modify-write in a transaction: two overlapping adjustments
      // (concurrent MCP calls, or a client retry racing the original)
      // would otherwise both read the same starting quantity and one
      // delta could silently overwrite the other instead of both applying.
      return db.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        const data = doc.data();
        if (!doc.exists || !data || data.uid !== ownerUid) {
          throw new NotFoundError(`No inventory item with id "${id}".`);
        }
        // Matches Inventory.tsx's own decrement button: stock never goes
        // negative, however large a consuming delta is requested.
        const quantity = Math.max(0, (numOrNull(data.quantity) ?? 0) + delta);
        tx.update(ref, { quantity });
        return {
          id: doc.id,
          uid: ownerUid,
          name: String(data.name ?? ''),
          quantity,
          unit: String(data.unit ?? ''),
          minThreshold: numOrNull(data.minThreshold) ?? 0,
        };
      });
    },
  };
}
