import type { Reading } from '../../../src/types';
import type { PoolControllerSource } from './types';

export interface SyncState {
  /** recordedAt of the last PoolControllerReading this job wrote. */
  lastReadingAt: Date;
}

/** Where the sync job remembers what it last wrote, so a poll that finds nothing new is a no-op rather than a duplicate reading. */
export interface SyncStateStore {
  get(): Promise<SyncState | null>;
  set(state: SyncState): Promise<void>;
}

/** Where the sync job persists a new reading — Firestore in production, an in-memory list in tests. */
export interface ReadingWriter {
  writeReading(reading: Omit<Reading, 'id'>): Promise<void>;
}

export type SyncOutcome = 'synced' | 'no-reading-available' | 'not-newer-than-last-sync';

export interface SyncResult {
  written: boolean;
  outcome: SyncOutcome;
}

export interface SyncLatestReadingDeps {
  source: PoolControllerSource;
  stateStore: SyncStateStore;
  writer: ReadingWriter;
  ownerUid: string;
}

/**
 * Pulls the pool controller's latest telemetry and, if it's newer than
 * what was last synced, writes it as a Reading and advances the sync
 * state. Deliberately source-agnostic — nothing here knows about Hanna
 * Cloud, GraphQL, or Firestore, so it's exercised in tests with in-memory
 * fakes and would work unchanged against a second controller brand.
 */
export async function syncLatestReading({ source, stateStore, writer, ownerUid }: SyncLatestReadingDeps): Promise<SyncResult> {
  const reading = await source.getLatestReading();
  if (!reading) {
    return { written: false, outcome: 'no-reading-available' };
  }

  const state = await stateStore.get();
  if (state && reading.recordedAt.getTime() <= state.lastReadingAt.getTime()) {
    return { written: false, outcome: 'not-newer-than-last-sync' };
  }

  await writer.writeReading({
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
  });
  await stateStore.set({ lastReadingAt: reading.recordedAt });

  return { written: true, outcome: 'synced' };
}
