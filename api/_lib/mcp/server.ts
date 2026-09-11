import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { calculateLSI } from '../../../src/lib/lsi';
import {
  COMBINED_CHLORINE_MAX,
  COMBINED_CHLORINE_OK_MAX,
  combinedChlorineOf,
  getCombinedChlorineStatus,
  getCombinedChlorineWarning,
  getSoftWarning,
  NUMERIC_READING_FIELDS,
  type NumericReadingField,
} from '../../../src/lib/readingValidation';
import { DEFAULT_RANGES, type EquipmentItem, type Reading, type Status } from '../../../src/types';
import { decodeReadingCursor, encodeReadingCursor } from './cursor';
import type { PoolDataSource } from './types';

export const SERVER_NAME = 'poolstatus-mcp-server';
export const SERVER_VERSION = '1.0.0';

const MAX_LIST_LIMIT = 100;
const MAX_TREND_DAYS = 90;
// Enough readings for a 90-day window at several tests a day; anything
// beyond this is summarised from the most recent rows (and reported as
// `truncated`, with `from` adjusted to match — see poolstatus_get_reading_trends).
// Exported so tests can exercise the truncation path without hardcoding it twice.
export const MAX_TREND_ROWS = 500;
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
truncated is true if the window holds more than ${MAX_TREND_ROWS} readings — in that case only the most recent ${MAX_TREND_ROWS} are summarised, and 'from' is adjusted to the oldest of those (not the full requested window) so it always matches what was actually averaged. Narrow 'days', or use poolstatus_list_readings to page through everything, if that happens.

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
      // Ask for one more than the cap so a window that has exactly
      // MAX_TREND_ROWS readings isn't mistaken for a truncated one.
      const fetched = await source.listReadings({ since: requestedFrom, until: to, limit: MAX_TREND_ROWS + 1 });
      const truncated = fetched.length > MAX_TREND_ROWS;
      // Newest-first, so capping at MAX_TREND_ROWS keeps the most recent
      // readings and drops the oldest ones in the window — reflected below
      // by reporting 'from' as the oldest reading actually included,
      // rather than the full requested window, whenever that happens.
      const capped = truncated ? fetched.slice(0, MAX_TREND_ROWS) : fetched;
      const from = truncated ? capped[capped.length - 1].timestamp : requestedFrom;
      // Notes-only rows contribute nothing to any metric, so they shouldn't
      // inflate readings_considered or produce a "N readings" heading over
      // an otherwise-empty table. They can still occupy a slot in the row
      // cap above ahead of real measurements in a window with many of them
      // — narrower than this fix, and left as a known limitation rather
      // than adding a bounded-continuation pagination loop here.
      const rows = capped.filter(hasMeasurement);

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
      if (rows.length === 0) return toolResult(output, `No readings in the last ${days} day${days === 1 ? '' : 's'}.`);
      const text = response_format === 'json'
        ? JSON.stringify(output, null, 2)
        : [
            `## Trends over the last ${days} day${days === 1 ? '' : 's'} (${rows.length} reading${rows.length === 1 ? '' : 's'})`,
            ...(truncated ? [`_Window has more than ${MAX_TREND_ROWS} readings — showing only the most recent ${MAX_TREND_ROWS}, from ${output.from}._`] : []),
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

  return server;
}
