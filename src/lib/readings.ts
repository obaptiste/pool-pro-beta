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
