import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, type Firestore, type Query } from 'firebase-admin/firestore';
import firebaseConfig from '../../../firebase-applet-config.json';
import type { EquipmentItem, InventoryItem, MaintenanceSchedule, MaintenanceTask, Reading } from '../../../src/types';
import type { ListReadingsOptions, PoolDataSource } from './types';

export class McpConfigError extends Error {}

// The Admin SDK bypasses firestore.rules entirely, so this source is the
// only thing standing between a valid bearer token and every user's data.
// Every query below is pinned to one owner's uid; nothing here takes a uid
// from the request.
let cachedApp: App | undefined;
let cachedOwnerUid: string | undefined;

function loadServiceAccount(): Record<string, unknown> {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new McpConfigError('FIREBASE_SERVICE_ACCOUNT is not set (service-account JSON, raw or base64-encoded).');
  }
  const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  try {
    return JSON.parse(json);
  } catch {
    throw new McpConfigError('FIREBASE_SERVICE_ACCOUNT is not valid JSON (raw or base64-encoded).');
  }
}

function getApp(): App {
  if (cachedApp) return cachedApp;
  cachedApp = getApps()[0] ?? initializeApp({
    credential: cert(loadServiceAccount()),
    projectId: firebaseConfig.projectId,
  });
  return cachedApp;
}

function getDb(): Firestore {
  // Same named database the client app targets (see src/firebase.ts).
  return getFirestore(getApp(), firebaseConfig.firestoreDatabaseId);
}

async function resolveOwnerUid(): Promise<string> {
  if (cachedOwnerUid) return cachedOwnerUid;
  const uid = process.env.POOLSTATUS_OWNER_UID?.trim();
  if (uid) return (cachedOwnerUid = uid);
  const email = process.env.POOLSTATUS_OWNER_EMAIL?.trim();
  if (!email) {
    throw new McpConfigError('Set POOLSTATUS_OWNER_UID (or POOLSTATUS_OWNER_EMAIL) to the account whose pool data the MCP server exposes.');
  }
  const user = await getAuth(getApp()).getUserByEmail(email);
  return (cachedOwnerUid = user.uid);
}

const toDate = (value: unknown): Date | null => (value instanceof Timestamp ? value.toDate() : null);
const numOrNull = (value: unknown): number | null => (typeof value === 'number' ? value : null);

export function createFirestoreSource(): PoolDataSource {
  const ownedBy = async (collection: string): Promise<Query> =>
    getDb().collection(collection).where('uid', '==', await resolveOwnerUid());

  return {
    async listReadings({ since, until, before, limit }: ListReadingsOptions): Promise<Reading[]> {
      let query = (await ownedBy('readings')).orderBy('timestamp', 'desc');
      if (since) query = query.where('timestamp', '>=', Timestamp.fromDate(since));
      if (until) query = query.where('timestamp', '<=', Timestamp.fromDate(until));
      if (before) query = query.where('timestamp', '<', Timestamp.fromDate(before));
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
        };
      });
    },

    async listTasks(): Promise<MaintenanceTask[]> {
      const snapshot = await (await ownedBy('tasks')).orderBy('createdAt', 'desc').get();
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
      const snapshot = await (await ownedBy('inventory')).get();
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
      const snapshot = await (await ownedBy('equipment')).get();
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
      const uid = await resolveOwnerUid();
      const doc = await getDb().collection('schedules').doc(uid).get();
      const data = doc.data();
      if (!doc.exists || !data) return null;
      return {
        uid,
        testFrequency: data.testFrequency,
        lastTestDate: toDate(data.lastTestDate),
        nextTestDate: toDate(data.nextTestDate),
        remindersEnabled: Boolean(data.remindersEnabled),
      };
    },
  };
}
