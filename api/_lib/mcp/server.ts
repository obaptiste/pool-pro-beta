import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { calculateLSI } from '../../../src/lib/lsi';
import {
  COMBINED_CHLORINE_MAX,
  COMBINED_CHLORINE_OK_MAX,
  combinedChlorineOf,
  getCombinedChlorineStatus,
  getCombinedChlorineWarning,
  getImpossibleValueError,
  getSoftWarning,
  NUMERIC_READING_FIELDS,
  type NumericReadingField,
} from '../../../src/lib/readingValidation';
import { DEFAULT_RANGES, type EquipmentItem, type Priority, type Reading, type Status, type TaskFrequency } from '../../../src/types';
import { decodeReadingCursor, encodeReadingCursor } from './cursor';
import { NotFoundError, UnitMismatchError, type PoolDataSource, type ReadingCursor } from './types';

export const SERVER_NAME = 'poolstatus-mcp-server';
export const SERVER_VERSION = '1.0.0';

const MAX_LIST_LIMIT = 100;
const MAX_TREND_DAYS = 90;
// Enough readings for a 90-day window at several tests a day; anything
// beyond this is summarised from the most recent rows (and reported as
// `truncated`, with `from` adjusted to match — see poolstatus_get_reading_trends).
// Exported so tests can exercise the truncation path without hardcoding it twice.
export const MAX_TREND_ROWS = 500;
// Hard ceiling on raw rows scanned for one trends request, regardless of
// how many of them turn out to be note-only. Without this, a window with
// enough consecutive note-only logs to keep displacing real measurements
// out of every page would make one tool call fetch the entire window one
// page at a time — bounded pagination, not unbounded.
// Exported so tests can exercise it directly, same as MAX_TREND_ROWS above.
export const MAX_TREND_FETCH_ROWS = MAX_TREND_ROWS * 5;
// How far back poolstatus_get_latest_reading looks for a row with an actual
// measurement before giving up and reporting no reading. If every one of
// the most recent LATEST_READING_SEARCH_LIMIT logs is note-only, an older
// real reading further back won't be found — an accepted bound rather than
// unbounded pagination for what should be a rare run of consecutive notes.
export const LATEST_READING_SEARCH_LIMIT = 20;

const ResponseFormat = z.enum(['markdown', 'json']).default('markdown')
  .describe("Output format: 'markdown' for a human-readable summary, 'json' for the raw structured data.");

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

// Date.parse silently normalizes calendar-invalid dates (2026-02-30 becomes
// March 2) instead of rejecting them, which would make a since/until filter
// query a window the caller never asked for. Validate the calendar and time
// components explicitly rather than relying on parseability alone.
function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, y, m, d, hh, mm, ss] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12) return false;
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day < 1 || day > daysInMonth) return false;
  if (hh != null) {
    if (Number(hh) > 23 || Number(mm) > 59 || (ss != null && Number(ss) > 59)) return false;
  }
  return !Number.isNaN(Date.parse(value));
}

const IsoDate = z.string()
  .refine(isValidIsoDate, 'Must be a valid ISO-8601 date or date-time, e.g. 2026-09-01 or 2026-09-01T08:00:00Z');

const parseDate = (value?: string): Date | undefined => (value == null ? undefined : new Date(value));

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// An upper bound needs the *end* of a date-only day, not its start: a bare
// "until": "2026-09-01" parses to 2026-09-01T00:00:00.000Z, and used as-is
// in a <= filter would exclude every reading from 00:00:01 that day
// onward — silently truncating the very day the caller asked to include.
// since doesn't need this: a date-only lower bound's natural midnight
// start is already the inclusive beginning of that day.
const parseUntilDate = (value?: string): Date | undefined =>
  value == null ? undefined : new Date(DATE_ONLY_PATTERN.test(value) ? `${value}T23:59:59.999Z` : value);

// Same banding the dashboard's status cards use: outside the target range
// is critical; within 10% of either edge is a warning.
function getRangeStatus(value: number, min: number, max: number): Status {
  if (value < min || value > max) return 'critical';
  const buffer = (max - min) * 0.1;
  if (value < min + buffer || value > max - buffer) return 'warning';
  return 'good';
}

// A log with no measurements — just a note — isn't a completed water test
// per handleSaveReading in App.tsx either; shared by poolstatus_get_latest_reading
// (skip such rows when picking "the latest reading") and poolstatus_get_reading_trends
// (exclude them from readings_considered and the metric series).
const hasMeasurement = (reading: Reading): boolean => NUMERIC_READING_FIELDS.some((field) => reading[field] != null);

interface TrendRowsResult {
  rows: Reading[];
  /**
   * True when there's more to the window than `rows` reflects — either
   * more than MAX_TREND_ROWS measurements exist (`rows` is capped to the
   * most recent MAX_TREND_ROWS, so the caller's usual "from = oldest row
   * kept" still applies), or MAX_TREND_FETCH_ROWS raw rows were scanned
   * without ever confirming the window was fully covered (a long run of
   * note-only logs) while finding fewer than that many measurements.
   */
  truncated: boolean;
  /**
   * The oldest instant actually scanned, whenever scanning stopped before
   * confirming the rest of the window held nothing more (via the fetch
   * ceiling or the MAX_TREND_ROWS cap) — null once every row up to the
   * window's start has actually been seen. The caller only needs this
   * when `rows` comes back empty and truncated (nothing with a
   * measurement was found before scanning stopped), where there's no
   * "oldest row kept" to fall back on for an honest `from`.
   */
  scanBoundary: Date | null;
}

