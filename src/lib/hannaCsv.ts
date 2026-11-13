import { DEFAULT_RANGES } from '../types.js';
import { wallClockOffsets, type DeviceClock } from './deviceClock.js';
import { getImpossibleValueError, getSoftWarning, ORP_ACTION_ALERT_MV, type NumericReadingField } from './readingValidation.js';

/**
 * Parser for the CSV a Hanna BL-series pool controller (e.g. BL122) exports:
 * a block of "Key, Value" header lines, calibration tables, then one row per
 * logging window with the min/max pH, ORP and temperature the controller saw
 * in that window plus how much its acid/base and chlorine pumps dosed.
 *
 * The format isn't documented anywhere public, so this gets the same
 * zero-trust treatment as the Hanna Cloud API (see the pool-controller-sync
 * skill): columns are located by header text, never by position, "--" and
 * blank cells become null (never Number('') === 0), timestamps must be a
 * real calendar date-time, and a row with nothing in it is skipped rather
 * than stored as an all-null window.
 */

export interface HannaWindow {
  rec: number;
  /**
   * 1 normally; 2 for the second window in one file with the same start
   * text, which happens when clocks go back and an hour repeats.
   * Part of the doc id so the two never overwrite each other.
   */
  occurrence: number;
  /** Raw "YYYY-MM-DD HH:MM:SS" from the file: the controller's own clock, no offset. */
  startLocal: string;
  endLocal: string;
  /** startLocal/endLocal as instants, read on the controller clock given to parseHannaCsv. */
  start: Date;
  end: Date;
  phMin: number | null;
  phMax: number | null;
  orpMinMv: number | null;
  orpMaxMv: number | null;
  temperatureMinC: number | null;
  temperatureMaxC: number | null;
  acidBaseMinMl: number | null;
  acidBaseMaxMl: number | null;
  chlorineMinMl: number | null;
  chlorineMaxMl: number | null;
}

export interface HannaExport {
  deviceId: string;
  model: string | null;
  location: string | null;
  /** The period the export was asked for, from the header. The rows can cover far less. */
  requestedStart: string | null;
  requestedEnd: string | null;
  windows: HannaWindow[];
  /** Rows with no probe value and no dose at all, e.g. while the controller was offline. */
  emptyRows: number;
  /** #Rec numbers of rows whose timestamps couldn't be read. */
  invalidRows: number[];
}

export class HannaCsvError extends Error {}

const COLUMNS = {
  rec: '#rec',
  start: 'start date & time',
  end: 'end date & time',
  phMin: 'min ph',
  phMax: 'max ph',
  orpMinMv: 'min orp(mv)',
  orpMaxMv: 'max orp(mv)',
  temperatureMinC: 'min temp (°c)',
  temperatureMaxC: 'max temp (°c)',
  acidBaseMinMl: 'min acid/base (ml)',
  acidBaseMaxMl: 'max acid/base (ml)',
  chlorineMinMl: 'min cl2 (ml)',
  chlorineMaxMl: 'max cl2 (ml)',
} as const;
type Column = keyof typeof COLUMNS;

// Plausibility checks reuse the MCP/sync bounds table (getImpossibleValueError),
// not the manual form's typo ceiling: AGENTS.md says abnormal-but-possible
// pH/ORP must never be dropped.
const PROBE_FIELD: Partial<Record<ValueColumn, NumericReadingField>> = {
  phMin: 'ph', phMax: 'ph',
  orpMinMv: 'sanitisationMv', orpMaxMv: 'sanitisationMv',
  temperatureMinC: 'temperature', temperatureMaxC: 'temperature',
};
const PROBE_COLUMNS = ['phMin', 'phMax', 'orpMinMv', 'orpMaxMv', 'temperatureMinC', 'temperatureMaxC'] as const;
const DOSE_COLUMNS = ['acidBaseMinMl', 'acidBaseMaxMl', 'chlorineMinMl', 'chlorineMaxMl'] as const;
type ValueColumn = typeof PROBE_COLUMNS[number] | typeof DOSE_COLUMNS[number];
const isDoseColumn = (k: ValueColumn) => (DOSE_COLUMNS as readonly string[]).includes(k);

const normaliseHeader = (h: string) => h.trim().toLowerCase().replace(/₂/g, '2').replace(/\s+/g, ' ');

