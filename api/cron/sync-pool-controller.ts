import { createHash, timingSafeEqual } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FirebaseAdminConfigError, getAdminApp, getFirestoreAdmin, resolveOwnerUid } from '../_lib/firebaseAdmin.js';
import { createFirestoreSyncStore } from '../_lib/poolControllers/firestoreAdapters.js';
import { HannaCloudSource, resolveDeviceClock } from '../_lib/poolControllers/hannaCloud/source.js';
import { HannaCloudError } from '../_lib/poolControllers/hannaCloud/client.js';
import { syncLatestReading } from '../_lib/poolControllers/sync.js';

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
  method?: string;
  // Deliberately `unknown` values rather than `string | string[]`: this
  // handler has two callers with different query shapes. Vercel supplies
  // strings and string arrays, but server.ts hands it an Express `Request`,
  // whose `query` is qs's `ParsedQs` — values there can also be nested
  // objects or arrays of them, which `string | string[]` rejects outright
  // (a type error only visible once both sides are on the same branch).
  // Widening costs nothing here: the single reader below compares `mode`
  // against the one literal it accepts and 400s on everything else, so an
  // array, an object or a nested qs structure all fail closed exactly as a
  // mistyped string does.
  query?: Record<string, unknown>;
}

interface VercelLikeResponse {
  status(code: number): VercelLikeResponse;
  json(body: unknown): void;
  setHeader?(name: string, value: string): void;
}

const PROBE_DIAGNOSTIC_CODES = new Set([
  ...['LOGIN', 'DEVICES', 'LATEST', 'DASHBOARD', 'QUERY'].flatMap((stage) =>
    ['NETWORK', 'NOT_FOUND', 'AUTH', 'HTTP', 'JSON', 'GRAPHQL'].map((kind) => `HC_${stage}_${kind}`)),
  'HC_LOGIN_TOKEN', 'HC_DASHBOARD_FORMAT', 'HC_DASHBOARD_AMBIGUOUS', 'HC_DASHBOARD_DEVICE',
  'HC_TIMESTAMP_FORMAT', 'HC_TIMESTAMP_FUTURE', 'HC_TIMESTAMP_PAST', 'HC_DEVICE_NONE', 'HC_DEVICE_MULTIPLE',
  // A malformed HANNA_CLOUD_DEVICE_TIMEZONE / _UTC_OFFSET_MINUTES. The whole
  // point of throwing it is to name the variable rather than blame the
  // controller's clock, so it has to survive the probe's redaction -- without
  // this the dashboard would report HC_UNEXPECTED for a plain config typo.
  'HC_DEVICE_CLOCK_CONFIG',
]);

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

// `configError` carries a FirebaseAdminConfigError's message when the request
// failed on *this deployment's* setup rather than on the caller's credentials
// — see checkAuthorization.
//
// Both members declare both optional fields rather than only their own: this
// project's tsconfig.json sets no `strict`, so with strictNullChecks off
// TypeScript will not narrow a discriminated union by its boolean literal
// discriminant, and `auth.configError` inside `if (!auth.authorized)` is a
// compile error if the field exists on only one member.
type AuthResult =
  | { authorized: true; ownerUid?: string; configError?: undefined }
  | { authorized: false; ownerUid?: undefined; configError?: string };

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
 *
 * Failures here are deliberately split in two. A `FirebaseAdminConfigError`
 * — an unset or malformed FIREBASE_SERVICE_ACCOUNT, or neither
 * POOLSTATUS_OWNER_UID nor POOLSTATUS_OWNER_EMAIL set — is this
 * deployment's own configuration, not a judgement about the caller, so its
 * message is passed back for the handler to surface as a 503. That is the
 * same trade-off already made for an unset CRON_SECRET below: it tells an
 * operator which variable to go and set, and tells an attacker only that
 * the server isn't finished being set up. Everything else — a forged,
 * expired or wrong-project token, or a token belonging to some other
 * signed-in Google account — stays an undifferentiated 401, because
 * telling a caller *why* their credentials were rejected is precisely the
 * feedback a credential-guessing attack wants.
 *
 * This previously was a single bare `catch`, which collapsed all four into
 * one silent 401 and left an operator with no way to tell a missing
 * service account from a bad token.
 */