// Paginates through the window collecting only rows with a measurement
// (note-only logs must not consume a slot in MAX_TREND_ROWS ahead of real
// data — see hasMeasurement's comment), continuing past a page of raw
// rows that turned out to be all notes rather than concluding the window
// is thin. Bounded by MAX_TREND_FETCH_ROWS so a window that is mostly (or
// entirely) note-only logs still costs one call, not unbounded reads.
async function fetchTrendRows(source: PoolDataSource, since: Date, until: Date): Promise<TrendRowsResult> {
  const rows: Reading[] = [];
  let cursor: ReadingCursor | undefined;
  let totalFetched = 0;
  let scannedFullWindow = false;
  let lastScanned: Date | null = null;
  for (;;) {
    const batch = await source.listReadings({ since, until, before: cursor, limit: MAX_TREND_ROWS + 1 });
    totalFetched += batch.length;
    for (const reading of batch) if (hasMeasurement(reading)) rows.push(reading);
    if (batch.length > 0) lastScanned = batch[batch.length - 1].timestamp;
    if (batch.length < MAX_TREND_ROWS + 1) {
      scannedFullWindow = true;
      break;
    }
    if (rows.length > MAX_TREND_ROWS || totalFetched >= MAX_TREND_FETCH_ROWS) break;
    const lastRaw = batch[batch.length - 1];
    cursor = { timestamp: lastRaw.timestamp, id: lastRaw.id };
  }
  const haveExtra = rows.length > MAX_TREND_ROWS;
  return {
    rows: haveExtra ? rows.slice(0, MAX_TREND_ROWS) : rows,
    truncated: haveExtra || !scannedFullWindow,
    scanBoundary: scannedFullWindow ? null : lastScanned,
  };
}

// ORP/sanitisation doesn't use the generic range banding above: the app's
// own classifier (getSoftWarning, used by History's warning badges) treats
// 750–850 mV as "elevated, usually acceptable" rather than out-of-range —
// DEFAULT_RANGES.sanitisationMv's 750 max is a *target* ceiling, not a
// hard limit, so running it through getRangeStatus would call anything
// above 750 "critical" and contradict what the rest of the app tells the
// same user about the same reading. Reuse that classifier instead of
// re-deriving separate thresholds here.
function getSanitisationMvStatus(value: number): Status {
  const warning = getSoftWarning('sanitisationMv', value);
  if (!warning) return 'good';
  // 'elevated' (750–850 mV) is the "usually acceptable" band; the plain
  // 'warning' level here only fires outside 650–850, which is a real
  // actionable extreme.
  return warning.level === 'elevated' ? 'warning' : 'critical';
}

const lsiStatus = (lsi: number): Status => (Math.abs(lsi) > 0.3 ? 'critical' : Math.abs(lsi) > 0.1 ? 'warning' : 'good');
const lsiLabel = (lsi: number): string => (lsi < -0.3 ? 'corrosive' : lsi > 0.3 ? 'scale-forming' : 'balanced');

// getSoftWarning only returns a message for a value truly outside its
// range — getRangeStatus's 'warning' band (within 10% of an edge, but
// still inside the range) has no message of its own. Without this, a
// field can be flagged 'warning' with no explanation at all in
// fieldWarnings, which is the whole point of that field. Not a
// getSoftWarning-derived message since none exists for this band; states
// only where the value sits, not a diagnosis.
function nearEdgeMessage(field: NumericReadingField): string {
  const { min, max, unit } = DEFAULT_RANGES[field];
  return `Near the edge of the normal range (${min}–${max}${unit ? ` ${unit}` : ''}) — worth a recheck on the next test.`;
}

// Mirrors getCombinedChlorineWarning's own thresholds and message text
// (src/lib/readingValidation.ts) for a bare combined-chlorine number, used
// where only the derived trend value is available — not the underlying
// free/total pair getCombinedChlorineWarning itself needs.
function combinedChlorineMessage(combined: number): string | null {
  if (combined > COMBINED_CHLORINE_MAX) {
    return `Combined chlorine ${combined.toFixed(1)} ppm (>${COMBINED_CHLORINE_MAX}) — chloramines high. Shock and retest before swimming.`;
  }
  if (combined > COMBINED_CHLORINE_OK_MAX) {
    return `Combined chlorine ${combined.toFixed(1)} ppm — ideal is under ${COMBINED_CHLORINE_OK_MAX}. Watch it on the next test.`;
  }
  return null;
}

// Same "explain why this metric is flagged" text poolstatus_get_latest_reading
// carries in fieldWarnings, but keyed by trend series (which includes the
// synthetic combinedChlorine/lsi metrics alongside the raw fields) rather
// than a single Reading.
function getMetricWarning(key: string, latest: number, status: Status | null): string | null {
  if (!status || status === 'good') return null;
  if (key === 'combinedChlorine') return combinedChlorineMessage(latest);
  if (key === 'lsi') return `LSI is ${lsiLabel(latest)} (target within ±0.3).`;
  const field = key as NumericReadingField;
  return getSoftWarning(field, latest)?.message ?? nearEdgeMessage(field);
}

const fmt = (value: number | null | undefined, digits = 1): string => (value == null ? '—' : value.toFixed(digits));
// For a previous measurement: the raw stored number, no rounding (unlike
// fmt, meant for computed/display figures like LSI) — this is evidence of
// what a field used to say, not a value we get to round for readability.
const fmtExact = (value: number | null, unit: string): string => (value == null ? 'not measured' : `${value} ${unit}`.trim());
const iso = (date: Date | null | undefined): string | null => (date ? date.toISOString() : null);

