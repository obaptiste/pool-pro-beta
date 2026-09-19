import { Reading } from '../types';

// Alkalinity and calcium hardness are normally tested at most monthly —
// the app's own schedule.testFrequency options top out at 'monthly' — so a
// value found within this window is still a reasonable stand-in. Beyond
// it (e.g. spanning a drain/refill, or simply a long gap between tests),
// treat the field as unknown rather than silently present the last known
// value as if it still holds.
const MAX_BACKFILL_AGE_DAYS = 30;
const MAX_BACKFILL_AGE_MS = MAX_BACKFILL_AGE_DAYS * 24 * 60 * 60 * 1000;

type NumericReadingField = 'alkalinity' | 'calciumHardness' | 'chlorine' | 'differentialPressure' | 'ph' | 'sanitisationMv' | 'totalChlorine' | 'cyanuricAcid' | 'temperature';

function recentValue(readings: Reading[], field: NumericReadingField, notOlderThan: Date): number | null {
  const found = readings.find((r) => r[field] != null && r.timestamp.getTime() >= notOlderThan.getTime());
  return found ? (found[field] as number) : null;
}

/**
 * Most recent non-null value of a single field within `notOlderThan`, searching
 * `readings` (expects newest-first order, e.g. straight from the Firestore
 * `orderBy('timestamp', 'desc')` listener). Exposed for callers that need a
 * per-field "most recent known value" independent of any other field on the
 * same document — e.g. WeeklyReport's end-of-shift gauges, where an
 * auto-synced ORP-only reading being the literal latest record shouldn't
 * blank out a chlorine/pressure gauge that has a genuinely recent value a
 * few readings back.
 */
export function findRecentFieldValue(readings: Reading[], field: NumericReadingField, notOlderThan: Date): number | null {
  return recentValue(readings, field, notOlderThan);
}

/**
 * The most recent reading, with alkalinity and calciumHardness backfilled
 * from the most recent earlier reading (within MAX_BACKFILL_AGE_DAYS) that
 * has them, if the latest reading doesn't (e.g. an auto-synced pool
 * controller reading, which only reports pH/ORP/temperature — see the
 * "Pool controller telemetry" note in CLAUDE.md).
 *
 * These two fields only: LSI needs them (see lsi.ts), and — unlike
 * chlorine, which can swing meaningfully within hours — alkalinity and
 * calcium hardness are normally tested far less often and treated as
 * stable between manual tests, the same way a tech reasons about water
 * balance day-to-day without retesting everything each visit — but only
 * up to a point, hence the age bound above. Chlorine, totalChlorine,
 * cyanuricAcid, and differentialPressure are deliberately NOT backfilled
 * at all: showing a days-old chlorine reading as if current could mask a
 * real problem or suppress a warranted alert.
 *
 * Presentation only — never write this merged object back to Firestore.
 * Each stored Reading must stay a genuine, accurately timestamped
 * observation of what was actually measured at that instant; backfilling
 * at write time briefly did exactly that and both corrupted TrendCharts'
 * history (a synthetic value showing up as a fresh "actual" data point)
 * and risked misleading GeminiAssistant's analysis.
 */
export function getLatestReadingForDisplay(readings: Reading[]): Reading | undefined {
  const latest = readings[0];
  if (!latest) return undefined;
  if (latest.alkalinity != null && latest.calciumHardness != null) return latest;

  const cutoff = new Date(latest.timestamp.getTime() - MAX_BACKFILL_AGE_MS);
  const alkalinity = latest.alkalinity ?? recentValue(readings, 'alkalinity', cutoff);
  const calciumHardness = latest.calciumHardness ?? recentValue(readings, 'calciumHardness', cutoff);
  return { ...latest, alkalinity, calciumHardness };
}

