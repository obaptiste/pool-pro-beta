import { FieldPath, Timestamp, type Query } from 'firebase-admin/firestore';
import { FirebaseAdminConfigError, getAdminApp, getFirestoreAdmin, resolveOwnerUid } from '../firebaseAdmin';
import { NUMERIC_READING_FIELDS } from '../../../src/lib/readingValidation';
import type { EquipmentItem, InventoryItem, MaintenanceSchedule, MaintenanceTask, Reading } from '../../../src/types';
import type { ListReadingsOptions, PoolDataSource } from './types';

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
  };
}