/** Splits one CSV line, honouring double-quoted cells (the calibration rows quote commas). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cell.trim()); cell = ''; }
    else cell += c;
  }
  out.push(cell.trim());
  return out;
}

const NUMBER = /^-?\d+(?:\.\d+)?$/;
/** "--", blank, or anything non-numeric is "not measured", never 0. */
export function parseCell(raw: string | undefined): number | null {
  const s = (raw ?? '').trim();
  if (!NUMBER.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
/**
 * Reads "YYYY-MM-DD HH:MM:SS" as an instant on the controller's own clock.
 * The text carries no offset, so `clock` says what it means; the same text
 * is a different instant on a UTC clock and on a UK-local one.
 *
 * Returns null for anything that is not a real date-time on that clock:
 * 2026-02-30, hour 24, or (on a 'zone' clock) a local time skipped when
 * clocks go forward. Rejected rather than silently shifted, so the caller
 * can report the row.
 *
 * When a 'zone' clock goes back, an hour of local time happens twice.
 * `occurrence` picks which: 1 is the first pass through it, 2 the repeat an
 * hour later. An export lists its rows in order, so the second row with the
 * same start text is the repeat.
 */
export function parseDeviceDateTime(s: string, clock: DeviceClock, occurrence = 1): Date | null {
  const m = DATE_TIME.exec(s.trim());
  if (!m) return null;
  const [Y, M, D, h, min, sec] = m.slice(1).map(Number);
  const wallClockAsUtcMs = Date.UTC(Y, M - 1, D, h, min, sec);
  const check = new Date(wallClockAsUtcMs);
  if (check.getUTCFullYear() !== Y || check.getUTCMonth() !== M - 1 || check.getUTCDate() !== D ||
      check.getUTCHours() !== h || check.getUTCMinutes() !== min || check.getUTCSeconds() !== sec) return null;

  if (clock.kind === 'utc') return check;
  if (clock.kind === 'offset') return new Date(wallClockAsUtcMs - clock.minutes * 60_000);
  const offsets = wallClockOffsets(wallClockAsUtcMs, clock.timeZone);
  if (offsets.length === 0) return null;
  const offset = offsets[Math.min(occurrence, offsets.length) - 1];
  return new Date(wallClockAsUtcMs - offset * 60_000);
}

/**
 * Parses a controller export. `clock` is what the controller's own clock is
 * set to, and it is required: guessing it (the importing browser's zone, or
 * UTC) is exactly how imported windows came to disagree with the cloud sync.
 */
export function parseHannaCsv(text: string, clock: DeviceClock): HannaExport {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.replace(/[\t ]+$/, ''));
  if (lines.every((l) => l.trim() === '')) throw new HannaCsvError('The file is empty.');

  const headerIdx = lines.findIndex((l) => splitCsvLine(l).some((c) => normaliseHeader(c) === COLUMNS.rec));
  if (headerIdx === -1) {
    throw new HannaCsvError('This doesn\'t look like a Hanna controller export: no "#Rec" data table was found.');
  }

  // "Key, Value" lines before the data table. The first occurrence of a key
  // wins: "Serial No." appears for both the controller and the pH probe.
  const meta = new Map<string, string>();
  for (const line of lines.slice(0, headerIdx)) {
    const comma = line.indexOf(',');
    if (comma === -1) continue;
    const key = line.slice(0, comma).trim().toLowerCase();
    if (!meta.has(key)) meta.set(key, line.slice(comma + 1).trim());
  }
  const deviceId = meta.get('device id') ?? '';
  if (!deviceId) throw new HannaCsvError('The export has no "Device ID" line, so it can\'t be matched to a controller.');

  const header = splitCsvLine(lines[headerIdx]).map(normaliseHeader);
  if (header.some((h) => h.includes('°f'))) {
    throw new HannaCsvError('This export uses °F. Switch the controller to °C and export again.');
  }
  const col = {} as Record<Column, number>;
  const missing: string[] = [];
  for (const [key, name] of Object.entries(COLUMNS) as [Column, string][]) {
    col[key] = header.indexOf(name);
    if (col[key] === -1) missing.push(name);
  }
  if (missing.length) {
    throw new HannaCsvError(`The export is missing expected columns: ${missing.join(', ')}. The controller's file format may have changed.`);
  }

  const windows: HannaWindow[] = [];
  const invalidRows: number[] = [];
  let emptyRows = 0;
  const startsSeen = new Map<string, number>();
  for (const line of lines.slice(headerIdx + 1)) {
    if (line.trim() === '') continue;
    const cells = splitCsvLine(line);
    const rec = parseCell(cells[col.rec]);
    if (rec == null) continue; // a trailing note or a second table, not a data row

    const values = {} as Record<ValueColumn, number | null>;
    for (const key of [...PROBE_COLUMNS, ...DOSE_COLUMNS]) {
      let v = parseCell(cells[col[key]]);
      const field = PROBE_FIELD[key];
      if (v != null && field && getImpossibleValueError(field, v) !== '') v = null;
      if (v != null && isDoseColumn(key) && v < 0) v = null;
      values[key] = v;
    }
    const hasProbe = PROBE_COLUMNS.some((k) => values[k] != null);
    const hasDose = DOSE_COLUMNS.some((k) => (values[k] ?? 0) > 0);
    if (!hasProbe && !hasDose) { emptyRows++; continue; }

    const startLocal = (cells[col.start] ?? '').trim();
    const endLocal = (cells[col.end] ?? '').trim();
    const occurrence = (startsSeen.get(startLocal) ?? 0) + 1;
    const start = parseDeviceDateTime(startLocal, clock, occurrence);
    const end = parseDeviceDateTime(endLocal, clock, occurrence);
    if (!start || !end || end < start) { invalidRows.push(rec); continue; }
    startsSeen.set(startLocal, occurrence);

    windows.push({ rec, occurrence, startLocal, endLocal, start, end, ...values });
  }

  windows.sort((a, b) => a.start.getTime() - b.start.getTime());
  return {
    deviceId,
    model: meta.get('device model no.') ?? meta.get('model') ?? null,
    location: meta.get('location') ?? null,
    requestedStart: meta.get('start date') ?? null,
    requestedEnd: meta.get('end date') ?? null,
    windows,
    emptyRows,
    invalidRows,
  };
}

/**
 * Deterministic Firestore doc id for one window, so importing the same file
 * twice (or an overlapping later export) can never duplicate it. Built from
 * the raw timestamp text, not the parsed instant, so a re-import with a
 * different controller clock still lands on the same document. Prefixed
 * with the owner's uid: firestore.rules requires that on create, so another
 * account can't pre-claim one of these ids. A repeated local start time
 * (clocks going back) gets an "_2" suffix so it doesn't overwrite the first.
 */
export function controllerLogDocId(uid: string, deviceId: string, startLocal: string, occurrence = 1): string {
  const device = deviceId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);
  const stamp = startLocal.replace(/[-:]/g, '').replace(' ', 'T');
  return `${uid}_${device}_${stamp}${occurrence > 1 ? `_${occurrence}` : ''}`;
}