// ORP can genuinely swing within a poll cycle -- like chlorine, it's
// deliberately never backfilled into a fresh Reading (see
// getLatestReadingForDisplay's docstring). This is not that: it's a
// display-only fallback for when the single latest reading's ORP sensor
// came back blank (a real, observed response shape -- pH/temp present,
// ORP omitted) but an earlier reading, not long before, did report ORP.
// Bounded much tighter than the 30-day alk/CH window -- long enough to
// ride out a few consecutive blank polls (15 min apart), short enough
// that a genuinely stale value can't masquerade as a live warning for long.
const MAX_ORP_FALLBACK_AGE_MS = 3 * 60 * 60 * 1000; // 3 hours

/**
 * The most recent known ORP (sanitisationMv) value and when it was
 * actually measured. Returns the latest reading's own value when present;
 * otherwise falls back to the most recent earlier reading that reported
 * ORP, within MAX_ORP_FALLBACK_AGE_MS.
 *
 * Exists so a dangerously low/high ORP doesn't silently vanish from
 * Dashboard's alert/status card or GeminiAssistant's prompt just because
 * the very next controller poll happened to omit that one field —
 * without ever presenting the fallback value as if it were fresh: callers
 * must compare the returned `at` against the latest reading's own
 * timestamp and label the value's age accordingly.
 */
export function getMostRecentOrp(readings: Reading[]): { value: number; at: Date } | null {
  const latest = readings[0];
  if (!latest) return null;
  if (latest.sanitisationMv != null) return { value: latest.sanitisationMv, at: latest.timestamp };

  const cutoff = new Date(latest.timestamp.getTime() - MAX_ORP_FALLBACK_AGE_MS);
  const found = readings.find((r) => r.sanitisationMv != null && r.timestamp.getTime() >= cutoff.getTime());
  return found ? { value: found.sanitisationMv as number, at: found.timestamp } : null;
}

/** Short relative-age label ("just now", "12m ago", "3h ago") for showing how old a fallback value (e.g. from getMostRecentOrp) actually is. */
export function formatAge(at: Date, relativeTo: Date = new Date()): string {
  const minutes = Math.round((relativeTo.getTime() - at.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

// Two missed 15-min auto-sync cycles. Deliberately measured against wall-clock
// "now", not against the latest reading's own timestamp: if polling stops
// entirely (expired credentials, an outage, a disabled workflow), the last
// successful reading IS "the latest reading" -- there's no fallback for
// getMostRecentOrp to fall back to, so a same-timestamp comparison would never
// catch it. Comparing to "now" is what actually detects "no news isn't good
// news, monitoring just stopped."
const ORP_STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * True once an ORP reading's own measurement time is more than
 * ORP_STALE_AFTER_MS behind `now` — regardless of whether it came from the
 * literal latest reading or a getMostRecentOrp fallback. Never used to hide
 * or null out the value (AGENTS.md: never block/hide evidence) — only to
 * decide whether callers should label it with its age.
 */
export function isOrpStale(at: Date, now: Date = new Date()): boolean {
  return now.getTime() - at.getTime() > ORP_STALE_AFTER_MS;
}

// Matches only a note that's *exactly* sync.ts's boilerplate
// "Auto-logged from <source>" — nothing more. An operator amending that note
// (ReadingForm preloads it, then voice/photo transcription appends new text
// after a newline) no longer matches, so their addition isn't silently
// dropped by callers that filter out auto-sync boilerplate.
const AUTO_SYNC_NOTE_PATTERN = /^Auto-logged from \S+$/;

/**
 * True only for a note that's untouched auto-sync boilerplate, never for one
 * an operator has added to. Used to exclude pure telemetry noise (see
 * sync.ts, polling every 15 min) from surfaces like GeminiAssistant's
 * recent-notes prompt without also dropping genuine manual content an
 * operator appended to an auto-synced reading.
 */
export function isAutoSyncBoilerplateNote(notes: string): boolean {
  return AUTO_SYNC_NOTE_PATTERN.test(notes.trim());
}