function serializeReading(reading: Reading) {
  const lsi = calculateLSI(reading);
  const combined = combinedChlorineOf(reading.chlorine, reading.totalChlorine);
  const combinedWarning = getCombinedChlorineWarning(reading.chlorine, reading.totalChlorine);
  const fieldStatus: Partial<Record<NumericReadingField, Status>> = {};
  // getSoftWarning is the app's own source of *why* a value is flagged
  // (History's warning badges use it directly) — status alone tells a
  // client a field is critical/warning but not what's actually wrong or
  // what to do about it, which is the point of a warning message.
  const fieldWarnings: Partial<Record<NumericReadingField, string>> = {};
  for (const field of NUMERIC_READING_FIELDS) {
    const value = reading[field];
    if (value == null) continue;
    fieldStatus[field] = field === 'sanitisationMv'
      ? getSanitisationMvStatus(value)
      : getRangeStatus(value, DEFAULT_RANGES[field].min, DEFAULT_RANGES[field].max);
    const warning = getSoftWarning(field, value);
    if (warning) fieldWarnings[field] = warning.message;
    // getSoftWarning has nothing to say about getRangeStatus's near-edge
    // 'warning' band (still inside range, just close to an edge) — without
    // this, such a field would be flagged with no explanation at all.
    else if (fieldStatus[field] === 'warning') fieldWarnings[field] = nearEdgeMessage(field);
  }
  return {
    id: reading.id,
    timestamp: reading.timestamp.toISOString(),
    editedAt: iso(reading.editedAt),
    previousValues: reading.previousValues ?? null,
    measurements: {
      chlorine: reading.chlorine,
      totalChlorine: reading.totalChlorine,
      sanitisationMv: reading.sanitisationMv,
      ph: reading.ph,
      alkalinity: reading.alkalinity,
      temperature: reading.temperature,
      differentialPressure: reading.differentialPressure,
      calciumHardness: reading.calciumHardness,
      cyanuricAcid: reading.cyanuricAcid,
    },
    notes: reading.notes ?? null,
    photoUrl: reading.photoUrl ?? null,
    derived: {
      lsi,
      lsiStatus: lsi == null ? null : lsiStatus(lsi),
      lsiLabel: lsi == null ? null : lsiLabel(lsi),
      combinedChlorine: combined,
      combinedChlorineStatus: combined == null ? null : getCombinedChlorineStatus(combined),
      combinedChlorineWarning: combinedWarning?.message ?? null,
    },
    fieldStatus,
    fieldWarnings,
  };
}

type SerializedReading = ReturnType<typeof serializeReading>;

const UNITS: Record<NumericReadingField, string> = Object.fromEntries(
  NUMERIC_READING_FIELDS.map((field) => [field, DEFAULT_RANGES[field].unit]),
) as Record<NumericReadingField, string>;

const LABELS: Record<NumericReadingField, string> = {
  chlorine: 'Free chlorine',
  totalChlorine: 'Total chlorine',
  sanitisationMv: 'ORP / sanitisation',
  ph: 'pH',
  alkalinity: 'Total alkalinity',
  temperature: 'Temperature',
  differentialPressure: 'Differential pressure',
  calciumHardness: 'Calcium hardness',
  cyanuricAcid: 'Cyanuric acid',
};

function readingToMarkdown(reading: SerializedReading): string {
  const lines = [`### Reading ${reading.timestamp}${reading.editedAt ? ' (amended)' : ''}`];
  for (const field of NUMERIC_READING_FIELDS) {
    const value = reading.measurements[field];
    // previousValues only lists fields the last edit actually changed —
    // present (even as null, "was not measured") means this field's value
    // was overwritten and the prior evidence would otherwise be lost. That
    // includes an edit that *cleared* a field (value now null): still
    // worth a line, so the amendment doesn't silently erase what it
    // changed just because the field reads empty now.
    const hadPreviousValue = reading.previousValues != null && field in reading.previousValues;
    if (value == null && !hadPreviousValue) continue;
    const status = reading.fieldStatus[field];
    // Exact value, not fmt()'s one-decimal rounding — this is amendment
    // evidence (what the field used to say), not a display figure, so
    // 7.25 must stay 7.25 rather than becoming a rounded "7.3".
    const previousNote = hadPreviousValue ? ` (was ${fmtExact(reading.previousValues![field], UNITS[field])})` : '';
    const current = value == null ? 'not measured' : `${value} ${UNITS[field]}`;
    const warning = reading.fieldWarnings[field];
    lines.push(`- ${LABELS[field]}: ${current}${status && status !== 'good' ? ` (${status})` : ''}${previousNote}${warning ? ` — ${warning}` : ''}`);
  }
  const { derived } = reading;
  if (derived.lsi != null) lines.push(`- LSI: ${derived.lsi} (${derived.lsiLabel})`);
  if (derived.combinedChlorine != null) {
    lines.push(`- Combined chlorine: ${fmt(derived.combinedChlorine)} ppm (${derived.combinedChlorineStatus})`);
  }
  if (derived.combinedChlorineWarning) lines.push(`- ⚠ ${derived.combinedChlorineWarning}`);
  if (reading.notes) lines.push(`- Notes: ${reading.notes}`);
  if (reading.photoUrl) lines.push(`- Photo evidence: ${reading.photoUrl}`);
  return lines.join('\n');
}

function nextServiceDate(item: EquipmentItem): Date | null {
  if (!item.serviceIntervalMonths) return null;
  const from = item.lastServiceDate ?? item.installDate;
  const next = new Date(from);
  next.setMonth(next.getMonth() + item.serviceIntervalMonths);
  return next;
}

