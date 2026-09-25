import type { EquipmentItem, InventoryItem, MaintenanceSchedule, MaintenanceTask, Priority, Reading, TaskFrequency } from '../../../src/types';

/** Thrown by completeTask/adjustInventory when `id` doesn't name an item the owner has. */
export class NotFoundError extends Error {}

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

/** A photo submitted as evidence for an MCP-logged reading — see CreateReadingInput. */
export interface PhotoEvidence {
  /** Raw image bytes. */
  data: Buffer;
  /** e.g. 'image/jpeg'. */
  contentType: string;
}

export interface CreateReadingInput {
  /** Defaults to now if omitted. */
  timestamp?: Date;
  chlorine?: number | null;
  totalChlorine?: number | null;
  sanitisationMv?: number | null;
  ph?: number | null;
  alkalinity?: number | null;
  temperature?: number | null;
  differentialPressure?: number | null;
  calciumHardness?: number | null;
  cyanuricAcid?: number | null;
  notes?: string;
  /**
   * Required, not optional: poolstatus_log_reading (server.ts) has no
   * other way to back a number typed into a conversation with evidence
   * the way a manual test or a controller's own sensor reading does, so
   * every MCP-created reading carries one.
   */
  photo: PhotoEvidence;
}

export interface AddTaskInput {
  title: string;
  priority: Priority;
  frequency: TaskFrequency;
}

export interface AdjustInventoryInput {
  id: string;
  /** Positive to add stock, negative to consume it. */
  delta: number;
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
  createReading(input: CreateReadingInput): Promise<Reading>;
  addTask(input: AddTaskInput): Promise<MaintenanceTask>;
  /** Throws if no task with this id exists for the owner. */
  completeTask(id: string): Promise<MaintenanceTask>;
  /**
   * Applies `delta` to the item's quantity, clamped so it never goes
   * negative (matching Inventory.tsx's own decrement button). Throws if no
   * item with this id exists for the owner.
   */
  adjustInventory(input: AdjustInventoryInput): Promise<InventoryItem>;
}
