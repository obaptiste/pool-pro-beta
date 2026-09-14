import type { ReadingCursor } from './types';

/**
 * Opaque pagination cursor for poolstatus_list_readings, encoding the
 * (timestamp, id) compound key readings are ordered and paged by (see
 * ReadingCursor in types.ts for why both fields are needed). Clients are
 * told to treat this as opaque and pass back exactly what next_before gave
 * them — this format is free to change without breaking that contract.
 */
export function encodeReadingCursor(cursor: ReadingCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.timestamp.toISOString(), id: cursor.id }), 'utf8').toString('base64url');
}

export function decodeReadingCursor(value: string): ReadingCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid pagination cursor — pass the next_before value from a previous page, unmodified.');
  }
  const t = (parsed as { t?: unknown } | null)?.t;
  const id = (parsed as { id?: unknown } | null)?.id;
  const timestamp = typeof t === 'string' ? new Date(t) : null;
  if (!timestamp || Number.isNaN(timestamp.getTime()) || typeof id !== 'string' || !id) {
    throw new Error('Invalid pagination cursor — pass the next_before value from a previous page, unmodified.');
  }
  return { timestamp, id };
}