async function checkAuthorization(req: VercelLikeRequest): Promise<AuthResult> {
  const token = bearerToken(req);
  if (!token) return { authorized: false };

  const secret = process.env.CRON_SECRET?.trim();
  if (secret && secretMatches(token, secret)) return { authorized: true };

  let decoded: Awaited<ReturnType<ReturnType<typeof getAuth>['verifyIdToken']>>;
  try {
    decoded = await getAuth(getAdminApp()).verifyIdToken(token);
  } catch (error) {
    if (error instanceof FirebaseAdminConfigError) {
      return { authorized: false, configError: error.message };
    }
    // Not logged: an unauthenticated endpoint collects junk bearer tokens
    // from scanners, and every one of them lands here. The operator-
    // actionable cases are the ones above and below.
    return { authorized: false };
  }

  try {
    const ownerUid = await resolveOwnerUid(getAdminApp());
    return decoded.uid === ownerUid ? { authorized: true, ownerUid } : { authorized: false };
  } catch (error) {
    if (error instanceof FirebaseAdminConfigError) {
      return { authorized: false, configError: error.message };
    }
    // Reached only with an already-verified token, so this is a real
    // Firebase Auth failure (e.g. the getUserByEmail lookup erroring), not
    // scanner noise — worth a log line even though the caller still gets a
    // flat 401.
    console.error('Owner uid resolution failed for a verified token:', error);
    return { authorized: false };
  }
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  // Device measurements and connection errors must not be cached by shared
  // proxies or browsers. This applies to both the probe and normal sync.
  res.setHeader?.('Cache-Control', 'no-store');

  const auth = await checkAuthorization(req);
  if (!auth.authorized) {
    // Admin-SDK setup that was never finished. Same 503 shape as the unset
    // CRON_SECRET below, and the message names the variable to go and set.
    if (auth.configError) {
      res.status(503).json({ error: auth.configError });
      return;
    }
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

  // The probe is deliberately opt-in. An unknown or mistyped mode MUST
  // fail closed rather than falling through to the Firestore-writing sync.
  const mode = req.query?.mode;
  if (mode !== undefined && mode !== 'probe') {
    res.status(400).json({ error: 'Unsupported pool controller mode.' });
    return;
  }
  if (mode === 'probe' && req.method !== 'POST') {
    res.status(405).json({ error: 'Connection probes require POST.' });
    return;
  }

  const email = process.env.HANNA_CLOUD_EMAIL?.trim();
  const password = process.env.HANNA_CLOUD_PASSWORD;
  if (!email || !password) {
    res.status(503).json({ error: 'HANNA_CLOUD_EMAIL / HANNA_CLOUD_PASSWORD are not configured — see .env.example.' });
    return;
  }

  try {
    const source = new HannaCloudSource({
      email,
      password,
      deviceId: process.env.HANNA_CLOUD_DEVICE_ID,
      // What the controller's own clock is set to. Unset means UTC, which is
      // what Hanna's own decoder assumes; set it when the device is on local
      // time instead. Throws on a malformed value, which the catch below
      // surfaces rather than silently reverting to UTC.
      deviceClock: resolveDeviceClock(
        process.env.HANNA_CLOUD_DEVICE_TIMEZONE,
        process.env.HANNA_CLOUD_DEVICE_UTC_OFFSET_MINUTES,
      ),
    });
    if (mode === 'probe') {
      // A read-only connection test: only Hanna's login, device list and last
      // reading queries are called. Crucially: no Firestore instance, sync
      // store, dedupe watermark or persistence path is ever constructed.
      const reading = await source.getLatestReading();
      res.status(200).json({
        mode: 'probe',
        written: false,
        outcome: reading ? 'reading-available' : 'no-reading-available',
        reading: reading ? {
          recordedAt: reading.recordedAt.toISOString(),
          ph: reading.ph,
          sanitisationMv: reading.sanitisationMv,
          temperature: reading.temperature,
        } : null,
      });
      return;
    }

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
    if (mode === 'probe') {
      // Do not send unpredictable upstream error text (or device identifiers)
      // to the client. Credentials and auth tokens are never logged.
      const diagnosticCode = error instanceof HannaCloudError && PROBE_DIAGNOSTIC_CODES.has(error.diagnosticCode)
        ? error.diagnosticCode : 'HC_UNEXPECTED';
      console.error('Pool controller connection probe failed:', diagnosticCode);
      res.status(502).json({
        error: `Hanna Cloud connection test failed. Diagnostic: ${diagnosticCode}.`,
        diagnosticCode,
      });
      return;
    }
    console.error('Pool controller sync failed:', error);
    res.status(502).json({ error: error instanceof Error ? error.message : 'Pool controller sync failed.' });
  }
}
