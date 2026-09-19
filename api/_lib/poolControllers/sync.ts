import type { Reading } from '../../../src/types';
import type { PoolControllerSource } from './types';

/**
 * Persists a controller reading, atomically skipping the write if
 * `reading.timestamp` is not strictly newer than what was last synced for
 * `sourceId` — both the dedupe check and the write must happen as one
 * unit, since two schedulers (Vercel Cron and the GitHub Actions poller)
 * can invoke the sync job at the same time and would otherwise both
 * observe the old marker and double-write. The implementation also owns
 * assigning the reading's document id: App.tsx's reading listener spreads
 * `doc.data()` without restoring `doc.id`, so a reading with no `id`
 * field breaks React keys and History's edit/delete.
 */
export interface PoolControllerSyncStore {
  /** Returns whether it wrote (false means an equal-or-older reading was already synced). */
  syncIfNewer(sourceId: string, reading: Omit<Reading, 'id'>): Promise<boolean>;
}

export type SyncOutcome = 'synced' | 'no-reading-available' | 'not-newer-than-last-sync';

export interface SyncResult {
  written: boolean;
  outcome: SyncOutcome;
}

export interface SyncLatestReadingDeps {
  source: PoolControllerSource;
  store: PoolControllerSyncStore;
  ownerUid: string;
}

/**
 * Pulls the pool controller's latest telemetry and, if it's newer than
 * what was last synced, writes it as a Reading. Deliberately
 * source-agnostic — nothing here knows about Hanna Cloud, GraphQL, or
 * Firestore, so it's exercised in tests with an in-memory fake store and
 * would work unchanged against a second controller brand.
 *
 * Every field the source doesn't report is stored `null`, never
 * backfilled from an earlier reading: a Reading's timestamp is a claim
 * about when each of its values was actually measured, and copying an
 * old chlorine/alkalinity reading into a freshly timestamped document
 * would misrepresent hours- or days-old chemistry as just measured —
 * corrupting TrendCharts' history (`buildTrendPoints` plots every
 * reading with a value as an actual data point) and risking unsafe
 * advice from GeminiAssistant. See "Pool controller telemetry" in
 * CLAUDE.md for how Dashboard/GeminiAssistant instead handle a partial
 * latest reading without fabricating data.
 */
export async function syncLatestReading({ source, store, ownerUid }: SyncLatestReadingDeps): Promise<SyncResult> {
  const reading = await source.getLatestReading();
  if (!reading) {
    return { written: false, outcome: 'no-reading-available' };
  }

  const record: Omit<Reading, 'id'> = {
    timestamp: reading.recordedAt,
    chlorine: null,
    totalChlorine: null,
    sanitisationMv: reading.sanitisationMv,
    ph: reading.ph,
    alkalinity: null,
    temperature: reading.temperature,
    differentialPressure: null,
    calciumHardness: null,
    cyanuricAcid: null,
    notes: `Auto-logged from ${source.id}`,
    uid: ownerUid,
  };

  const written = await store.syncIfNewer(source.id, record);
  return { written, outcome: written ? 'synced' : 'not-newer-than-last-sync' };
}
