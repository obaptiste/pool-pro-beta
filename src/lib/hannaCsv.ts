import { getImpossibleValueError, type NumericReadingField } from './readingValidation.js';

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
  /** Raw "YYYY-MM-DD HH:MM:SS" from the file. Controller local time, no offset. */
  startLocal: string;
  endLocal: string;
  /** startLocal/endLocal read in the importing browser's own time zone. */
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
 * Reads "YYYY-MM-DD HH:MM:SS" as local time via the Date constructor (never
 * string parsing, which Safari rejects for this format), then checks the
 * result still has the same components, so 2026-02-30 or a time skipped by
 * a DST change is rejected instead of silently shifted.
 */
export function parseLocalDateTime(s: string): Date | null {
  const m = DATE_TIME.exec(s.trim());
  if (!m) return null;
  const [Y, M, D, h, min, sec] = m.slice(1).map(Number);
  const d = new Date(Y, M - 1, D, h, min, sec);
  if (d.getFullYear() !== Y || d.getMonth() !== M - 1 || d.getDate() !== D ||
      d.getHours() !== h || d.getMinutes() !== min || d.getSeconds() !== sec) return null;
  return d;
}

export function parseHannaCsv(text: string): HannaExport {
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
    const start = parseLocalDateTime(startLocal);
    const end = parseLocalDateTime(endLocal);
    if (!start || !end || end < start) { invalidRows.push(rec); continue; }

    windows.push({ rec, startLocal, endLocal, start, end, ...values });
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
 * the raw local timestamp, not the parsed instant, so a re-import from a
 * browser in another time zone still lands on the same document. Prefixed
 * with the owner's uid: firestore.rules requires that on create, so another
 * account can't pre-claim one of these ids.
 */
export function controllerLogDocId(uid: string, deviceId: string, startLocal: string): string {
  const device = deviceId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);
  const stamp = startLocal.replace(/[-:]/g, '').replace(' ', 'T');
  return `${uid}_${device}_${stamp}`;
}

/** Windows where either pump ran, for the import preview. */
export const isDoseWindow = (w: HannaWindow) => (w.acidBaseMaxMl ?? 0) > 0 || (w.chlorineMaxMl ?? 0) > 0;
