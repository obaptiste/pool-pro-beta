import { createHash, timingSafeEqual } from 'node:crypto';
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

// Compare digests rather than the raw strings so the comparison is
// constant-time regardless of how the presented token's length differs
// — matches api/_lib/mcp/handler.ts's tokenMatches() for the same reason.
function secretMatches(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

type AuthResult = { authorized: true; ownerUid?: string } | { authorized: false };

/**
 * Accepts either CRON_SECRET (the scheduled triggers above) or a Firebase
 * ID token belonging to this app's single owner account (the dashboard's
 * manual "sync now" button) — verified against Firebase Auth itself, not
 * just decoded, so a forged or expired token is rejected. A token that
 * fails verification, or belongs to any account other than the owner, is
 * treated the same as no token at all: this app has exactly one user, and
 * server-side Admin SDK access here already acts only on that account's
 * data (see resolveOwnerUid).
 *
 * `resolveOwnerUid()` is only called once the token has already verified.
 * This endpoint isn't behind the Express rate limiter in production (that
 * only wraps the local dev server), so resolving it eagerly for every
 * request carrying *any* bearer token — including junk from scanners —
 * would let invalid-token traffic burn through Firebase Auth's
 * `getUserByEmail()` quota when POOLSTATUS_OWNER_EMAIL is configured
 * (POOLSTATUS_OWNER_UID, the preferred setting, is just an env read and
 * has no such cost either way). The resolved uid is returned so the
 * handler can reuse it instead of looking it up again.
 */
async function checkAuthorization(req: VercelLikeRequest): Promise<AuthResult> {
  const token = bearerToken(req);
  if (!token) return { authorized: false };

  const secret = process.env.CRON_SECRET?.trim();
  if (secret && secretMatches(token, secret)) return { authorized: true };

  try {
    const app = getAdminApp();
    const decoded = await getAuth(app).verifyIdToken(token);
    const ownerUid = await resolveOwnerUid(app);
    return decoded.uid === ownerUid ? { authorized: true, ownerUid } : { authorized: false };
  } catch {
    return { authorized: false };
  }
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  const auth = await checkAuthorization(req);
  if (!auth.authorized) {
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
    // Reuse the uid resolved during auth (the manual-sync path) rather than
    // looking it up again; the CRON_SECRET path doesn't derive one, so it
    // still needs this one call.
    const ownerUid = auth.ownerUid ?? (await resolveOwnerUid(getAdminApp()));
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
