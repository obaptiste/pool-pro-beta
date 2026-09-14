import type { EquipmentItem, InventoryItem, MaintenanceSchedule, MaintenanceTask, Reading } from '../../../src/types';

/**
 * Pagination cursor for readings: the (timestamp, id) of the last row on
 * the previous page. Both fields are needed — readings can share a
 * timestamp (same-millisecond writes), so a timestamp-only cursor would
 * skip or duplicate rows at a page boundary that falls between two tied
 * readings. Order and cursor must agree on the same compound key.
 */
export interface ReadingCursor {
  timestamp: Date;
  id: string;
}

export interface ListReadingsOptions {
  /** Only readings taken at or after this instant. */
  since?: Date;
  /** Only readings taken at or before this instant. */
  until?: Date;
  /** Cursor: only readings strictly after this (timestamp, id) in newest-first order. */
  before?: ReadingCursor;
  /** Maximum rows to return; callers ask for one extra to detect `has_more`. */
  limit: number;
}

/**
 * Everything the MCP tools need from storage, for one pool owner. Keeping
 * the tools behind this interface means they can be exercised end-to-end
 * against an in-memory source (see server.test.ts) without Firestore
 * credentials, and the Firestore implementation stays a thin mapping layer.
 */
export interface PoolDataSource {
  /** Newest first. */
  listReadings(options: ListReadingsOptions): Promise<Reading[]>;
  listTasks(): Promise<MaintenanceTask[]>;
  listInventory(): Promise<InventoryItem[]>;
  listEquipment(): Promise<EquipmentItem[]>;
  getSchedule(): Promise<MaintenanceSchedule | null>;
}