function toolResult(structured: Record<string, unknown>, text: string) {
  return { content: [{ type: 'text' as const, text }], structuredContent: structured };
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE_CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
// destructiveHint: true, unlike WRITE_CREATE. Shared by two tools for two
// different reasons: adjust_inventory's negative delta consumes (overwrites,
// not just adds to) existing stock; log_reading's own document creation is
// purely additive, but every successful call also overwrites schedules/
// {ownerUid}'s existing lastTestDate/nextTestDate via advanceSchedule — a
// host that uses annotations to decide whether a tool call needs explicit
// confirmation must not treat either as purely additive the way
// WRITE_CREATE's tasks are.
const WRITE_DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
// complete_task's *result* converges on a second call with the same id
// (idempotentHint: true), but unlike WRITE_CREATE it overwrites existing
// state rather than only adding to it, and PoolDataSource exposes no way
// to reopen a task — so, like WRITE_DESTRUCTIVE, a host must not treat it
// as safe to apply without confirmation just because it's additive.
const WRITE_COMPLETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

// Bounded well under Vercel's ~4.5 MB serverless request-body cap, not
// just an arbitrary "reasonable photo" ceiling: the photo travels as
// base64 inside the MCP JSON-RPC request, which inflates it ~4/3, so an
// 8 MB decoded photo would need a >10 MB request body and get rejected by
// the platform before this check ever ran. 3 MB decoded -> ~4 MB encoded
// leaves headroom for the rest of the JSON-RPC envelope.
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

// Same constant and reasoning as hannaCloud/source.ts's parseHannaTimestamp:
// an implausibly-far-future timestamp (garbled input, or a model guessing
// at "now") would otherwise become the newest reading and sort ahead of
// every real one — advancing the testing schedule and burying subsequent
// legitimate readings behind it — potentially for a long time, since
// nothing else in this app corrects a wrong-but-plausible-looking future
// date. Not a guess at "now", just a sanity ceiling.
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

// notes is free text from a conversation (sometimes an AI transcription),
// and without a bound it could push the resulting Firestore document over
// Firestore's own 1 MiB document limit — which would then deterministically
// fail createReading's write on *every* attempt, including its retry, well
// after the evidence photo has already been uploaded and (per the
// never-delete-on-ambiguous-failure policy above) left in place. Enforced
// in the tool's own inputSchema (z.string().max(...)) so the MCP SDK
// rejects an oversized note before the handler — and any upload — ever
// runs. Generous for genuine field notes, far below the point where
// document size becomes a real concern.
export const MAX_NOTES_LENGTH = 4000;

// Buffer.from(str, 'base64') silently drops characters outside the
// base64 alphabet instead of throwing — 'not-base64!!' decodes to
// nonempty garbage bytes rather than raising an error — so it can't be
// relied on to reject malformed input on its own. Checked before
// decoding, not after.
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
function isValidBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 === 0 && BASE64_PATTERN.test(value);
}

// A lightweight sanity check, not a full decode: confirms the declared
// content_type isn't a bare label slapped on arbitrary bytes (e.g. text
// mislabeled image/jpeg would otherwise satisfy the "photo required"
// evidence gate with an unusable file) by checking each format's magic
// bytes. Doesn't verify the image is well-formed beyond its header —
// that would need an image-decoding dependency this project doesn't have
// — but it does rule out "this obviously isn't that image format."
function matchesImageSignature(data: Buffer, contentType: string): boolean {
  switch (contentType) {
    case 'image/jpeg':
      return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    case 'image/png':
      return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp':
      return data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP';
    default:
      return false;
  }
}

const PhotoEvidence = z.object({
  data_base64: z.string().describe('Raw base64-encoded photo bytes — no "data:" URL prefix, just the payload.'),
  content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']).describe('The photo\'s MIME type.'),
}).describe('A photo of the test strip/meter/report this reading is transcribed from — required, since a number typed into a conversation has no other evidence trail.');

const NumericFieldInput = z.number().optional();

