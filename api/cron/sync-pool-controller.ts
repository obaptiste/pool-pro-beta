import { getAdminApp, getFirestoreAdmin, resolveOwnerUid } from '../_lib/firebaseAdmin';
import { createFirestoreReadingWriter, createFirestoreSyncStateStore } from '../_lib/poolControllers/firestoreAdapters';
import { HannaCloudSource } from '../_lib/poolControllers/hannaCloud/source';
import { syncLatestReading } from '../_lib/poolControllers/sync';

// Pulls the latest telemetry (pH, ORP, temperature) from a Hanna Cloud
// pool controller and, if it's new, logs it as a Reading — see the
// "Pool controller telemetry" section of CLAUDE.md for the full picture,
// including why this talks to an unofficial, reverse-engineered API.
//
// Triggered two ways: Vercel Cron (vercel.json — once/day on the Hobby
// plan; Vercel signs these calls with `Authorization: Bearer
// $CRON_SECRET` automatically) and a GitHub Actions schedule
// (.github/workflows/sync-pool-controller.yml, every 15 minutes, using
// the same secret) until the project is on a Vercel plan whose cron
// supports that cadence natively. Both paths hit this one endpoint, so
// upgrading later is a vercel.json change, not a code change.

// Minimal structural types — see api/ai/fallback.ts for why this project
// doesn't depend on @vercel/node purely for these.
interface VercelLikeRequest {
  headers?: Record<string, string | string[] | undefined>;
}

interface VercelLikeResponse {
  status(code: number): VercelLikeResponse;
  json(body: unknown): void;
}

function isAuthorized(req: VercelLikeRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers?.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  return value === `Bearer ${secret}`;
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (!isAuthorized(req)) {
    res.status(process.env.CRON_SECRET ? 401 : 503).json({
      error: process.env.CRON_SECRET
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
      stateStore: createFirestoreSyncStateStore(db, ownerUid, source.id),
      writer: createFirestoreReadingWriter(db),
      ownerUid,
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('Pool controller sync failed:', error);
    res.status(502).json({ error: error instanceof Error ? error.message : 'Pool controller sync failed.' });
  }
}
