import { ControllerLogWindow, DEFAULT_RANGES } from '../types.js';
import { controllerValueWarning } from './hannaCsv.js';

/**
 * Pure helpers behind the controller log views (ControllerLogView,
 * ControllerLogCard). Imported windows are history, not live telemetry:
 * nothing here feeds alerts, readings, LSI, or AI prompts.
 */

export type ControllerMetric = 'ph' | 'orp' | 'temperature';
export type ControllerRange = '48h' | '7d' | '30d' | 'all';

export const CONTROLLER_METRICS: Record<ControllerMetric, {
  label: string;
  unit: string;
  decimals: number;
  min: keyof ControllerLogWindow;
  max: keyof ControllerLogWindow;
  /** Shaded bands drawn behind the chart: [kind, from, to]. */
  zones: ['good' | 'watch', number, number][];
  /** Dashed reference lines. */
  lines: number[];
}> = {
  ph: {
    label: 'pH', unit: '', decimals: 2, min: 'phMin', max: 'phMax',
    zones: [['good', DEFAULT_RANGES.ph.min, 7.6], ['watch', 7.6, DEFAULT_RANGES.ph.max]], lines: [],
  },
  orp: {
    label: 'ORP', unit: 'mV', decimals: 0, min: 'orpMinMv', max: 'orpMaxMv',
    zones: [['good', DEFAULT_RANGES.sanitisationMv.min, DEFAULT_RANGES.sanitisationMv.max], ['watch', DEFAULT_RANGES.sanitisationMv.max, 850]], lines: [800],
  },
  temperature: {
    label: 'Temperature', unit: '°C', decimals: 1, min: 'temperatureMinC', max: 'temperatureMaxC',
    zones: [['good', DEFAULT_RANGES.temperature.min, DEFAULT_RANGES.temperature.max]], lines: [],
  },
};

type DateLike = { toDate(): Date };
const toDate = (v: unknown): Date => (v instanceof Date ? v : (v as DateLike).toDate());
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Firestore document data → window, restoring the Timestamp fields as Dates. */
export function controllerLogFromDoc(data: Record<string, unknown>): ControllerLogWindow {
  return {
    id: String(data.id),
    uid: String(data.uid),
    source: 'hanna-csv',
    deviceId: String(data.deviceId),
    location: typeof data.location === 'string' ? data.location : null,
    startLocal: String(data.startLocal),
    endLocal: String(data.endLocal),
    start: toDate(data.start),
    end: toDate(data.end),
    phMin: num(data.phMin), phMax: num(data.phMax),
    orpMinMv: num(data.orpMinMv), orpMaxMv: num(data.orpMaxMv),
    temperatureMinC: num(data.temperatureMinC), temperatureMaxC: num(data.temperatureMaxC),
    acidBaseMinMl: num(data.acidBaseMinMl), acidBaseMaxMl: num(data.acidBaseMaxMl),
    chlorineMinMl: num(data.chlorineMinMl), chlorineMaxMl: num(data.chlorineMaxMl),
    importedAt: toDate(data.importedAt),
  };
}

/** Oldest first, by the measured instant (never startLocal: a repeated clock-change hour shares it). */
export const sortWindows = (ws: ControllerLogWindow[]) => [...ws].sort((a, b) => a.start.getTime() - b.start.getTime() || a.id.localeCompare(b.id));

/** Device ids, the one with the most recent window first. */
export function devicesByRecency(ws: ControllerLogWindow[]): string[] {
  const latest = new Map<string, number>();
  for (const w of ws) latest.set(w.deviceId, Math.max(latest.get(w.deviceId) ?? -Infinity, w.end.getTime()));
  return [...latest.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

const RANGE_MS: Record<Exclude<ControllerRange, 'all'>, number> = {
  '48h': 48 * 3_600_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

/**
 * Windows in the chosen range, measured back from the latest window's end
 * rather than from now: imports are occasional, so "last 7 days" from now
 * would go empty a week after the last import. Input must be sorted.
 */
export function windowsInRange(sorted: ControllerLogWindow[], range: ControllerRange): ControllerLogWindow[] {
  if (range === 'all' || sorted.length === 0) return sorted;
  const cutoff = sorted[sorted.length - 1].end.getTime() - RANGE_MS[range];
  return sorted.filter((w) => w.end.getTime() > cutoff);
}

/** A window's [min, max] for a metric; one missing end collapses to the other; both missing is no data. */
export function metricRange(w: ControllerLogWindow, metric: ControllerMetric): [number, number] | null {
  const m = CONTROLLER_METRICS[metric];
  const lo = w[m.min] as number | null;
  const hi = w[m.max] as number | null;
  if (lo == null && hi == null) return null;
  return [lo ?? (hi as number), hi ?? (lo as number)];
}

/**
 * Stretches of missing time between consecutive windows: where the next
 * window starts more than 1.5× the typical start-to-start spacing after the
 * previous one. Empty export rows are never stored, so a gap only shows up
 * as missing time. Input must be sorted.
 */
export function findGaps(sorted: ControllerLogWindow[]): { from: Date; to: Date }[] {
  if (sorted.length < 3) return [];
  const steps = sorted.slice(1).map((w, i) => w.start.getTime() - sorted[i].start.getTime()).sort((a, b) => a - b);
  const typical = steps[Math.floor(steps.length / 2)];
  if (!(typical > 0)) return [];
  const gaps: { from: Date; to: Date }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start.getTime() - sorted[i - 1].start.getTime() > typical * 1.5) {
      gaps.push({ from: sorted[i - 1].end, to: sorted[i].start });
    }
  }
  return gaps;
}

export const isDose = (w: ControllerLogWindow) => (w.acidBaseMaxMl ?? 0) > 0 || (w.chlorineMaxMl ?? 0) > 0;

/** Worst grade of a window's range for one metric. Temperature has no AGENTS.md tier, so it's never graded. */
export function windowGrade(w: ControllerLogWindow, metric: ControllerMetric): { level: 'watch' | 'warning'; message: string } | null {
  if (metric === 'temperature') return null;
  const r = metricRange(w, metric);
  if (!r) return null;
  const field = metric === 'ph' ? 'ph' : 'sanitisationMv';
  const grades = [controllerValueWarning(field, r[0]), controllerValueWarning(field, r[1])].filter((g) => g != null);
  return grades.find((g) => g.level === 'warning') ?? grades[0] ?? null;
}

/** "3h ago", "2 days ago": how old the newest imported window is. */
export function formatSince(at: Date, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function formatRange(r: [number, number] | null, metric: ControllerMetric): string {
  if (!r) return 'No data';
  const { decimals, unit } = CONTROLLER_METRICS[metric];
  const text = r[0] === r[1] ? r[0].toFixed(decimals) : `${r[0].toFixed(decimals)}–${r[1].toFixed(decimals)}`;
  return unit ? `${text} ${unit}` : text;
}