export function createPoolStatusMcpServer(source: PoolDataSource): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    'poolstatus_get_latest_reading',
    {
      title: 'Get latest pool reading',
      description: `Return the most recent water-chemistry reading with derived values. Skips past any trailing note-only logs (a log saved with no measurements) to find the latest one that actually has a measurement.

Includes every logged measurement (free/total chlorine, ORP, pH, alkalinity, temperature, differential pressure, calcium hardness, cyanuric acid), per-field status against the app's target ranges, the Langelier Saturation Index (LSI), and combined chlorine (total − free) with its status and any warning.

Args:
  - response_format ('markdown' | 'json'): default 'markdown'

Returns: { reading: {...} | null, targets: { field: { min, max, unit } } }. Fields that were not measured are null. fieldWarnings gives the specific reason a field is flagged (e.g. "Sanitisation may be too low (<650 mV)"), alongside fieldStatus's plain good/warning/critical. If the reading was amended after creation, editedAt and previousValues (the overwritten measurements, by field) show what it originally said.

Use when: "What are the latest pool numbers?", "Is the water balanced right now?"
Don't use when: you need history or averages (use poolstatus_list_readings or poolstatus_get_reading_trends).`,
      inputSchema: { response_format: ResponseFormat },
      annotations: READ_ONLY,
    },
    async ({ response_format }) => {
      // A note logged after the last real test (handleSaveReading in
      // App.tsx doesn't count it as a completed test either) shouldn't
      // hide that test's actual numbers — or a genuinely out-of-range
      // reading right before it — behind an all-null "latest" row. Scan a
      // bounded window of recent rows for the first with a measurement
      // rather than blindly taking the very newest one.
      const candidates = await source.listReadings({ limit: LATEST_READING_SEARCH_LIMIT });
      const latest = candidates.find(hasMeasurement) ?? null;
      const reading = latest ? serializeReading(latest) : null;
      const output = { reading, targets: DEFAULT_RANGES };
      if (!reading) return toolResult(output, 'No readings have been logged yet.');
      const text = response_format === 'json' ? JSON.stringify(output, null, 2) : readingToMarkdown(reading);
      return toolResult(output, text);
    },
  );

  server.registerTool(
    'poolstatus_list_readings',
    {
      title: 'List pool readings',
      description: `List water-chemistry readings, newest first, optionally within a date window.

Args:
  - since (ISO date, optional): only readings at or after this instant
  - until (ISO date, optional): only readings at or before this instant; a date with no time (e.g. "2026-09-01") includes that entire day
  - before (opaque string, optional): pagination cursor — pass the next_before value from a previous page, unmodified, to get the page after it
  - limit (1–${MAX_LIST_LIMIT}, default 20)
  - response_format ('markdown' | 'json'): default 'markdown'

Returns: { count, readings: [...same shape as poolstatus_get_latest_reading...], has_more, next_before }.

Use when: "Show me last week's readings", "When did chlorine last hit zero?"`,
      inputSchema: {
        since: IsoDate.optional(),
        until: IsoDate.optional(),
        before: z.string().optional().describe("Opaque pagination cursor — pass a previous page's next_before value unmodified."),
        limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(20),
        response_format: ResponseFormat,
      },
      annotations: READ_ONLY,
    },
    async ({ since, until, before, limit, response_format }) => {
      let cursor;
      try {
        cursor = before ? decodeReadingCursor(before) : undefined;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid pagination cursor.';
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
      const rows = await source.listReadings({
        since: parseDate(since),
        until: parseUntilDate(until),
        before: cursor,
        limit: limit + 1,
      });
      const hasMore = rows.length > limit;
      const pageRows = rows.slice(0, limit);
      const page = pageRows.map(serializeReading);
      const lastRow = pageRows[pageRows.length - 1];
      const output = {
        count: page.length,
        readings: page,
        has_more: hasMore,
        next_before: hasMore && lastRow ? encodeReadingCursor({ timestamp: lastRow.timestamp, id: lastRow.id }) : null,
      };
      if (page.length === 0) return toolResult(output, 'No readings found for that window.');
      const text = response_format === 'json'
        ? JSON.stringify(output, null, 2)
        : [
            `## ${page.length} reading${page.length === 1 ? '' : 's'}${hasMore ? ` (more available — pass before="${output.next_before}")` : ''}`,
            '',
            ...page.map(readingToMarkdown),
          ].join('\n\n');
      return toolResult(output, text);
    },
  );

  server.registerTool(
    'poolstatus_get_reading_trends',
    {
      title: 'Get pool reading trends',
      description: `Summarise each measurement over the last N days: count, latest, average, min, max, direction, and the latest value's status against its target range. Also includes combined chlorine and LSI as derived metrics.

Args:
  - days (1–${MAX_TREND_DAYS}, default 7)
  - response_format ('markdown' | 'json'): default 'markdown'

Returns: { days, readings_considered, from, to, truncated, metrics: { field: { label, unit, count, latest, average, min, max, direction, target: {min,max}, status, warning } } }.
direction compares the newest value with the oldest in the window: 'rising' | 'falling' | 'flat' (within 2% of the target span). warning explains why the latest value is flagged (null when status is 'good' or there's no data).
truncated is true if the window holds more than ${MAX_TREND_ROWS} measurements — in that case only the most recent ${MAX_TREND_ROWS} are summarised — or if scanning a long run of note-only logs hit an internal fetch ceiling before confirming the rest of the window holds nothing more. Either way 'from' is adjusted to match what was actually summarised, not the full requested window. Narrow 'days', or use poolstatus_list_readings to page through everything, if that happens.

Use when: "How has pH trended this month?", "Is combined chlorine creeping up?"`,
      inputSchema: {
        days: z.number().int().min(1).max(MAX_TREND_DAYS).default(7),
        response_format: ResponseFormat,
      },
      annotations: READ_ONLY,
    },
    async ({ days, response_format }) => {
      const to = new Date();
      const requestedFrom = new Date(to.getTime() - days * 86_400_000);
      // Paginates past note-only logs rather than letting them occupy a
      // slot in the cap ahead of real measurements — see fetchTrendRows.
      const { rows, truncated, scanBoundary } = await fetchTrendRows(source, requestedFrom, to);
      // 'from' always matches what the metrics below actually reflect: the
      // oldest measurement kept, whenever there is one — whether that's
      // because more than the cap were found, or because the fetch
      // ceiling was hit first. Only when truncated with zero measurements
      // found at all is there no "oldest kept" to point to, so it falls
      // back to how far scanning actually got.
      const from = !truncated ? requestedFrom : rows.length > 0 ? rows[rows.length - 1].timestamp : scanBoundary ?? requestedFrom;

      type Series = { label: string; unit: string; values: number[]; target: { min: number; max: number } | null };
      const series: Record<string, Series> = {};
      for (const field of NUMERIC_READING_FIELDS) {
        series[field] = { label: LABELS[field], unit: UNITS[field], values: [], target: { min: DEFAULT_RANGES[field].min, max: DEFAULT_RANGES[field].max } };
      }
      series.combinedChlorine = { label: 'Combined chlorine', unit: 'ppm', values: [], target: { min: 0, max: COMBINED_CHLORINE_OK_MAX } };
      series.lsi = { label: 'LSI', unit: '', values: [], target: { min: -0.3, max: 0.3 } };

      // rows are newest-first; push in that order so values[0] is the latest.
      for (const reading of rows) {
        for (const field of NUMERIC_READING_FIELDS) {
          const value = reading[field];
          if (value != null) series[field].values.push(value);
        }
        // Total below free is a measurement error, not a valid zero (see
        // getCombinedChlorineWarning) — combinedChlorineOf clamps it to 0,
        // which would otherwise make an erroneous pair look like a clean
        // "no chloramines" reading in the average/min/direction below.
        const { chlorine: free, totalChlorine: total } = reading;
        const combined = free != null && total != null && total >= free ? combinedChlorineOf(free, total) : null;
        if (combined != null) series.combinedChlorine.values.push(combined);
        const lsi = calculateLSI(reading);
        if (lsi != null) series.lsi.values.push(lsi);
      }

      const metrics = Object.fromEntries(
        Object.entries(series).map(([key, { label, unit, values, target }]) => {
          if (values.length === 0) {
            return [key, { label, unit, count: 0, latest: null, average: null, min: null, max: null, direction: null, target, status: null, warning: null }];
          }
          const latest = values[0];
          const oldest = values[values.length - 1];
          const span = target ? target.max - target.min : 0;
          const delta = latest - oldest;
          const direction = Math.abs(delta) <= span * 0.02 ? 'flat' : delta > 0 ? 'rising' : 'falling';
          const status: Status | null =
            key === 'combinedChlorine' ? getCombinedChlorineStatus(latest)
            : key === 'lsi' ? lsiStatus(latest)
            : key === 'sanitisationMv' ? getSanitisationMvStatus(latest)
            : target ? getRangeStatus(latest, target.min, target.max) : null;
          const round = (n: number) => Math.round(n * 100) / 100;
          return [key, {
            label, unit,
            count: values.length,
            latest: round(latest),
            average: round(values.reduce((a, b) => a + b, 0) / values.length),
            min: round(Math.min(...values)),
            max: round(Math.max(...values)),
            direction, target, status,
            warning: getMetricWarning(key, latest, status),
          }];
        }),
      );

      const output = { days, readings_considered: rows.length, from: from.toISOString(), to: to.toISOString(), truncated, metrics };
      if (rows.length === 0) {
        return toolResult(
          output,
          truncated
            // Scanning stopped at the fetch ceiling before finding a single
            // measurement or confirming the window holds none — distinct
            // from the window genuinely having nothing in it.
            ? `Scanned up to ${MAX_TREND_FETCH_ROWS} logged rows in the last ${days} day${days === 1 ? '' : 's'} without finding a measurement (mostly notes?) — narrow 'days' or use poolstatus_list_readings.`
            : `No readings in the last ${days} day${days === 1 ? '' : 's'}.`,
        );
      }
      const text = response_format === 'json'
        ? JSON.stringify(output, null, 2)
        : [
            `## Trends over the last ${days} day${days === 1 ? '' : 's'} (${rows.length} reading${rows.length === 1 ? '' : 's'})`,
            ...(truncated ? [
              rows.length >= MAX_TREND_ROWS
                ? `_Window has more than ${MAX_TREND_ROWS} measurements — showing only the most recent ${MAX_TREND_ROWS}, from ${output.from}._`
                : `_Scanned up to ${MAX_TREND_FETCH_ROWS} logged rows without confirming the rest of the window holds nothing more — summarising the ${rows.length} measurement${rows.length === 1 ? '' : 's'} found, from ${output.from}._`,
            ] : []),
            '',
            '| Metric | Latest | Avg | Min | Max | Direction | Target | Status |',
            '|---|---|---|---|---|---|---|---|',
            ...Object.values(metrics)
              .filter((m) => m.count > 0)
              .map((m) => `| ${m.label} | ${m.latest} ${m.unit} | ${m.average} | ${m.min} | ${m.max} | ${m.direction} | ${m.target ? `${m.target.min}–${m.target.max}` : '—'} | ${m.status} |`),
            ...Object.values(metrics)
              .filter((m) => m.warning)
              .map((m) => `- ⚠ ${m.label}: ${m.warning}`),
          ].join('\n');
      return toolResult(output, text);
    },
  );

  server.registerTool(
    'poolstatus_list_tasks',
    {
      title: 'List maintenance tasks',
      description: `List the maintenance checklist.

Args:
  - status ('open' | 'completed' | 'all'): default 'open'
  - frequency ('daily' | 'weekly' | 'monthly' | 'once', optional): filter by cadence
  - response_format ('markdown' | 'json'): default 'markdown'

Returns: { count, tasks: [{ id, title, completed, priority, frequency, isAI, createdAt }] }.

Use when: "What's still to do this week?", "Which critical tasks are open?"`,
      inputSchema: {
        status: z.enum(['open', 'completed', 'all']).default('open'),
        frequency: z.enum(['daily', 'weekly', 'monthly', 'once']).optional(),
        response_format: ResponseFormat,
      },
      annotations: READ_ONLY,
    },
    async ({ status, frequency, response_format }) => {
      const tasks = (await source.listTasks())
        .filter((task) => status === 'all' || (status === 'completed') === task.completed)
        .filter((task) => !frequency || task.frequency === frequency)
        .map((task) => ({ ...task, uid: undefined, createdAt: task.createdAt.toISOString() }));
      const output = { count: tasks.length, tasks };
      if (tasks.length === 0) return toolResult(output, `No ${status === 'all' ? '' : status + ' '}tasks${frequency ? ` with frequency ${frequency}` : ''}.`);
      const text = response_format === 'json'
        ? JSON.stringify(output, null, 2)
        : [`## ${tasks.length} ${status === 'all' ? '' : status + ' '}task${tasks.length === 1 ? '' : 's'}`, '',
            ...tasks.map((t) => `- [${t.completed ? 'x' : ' '}] ${t.title} — ${t.priority} priority, ${t.frequency}${t.isAI ? ' (AI-suggested)' : ''}`)].join('\n');
      return toolResult(output, text);
    },
  );

  server.registerTool(
    'poolstatus_list_inventory',
    {
      title: 'List chemical inventory',
      description: `List chemical stock levels, flagging items at or below their reorder threshold.

Args:
  - low_only (boolean): only return items needing reorder (default false)
  - response_format ('markdown' | 'json'): default 'markdown'

Returns: { count, low_count, items: [{ id, name, quantity, unit, minThreshold, low }] }.

Use when: "What do I need to reorder?", "How much soda ash is left?"`,
      inputSchema: { low_only: z.boolean().default(false), response_format: ResponseFormat },
      annotations: READ_ONLY,
    },
    async ({ low_only, response_format }) => {
      const all = (await source.listInventory()).map((item) => ({ ...item, uid: undefined, low: item.quantity <= item.minThreshold }));
      const items = low_only ? all.filter((item) => item.low) : all;
      const output = { count: items.length, low_count: all.filter((item) => item.low).length, items };
      if (items.length === 0) return toolResult(output, low_only ? 'Nothing needs reordering.' : 'No inventory items recorded.');
      const text = response_format === 'json'
        ? JSON.stringify(output, null, 2)
        : [`## Inventory (${output.low_count} low)`, '',
            ...items.map((i) => `- ${i.name}: ${i.quantity} ${i.unit} (reorder at ${i.minThreshold} ${i.unit})${i.low ? ' ⚠ LOW' : ''}`)].join('\n');
      return toolResult(output, text);
    },
  );

  server.registerTool(
    'poolstatus_list_equipment',
    {
      title: 'List equipment and service status',
      description: `List registered equipment with install date, last service, service interval, computed next service date, and whether service is due.

Args:
  - due_only (boolean): only return equipment whose service is due (default false)
  - response_format ('markdown' | 'json'): default 'markdown'

Returns: { count, due_count, items: [{ id, name, installDate, lastServiceDate, serviceIntervalMonths, nextServiceDate, serviceDue }] }.

Use when: "Is the sand filter due a service?", "What maintenance is overdue?"`,
      inputSchema: { due_only: z.boolean().default(false), response_format: ResponseFormat },
      annotations: READ_ONLY,
    },
    async ({ due_only, response_format }) => {
      const now = new Date();
      const all = (await source.listEquipment()).map((item) => {
        const next = nextServiceDate(item);
        return {
          id: item.id,
          name: item.name,
          installDate: item.installDate.toISOString(),
          lastServiceDate: iso(item.lastServiceDate),
          serviceIntervalMonths: item.serviceIntervalMonths ?? null,
          nextServiceDate: iso(next),
          serviceDue: next != null && next <= now,
        };
      });
      const items = due_only ? all.filter((item) => item.serviceDue) : all;
      const output = { count: items.length, due_count: all.filter((item) => item.serviceDue).length, items };
      if (items.length === 0) return toolResult(output, due_only ? 'No equipment is due for service.' : 'No equipment recorded.');
      const text = response_format === 'json'
        ? JSON.stringify(output, null, 2)
        : [`## Equipment (${output.due_count} due for service)`, '',
            ...items.map((i) => `- ${i.name}: next service ${i.nextServiceDate ? i.nextServiceDate.slice(0, 10) : 'not scheduled'}${i.serviceDue ? ' ⚠ DUE' : ''}${i.lastServiceDate ? `, last serviced ${i.lastServiceDate.slice(0, 10)}` : ''}`)].join('\n');
      return toolResult(output, text);
    },
  );

  server.registerTool(
    'poolstatus_get_schedule',
    {
      title: 'Get water-testing schedule',
      description: `Return the water-testing cadence and reminder settings: test frequency, last and next test dates, whether reminders are on, and whether the next test is overdue.

Args: none.

Returns: { schedule: { testFrequency, lastTestDate, nextTestDate, remindersEnabled, overdue } | null }.

Use when: "When is the next test due?", "Am I behind on testing?"`,
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const schedule = await source.getSchedule();
      if (!schedule) return toolResult({ schedule: null }, 'No testing schedule has been set up.');
      const overdue = schedule.nextTestDate != null && schedule.nextTestDate < new Date();
      const output = {
        schedule: {
          testFrequency: schedule.testFrequency,
          lastTestDate: iso(schedule.lastTestDate),
          nextTestDate: iso(schedule.nextTestDate),
          remindersEnabled: schedule.remindersEnabled,
          overdue,
        },
      };
      const text = [
        `Testing ${schedule.testFrequency}; reminders ${schedule.remindersEnabled ? 'on' : 'off'}.`,
        `Last test: ${output.schedule.lastTestDate ?? 'never'}.`,
        `Next test: ${output.schedule.nextTestDate ?? 'not scheduled'}${overdue ? ' — OVERDUE' : ''}.`,
      ].join(' ');
      return toolResult(output, text);
    },
  );

  server.registerTool(
    'poolstatus_log_reading',
    {
      title: 'Log a pool reading (photo required)',
      description: `Log a new water-chemistry reading from numbers discussed in this conversation. Requires a photo of the test strip, meter, or report the numbers came from — this tool has no other way to back a number typed into a conversation with evidence, unlike a manual test or a controller's own sensor. A reading logged this way is marked with that photo's URL, visible to poolstatus_get_latest_reading/list_readings/get_reading_trends the same as any other.

Args:
  - photo: { data_base64, content_type } (required)
  - chlorine, total_chlorine, sanitisation_mv, ph, alkalinity, temperature, differential_pressure, calcium_hardness, cyanuric_acid (all optional numbers, but at least one is required — a photo alone isn't a completed test)
  - notes (optional string, max ${MAX_NOTES_LENGTH} characters)
  - timestamp (ISO date-time, optional, defaults to now)

Abnormal-but-possible values (e.g. very high or low ORP, unusual alkalinity) are never rejected and always save — they're exactly the kind of incident evidence this tool exists to capture — but come back with a warning, same as the manual entry form's non-blocking validation. Only a genuinely impossible value (non-finite, or below the field's physical minimum, e.g. a negative concentration) is rejected.

Use when: "Log this reading: pH 7.4, chlorine 2.1, here's a photo of the strip."
Don't use when: no photo is available, or the operator is just describing what they observed without a photo (offer poolstatus_add_task for a follow-up reminder instead).`,
      inputSchema: {
        photo: PhotoEvidence,
        chlorine: NumericFieldInput,
        total_chlorine: NumericFieldInput,
        sanitisation_mv: NumericFieldInput,
        ph: NumericFieldInput,
        alkalinity: NumericFieldInput,
        temperature: NumericFieldInput,
        differential_pressure: NumericFieldInput,
        calcium_hardness: NumericFieldInput,
        cyanuric_acid: NumericFieldInput,
        notes: z.string().max(MAX_NOTES_LENGTH).optional(),
        timestamp: IsoDate.optional(),
      },
      annotations: WRITE_DESTRUCTIVE,
    },
    async ({ photo, chlorine, total_chlorine, sanitisation_mv, ph, alkalinity, temperature, differential_pressure, calcium_hardness, cyanuric_acid, notes, timestamp }) => {
      const fields: Partial<Record<NumericReadingField, number>> = {
        ...(chlorine != null ? { chlorine } : {}),
        ...(total_chlorine != null ? { totalChlorine: total_chlorine } : {}),
        ...(sanitisation_mv != null ? { sanitisationMv: sanitisation_mv } : {}),
        ...(ph != null ? { ph } : {}),
        ...(alkalinity != null ? { alkalinity } : {}),
        ...(temperature != null ? { temperature } : {}),
        ...(differential_pressure != null ? { differentialPressure: differential_pressure } : {}),
        ...(calcium_hardness != null ? { calciumHardness: calcium_hardness } : {}),
        ...(cyanuric_acid != null ? { cyanuricAcid: cyanuric_acid } : {}),
      };
      if (Object.keys(fields).length === 0) {
        return { content: [{ type: 'text' as const, text: 'At least one measurement is required — a photo alone isn\'t a completed test.' }], isError: true };
      }
      const impossibleErrors = Object.entries(fields)
        .map(([field, value]) => getImpossibleValueError(field as NumericReadingField, value))
        .filter(Boolean);
      if (impossibleErrors.length > 0) {
        return { content: [{ type: 'text' as const, text: impossibleErrors.join(' ') }], isError: true };
      }
      const readingTimestamp = parseDate(timestamp) ?? new Date();
      if (readingTimestamp.getTime() > Date.now() + MAX_CLOCK_SKEW_MS) {
        return { content: [{ type: 'text' as const, text: `timestamp is implausibly far in the future: ${readingTimestamp.toISOString()}` }], isError: true };
      }
      if (!isValidBase64(photo.data_base64)) {
        return { content: [{ type: 'text' as const, text: 'photo.data_base64 is not valid base64.' }], isError: true };
      }
      const data = Buffer.from(photo.data_base64, 'base64');
      if (data.length === 0) {
        return { content: [{ type: 'text' as const, text: 'The decoded photo is empty.' }], isError: true };
      }
      if (data.length > MAX_PHOTO_BYTES) {
        return { content: [{ type: 'text' as const, text: `The photo is too large (${(data.length / 1024 / 1024).toFixed(1)} MB, max ${MAX_PHOTO_BYTES / 1024 / 1024} MB).` }], isError: true };
      }
      if (!matchesImageSignature(data, photo.content_type)) {
        return { content: [{ type: 'text' as const, text: `The decoded photo doesn't look like a valid ${photo.content_type} file.` }], isError: true };
      }

      const created = await source.createReading({
        timestamp: readingTimestamp,
        notes,
        photo: { data, contentType: photo.content_type },
        ...fields,
      });
      const serialized = serializeReading(created);
      const warnings = Object.entries(fields)
        .map(([field, value]) => getSoftWarning(field as NumericReadingField, value)?.message)
        .filter((message): message is string => Boolean(message));
      const text = [
        'Reading logged.',
        '',
        readingToMarkdown(serialized),
        ...(warnings.length > 0 ? ['', ...warnings.map((w) => `- ⚠ ${w}`)] : []),
      ].join('\n');
      return toolResult({ reading: serialized }, text);
    },
  );

  server.registerTool(
    'poolstatus_add_task',
    {
      title: 'Add a maintenance task',
      description: `Add an item to the maintenance checklist — e.g. a follow-up or reminder that came up in this conversation. Stored as an ordinary (non-AI-suggested) task, unlike the in-app AI assistant's own protocol suggestions: those get cleared out automatically the next time a protocol runs, which would silently delete a reminder this tool was asked to add.

Args:
  - title (required, max 100 chars)
  - priority ('low' | 'medium' | 'high' | 'critical', default 'medium')
  - frequency ('daily' | 'weekly' | 'monthly' | 'once', default 'once')

Use when: "Remind me to backwash the filter Friday", "Add a task to reorder soda ash."`,
      inputSchema: {
        title: z.string().min(1).max(100),
        priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
        frequency: z.enum(['daily', 'weekly', 'monthly', 'once']).default('once'),
      },
      annotations: WRITE_CREATE,
    },
    async ({ title, priority, frequency }: { title: string; priority: Priority; frequency: TaskFrequency }) => {
      const task = await source.addTask({ title, priority, frequency });
      const output = { task: { ...task, createdAt: task.createdAt.toISOString() } };
      return toolResult(output, `Task added: "${task.title}" — ${task.priority} priority, ${task.frequency}.`);
    },
  );

  server.registerTool(
    'poolstatus_complete_task',
    {
      title: 'Complete a maintenance task',
      description: `Mark a checklist item completed by id (see poolstatus_list_tasks for ids).

Args:
  - id (required)

Use when: "Mark 'backwash filter' as done."`,
      inputSchema: { id: z.string().min(1) },
      annotations: WRITE_COMPLETE,
    },
    async ({ id }) => {
      try {
        const task = await source.completeTask(id);
        return toolResult({ task: { ...task, createdAt: task.createdAt.toISOString() } }, `Marked "${task.title}" completed.`);
      } catch (error) {
        if (error instanceof NotFoundError) return { content: [{ type: 'text' as const, text: error.message }], isError: true };
        throw error;
      }
    },
  );

  server.registerTool(
    'poolstatus_adjust_inventory',
    {
      title: 'Adjust chemical inventory',
      description: `Add or consume stock of a chemical inventory item by id (see poolstatus_list_inventory for ids and their units). The resulting quantity never goes below 0, however large a consuming delta is requested.

Args:
  - id (required)
  - delta (required — positive to add stock, negative to consume it)
  - unit (required — must exactly match the item's own unit from poolstatus_list_inventory, e.g. "L" or "kg"; no conversion is attempted, so convert the amount yourself before calling if the operator gave a different unit — this prevents e.g. "2 gallons" silently being recorded as 2 of whatever unit the item actually tracks)

Use when: "We used 2 L of muriatic acid today" (call with delta: -2, unit: "L" if that's the item's unit), "Log that a new drum of chlorine granules came in (+25 kg)" (delta: 25, unit: "kg" if that matches).`,
      inputSchema: { id: z.string().min(1), delta: z.number(), unit: z.string().min(1) },
      annotations: WRITE_DESTRUCTIVE,
    },
    async ({ id, delta, unit }) => {
      try {
        const item = await source.adjustInventory({ id, delta, unit });
        const low = item.quantity <= item.minThreshold;
        return toolResult({ item: { ...item, low } }, `${item.name}: ${item.quantity} ${item.unit} in stock${low ? ' ⚠ LOW' : ''}.`);
      } catch (error) {
        if (error instanceof NotFoundError || error instanceof UnitMismatchError) {
          return { content: [{ type: 'text' as const, text: error.message }], isError: true };
        }
        throw error;
      }
    },
  );

  return server;
}