export const windowDocId = (uid: string, deviceId: string, w: Pick<HannaWindow, 'startLocal' | 'occurrence'>) =>
  controllerLogDocId(uid, deviceId, w.startLocal, w.occurrence);

export interface ImportPlan {
  /** Windows with no stored document yet. */
  fresh: { w: HannaWindow; id: string }[];
  /**
   * Windows already stored whose saved start is a different instant, which
   * means they were imported on another controller clock. Writing them again
   * fixes the stored times; the id is unchanged.
   */
  corrected: { w: HannaWindow; id: string }[];
  /** Windows already stored with the same start. Nothing to write. */
  unchanged: number;
}

/**
 * Decides what an import has to write, given the start time (epoch ms)
 * stored for each window id that already exists.
 */
export function planImport(
  windows: HannaWindow[],
  idOf: (w: HannaWindow) => string,
  storedStartMs: ReadonlyMap<string, number>,
): ImportPlan {
  const plan: ImportPlan = { fresh: [], corrected: [], unchanged: 0 };
  for (const w of windows) {
    const id = idOf(w);
    const stored = storedStartMs.get(id);
    if (stored === undefined) plan.fresh.push({ w, id });
    else if (stored !== w.start.getTime()) plan.corrected.push({ w, id });
    else plan.unchanged++;
  }
  return plan;
}

/** Windows where either pump ran, for the import preview. */
export const isDoseWindow = (w: HannaWindow) => (w.acidBaseMaxMl ?? 0) > 0 || (w.chlorineMaxMl ?? 0) > 0;

// AGENTS.md's typical pH target is 7.2–7.6. DEFAULT_RANGES.ph runs to 7.8
// (the "warn above" line), so 7.6–7.8 is flagged here as a softer watch.
const PH_TYPICAL_MAX = 7.6;

