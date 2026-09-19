import type { Reading } from '../../../src/types';
import type { PoolControllerSource } from './types';

/** Chemistry fields no pool controller in this codebase measures — carried forward from history so an auto-synced reading doesn't blank them. */
export const CARRY_FORWARD_FIELDS = ['chlorine', 'totalChlorine', 'alkalinity', 'calciumHardness', 'cyanuricAcid', 'differentialPressure'] as const;
export type CarryForwardField = (typeof CARRY_FORWARD_FIELDS)[number];
export type CarryForwardFields = Record<CarryForwardField, number | null>;

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
  /**
   * Looks up the most recent known value per CARRY_FORWARD_FIELDS field
   * (from readings of any source, not just this one) so a partial
   * controller reading doesn't regress fields the controller doesn't
   * measure — Dashboard and GeminiAssistant both treat the single most
   * recent reading as the complete latest snapshot (they don't merge
   * across readings), so leaving those fields `null` here would blank
   * their cards and make LSI ("needs ph + temperature + calciumHardness +
   * alkalinity") unavailable on every sync. Omit only when the caller
   * doesn't care about carry-forward (e.g. a test asserting on the raw
   * controller fields).
   */
  getCarryForwardFields?: () => Promise<Partial<CarryForwardFields>>;
}

/**
 * Pulls the pool controller's latest telemetry and, if it's newer than
 * what was last synced, writes it as a Reading. Deliberately
 * source-agnostic — nothing here knows about Hanna Cloud, GraphQL, or
 * Firestore, so it's exercised in tests with an in-memory fake store and
 * would work unchanged against a second controller brand.
 */
export async function syncLatestReading({ source, store, ownerUid, getCarryForwardFields }: SyncLatestReadingDeps): Promise<SyncResult> {
  const reading = await source.getLatestReading();
  if (!reading) {
    return { written: false, outcome: 'no-reading-available' };
  }

  const carryForward = (await getCarryForwardFields?.()) ?? {};
  const record: Omit<Reading, 'id'> = {
    timestamp: reading.recordedAt,
    chlorine: carryForward.chlorine ?? null,
    totalChlorine: carryForward.totalChlorine ?? null,
    sanitisationMv: reading.sanitisationMv,
    ph: reading.ph,
    alkalinity: carryForward.alkalinity ?? null,
    temperature: reading.temperature,
    differentialPressure: carryForward.differentialPressure ?? null,
    calciumHardness: carryForward.calciumHardness ?? null,
    cyanuricAcid: carryForward.cyanuricAcid ?? null,
    notes: `Auto-logged from ${source.id}`,
    uid: ownerUid,
  };

  const written = await store.syncIfNewer(source.id, record);
  return { written, outcome: written ? 'synced' : 'not-newer-than-last-sync' };
}
