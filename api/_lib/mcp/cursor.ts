import type { ControllerWindowCursor, ReadingCursor } from './types.js';

const INVALID = 'Invalid pagination cursor — pass the next_before value from a previous page, unmodified.';

// Both cursors encode the same shape — an instant plus a unique tie-breaking
// document id — so the codec is shared. What differs is which field each
// query is ordered by, which is the caller's business, not the encoding's.
function encodeKeyCursor(instant: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: instant.toISOString(), id }), 'utf8').toString('base64url');
}

function decodeKeyCursor(value: string): { instant: Date; id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new Error(INVALID);
  }
  const t = (parsed as { t?: unknown } | null)?.t;
  const id = (parsed as { id?: unknown } | null)?.id;
  const instant = typeof t === 'string' ? new Date(t) : null;
  if (!instant || Number.isNaN(instant.getTime()) || typeof id !== 'string' || !id) {
    throw new Error(INVALID);
  }
  return { instant, id };
}

/**
 * Opaque pagination cursor for poolstatus_list_readings, encoding the
 * (timestamp, id) compound key readings are ordered and paged by (see
 * ReadingCursor in types.ts for why both fields are needed). Clients are
 * told to treat this as opaque and pass back exactly what next_before gave
 * them — this format is free to change without breaking that contract.
 */
export function encodeReadingCursor(cursor: ReadingCursor): string {
  return encodeKeyCursor(cursor.timestamp, cursor.id);
}

export function decodeReadingCursor(value: string): ReadingCursor {
  const { instant, id } = decodeKeyCursor(value);
  return { timestamp: instant, id };
}

/**
 * Opaque cursor for poolstatus_list_controller_windows, encoding the
 * (start, id) compound key those windows are ordered and paged by — see
 * ControllerWindowCursor in types.ts.
 */
export function encodeControllerWindowCursor(cursor: ControllerWindowCursor): string {
  return encodeKeyCursor(cursor.start, cursor.id);
}

export function decodeControllerWindowCursor(value: string): ControllerWindowCursor {
  const { instant, id } = decodeKeyCursor(value);
  return { start: instant, id };
}