export interface WindowSafetyWarning {
  field: 'ph' | 'sanitisationMv';
  /** 'min' for a too-low value (shown as "Lowest"), 'max' for a too-high one ("Highest"). */
  end: 'min' | 'max';
  /** 'watch': outside the typical target but not yet a warning (pH 7.6–7.8). */
  level: 'watch' | 'warning';
  value: number;
  window: HannaWindow;
  message: string;
}

/**
 * The one place controller-log pH/ORP values are graded, shared by the
 * import preview and the controller log view so the two never disagree.
 * pH follows AGENTS.md: typical target 7.2–7.6 ('watch' up to 7.8), warn
 * below 7.0, below 7.2 and above 7.8 (DEFAULT_RANGES.ph's ends). ORP uses
 * getSoftWarning's warning tier plus ORP_ACTION_ALERT_MV's "verify before
 * swimming" line. Returns null when the value is fine.
 */
export function controllerValueWarning(field: 'ph' | 'sanitisationMv', value: number): { level: 'watch' | 'warning'; message: string } | null {
  if (!Number.isFinite(value)) return null;
  if (field === 'ph') {
    // getSoftWarning's pH text is written for the manual form, so word it for a log here.
    const { min, max } = DEFAULT_RANGES.ph;
    if (value < 7.0) return { level: 'warning', message: 'Very low pH (acidic). Retest before any heavy dosing.' };
    if (value < min) return { level: 'warning', message: `Below the ${min}–${PH_TYPICAL_MAX} target. Retest to confirm.` };
    if (value > max) return { level: 'warning', message: 'High pH, likely to reduce chlorine effectiveness. Retest before dosing.' };
    if (value > PH_TYPICAL_MAX) {
      return { level: 'watch', message: `Above the ${min}–${PH_TYPICAL_MAX} target. Chlorine works less well as pH rises, so retest and correct before it climbs further.` };
    }
    return null;
  }
  const soft = getSoftWarning(field, value);
  if (soft?.level === 'warning') return { level: 'warning', message: soft.message };
  if (value > ORP_ACTION_ALERT_MV) {
    return { level: 'warning', message: `ORP above ${ORP_ACTION_ALERT_MV} mV: sanitisation may be high. Verify before swimming or adding more chlorine.` };
  }
  return null;
}

/**
 * pH/ORP warnings for an export, so the import preview can show dangerous
 * values before they're saved. AGENTS.md: warn clearly, never block the
 * save. Grades each value with controllerValueWarning, and reports only
 * the most extreme window per field and direction to keep the list short.
 */
export function summariseSafetyWarnings(windows: HannaWindow[]): { affectedWindows: number; worst: WindowSafetyWarning[] } {
  const affected = new Set<HannaWindow>();
  const worst = new Map<string, WindowSafetyWarning>();
  const consider = (w: HannaWindow, field: WindowSafetyWarning['field'], column: 'min' | 'max', value: number | null, other: number | null) => {
    if (value == null) return;
    const warning = controllerValueWarning(field, value);
    if (!warning) return;
    const { level, message } = warning;
    // A too-low value is normally reported from a window's min and a too-high
    // one from its max, so a steady 7.70–7.70 window is "highest pH 7.70",
    // not also "lowest". Only when that other end exists, though: with the
    // max missing, a high min is the only evidence and must still show.
    const tooLow = field === 'ph' ? value < DEFAULT_RANGES.ph.min : value < DEFAULT_RANGES.sanitisationMv.min;
    if ((column === 'min') !== tooLow && other != null) return;
    const end = tooLow ? 'min' : 'max';
    affected.add(w);
    const key = `${field}:${end}`;
    const prev = worst.get(key);
    if (!prev || (end === 'min' ? value < prev.value : value > prev.value)) {
      worst.set(key, { field, end, level, value, window: w, message });
    }
  };
  for (const w of windows) {
    consider(w, 'ph', 'min', w.phMin, w.phMax);
    consider(w, 'ph', 'max', w.phMax, w.phMin);
    consider(w, 'sanitisationMv', 'min', w.orpMinMv, w.orpMaxMv);
    consider(w, 'sanitisationMv', 'max', w.orpMaxMv, w.orpMinMv);
  }
  // A low and a high from the same window and field would both be listed; that's real (a big swing) and worth seeing.
  const order = ['ph:min', 'ph:max', 'sanitisationMv:min', 'sanitisationMv:max'];
  return { affectedWindows: affected.size, worst: order.flatMap((k) => (worst.has(k) ? [worst.get(k)!] : [])) };
}
