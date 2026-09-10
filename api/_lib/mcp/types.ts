import type { EquipmentItem, InventoryItem, MaintenanceSchedule, MaintenanceTask, Reading } from '../../../src/types';

export interface ListReadingsOptions {
  /** Only readings taken at or after this instant. */
  since?: Date;
  /** Only readings taken at or before this instant. */
  until?: Date;
  /** Cursor: only readings taken strictly before this instant. */
  before?: Date;
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
