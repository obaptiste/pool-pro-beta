import { getAuth } from 'firebase-admin/auth';
import { getAdminApp, getFirestoreAdmin, resolveOwnerUid } from '../_lib/firebaseAdmin';
import { createFirestoreSyncStore } from '../_lib/poolControllers/firestoreAdapters';
import { HannaCloudSource } from '../_lib/poolControllers/hannaCloud/source';
import { syncLatestReading } from '../_lib/poolControllers/sync';

// Pulls the latest telemetry (pH, ORP, temperature) from a Hanna Cloud
// pool controller and, if it's new, logs it as a Reading — see the
// "Pool controller telemetry" section of CLAUDE.md for the full picture,
// including why this talks to an unofficial, reverse-engineered API.
//
// Triggered three ways, all hitting this one endpoint so upgrading the
// schedule later is a vercel.json change, not a code change:
// - Vercel Cron (vercel.json — once/day on the Hobby plan; Vercel signs
//   these calls with `Authorization: Bearer $CRON_SECRET` automatically)
// - a GitHub Actions schedule (.github/workflows/sync-pool-controller.yml,
//   every 15 minutes, using the same secret) until the project is on a
//   Vercel plan whose cron supports that cadence natively
// - the "sync now" button on the dashboard (Dashboard.tsx), sent as the
//   signed-in owner's own Firebase ID token rather than CRON_SECRET —
//   that secret must stay server-side only, so it's never usable from
//   client code

// Minimal structural types — see api/ai/fallback.ts for why this project
// doesn't depend on @vercel/node purely for these.
interface VercelLikeRequest {
  headers?: Record<string, string | string[] | undefined>;
}

interface VercelLikeResponse {
  status(code: number): VercelLikeResponse;
  json(body: unknown): void;
}

function bearerToken(req: VercelLikeRequest): string | undefined {
  const header = req.headers?.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  return value?.startsWith('Bearer ') ? value.slice('Bearer '.length) : undefined;
}

/**
 * Accepts either CRON_SECRET (the scheduled triggers above) or a Firebase
 * ID token belonging to this app's single owner account (the dashboard's
 * manual "sync now" button) — verified against Firebase Auth itself, not
 * just decoded, so a forged or expired token is rejected. A token that
 * fails verification, or belongs to any account other than the owner, is
 * treated the same as no token at all: this app has exactly one user, and
 * server-side Admin SDK access here already acts only on that account's
 * data (see resolveOwnerUid).
 */
async function isAuthorized(req: VercelLikeRequest): Promise<boolean> {
  const token = bearerToken(req);
  if (!token) return false;

  const secret = process.env.CRON_SECRET?.trim();
  if (secret && token === secret) return true;

  try {
    const app = getAdminApp();
    const [decoded, ownerUid] = await Promise.all([getAuth(app).verifyIdToken(token), resolveOwnerUid(app)]);
    return decoded.uid === ownerUid;
  } catch {
    return false;
  }
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (!(await isAuthorized(req))) {
    // Distinguishes "the operator never finished setup" from "this specific
    // request's credentials were wrong" — useful for whoever's watching the
    // GitHub Actions / Vercel Cron logs, and harmless to a manual caller
    // (the dashboard button just shows a generic sync-failed state either way).
    const secretConfigured = Boolean(process.env.CRON_SECRET?.trim());
    res.status(secretConfigured ? 401 : 503).json({
      error: secretConfigured
        ? 'Unauthorized'
        : 'CRON_SECRET is not configured — see .env.example.',
    });
    return;
  }

  const email = process.env.HANNA_CLOUD_EMAIL?.trim();
  const password = process.env.HANNA_CLOUD_PASSWORD;
  if (!email || !password) {
    res.status(503).json({ error: 'HANNA_CLOUD_EMAIL / HANNA_CLOUD_PASSWORD are not configured — see .env.example.' });
    return;
  }

  try {
    const source = new HannaCloudSource({ email, password, deviceId: process.env.HANNA_CLOUD_DEVICE_ID });
    const ownerUid = await resolveOwnerUid(getAdminApp());
    const db = getFirestoreAdmin();

    const result = await syncLatestReading({
      source,
      store: createFirestoreSyncStore(db, ownerUid),
      ownerUid,
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('Pool controller sync failed:', error);
    res.status(502).json({ error: error instanceof Error ? error.message : 'Pool controller sync failed.' });
  }
}
