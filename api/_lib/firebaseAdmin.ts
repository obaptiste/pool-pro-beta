import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export class FirebaseAdminConfigError extends Error {}

function loadServiceAccount(): Record<string, unknown> {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new FirebaseAdminConfigError('FIREBASE_SERVICE_ACCOUNT is not set (service-account JSON, raw or base64-encoded).');
  }
  const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  try {
    return JSON.parse(json);
  } catch {
    throw new FirebaseAdminConfigError('FIREBASE_SERVICE_ACCOUNT is not valid JSON (raw or base64-encoded).');
  }
}

/**
 * Reuses the existing default app rather than recreating it — a caller
 * that retries after a transient failure (e.g. the owner-email lookup's
 * network call) would otherwise hit "the default Firebase app already
 * exists" on the second attempt instead of actually retrying.
 */
function getOrInitApp(): App {
  return getApps()[0] ?? initializeApp({ credential: cert(loadServiceAccount()), projectId: firebaseConfig.projectId });
}

/**
 * Resolves the account whose data server-side code (Admin SDK, which
 * bypasses firestore.rules) is allowed to touch. POOLSTATUS_OWNER_UID is
 * preferred (no extra lookup); POOLSTATUS_OWNER_EMAIL is resolved via
 * Firebase Auth once.
 */
export async function resolveOwnerUid(app: App): Promise<string> {
  const uid = process.env.POOLSTATUS_OWNER_UID?.trim();
  if (uid) return uid;
  const email = process.env.POOLSTATUS_OWNER_EMAIL?.trim();
  if (!email) {
    throw new FirebaseAdminConfigError('Set POOLSTATUS_OWNER_UID (or POOLSTATUS_OWNER_EMAIL) to the account server-side code acts on behalf of.');
  }
  const user = await getAuth(app).getUserByEmail(email);
  return user.uid;
}

/**
 * Shared bootstrap for server-side (Admin SDK) Firestore access: used by
 * the read-only MCP source and by the pool-controller telemetry sync job.
 * Targets the same named database the client app uses (see src/firebase.ts).
 */
export function getFirestoreAdmin(): Firestore {
  return getFirestore(getOrInitApp(), firebaseConfig.firestoreDatabaseId);
}

export function getAdminApp(): App {
  return getOrInitApp();
}
