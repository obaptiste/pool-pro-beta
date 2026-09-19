import { Reading } from '../types';

/**
 * The most recent reading, with alkalinity and calciumHardness backfilled
 * from the most recent earlier reading that has them, if the latest
 * reading doesn't (e.g. an auto-synced pool controller reading, which
 * only reports pH/ORP/temperature — see the "Pool controller telemetry"
 * note in CLAUDE.md).
 *
 * These two fields only: LSI needs them (see lsi.ts), and — unlike
 * chlorine, which can swing meaningfully within hours — alkalinity and
 * calcium hardness are normally tested far less often and treated as
 * stable between manual tests, the same way a tech reasons about water
 * balance day-to-day without retesting everything each visit. Chlorine,
 * totalChlorine, cyanuricAcid, and differentialPressure are deliberately
 * NOT backfilled: showing a days-old chlorine reading as if current could
 * mask a real problem or suppress a warranted alert.
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

  const alkalinity = latest.alkalinity ?? readings.find((r) => r.alkalinity != null)?.alkalinity ?? null;
  const calciumHardness = latest.calciumHardness ?? readings.find((r) => r.calciumHardness != null)?.calciumHardness ?? null;
  return { ...latest, alkalinity, calciumHardness };
}
