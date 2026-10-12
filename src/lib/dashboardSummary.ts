import { DEFAULT_RANGES, EquipmentItem, InventoryItem, Reading, Status } from '../types.js';
import { classifyOrp, formatAge, isAutoSyncBoilerplateNote } from './readings.js';
import { NumericReadingField, combinedChlorineOf, getCombinedChlorineStatus } from './readingValidation.js';

/**
 * Pure, testable derivations behind the home dashboard's summary surfaces
 * (sync pill, trend glyphs, Operations tiles, Connected-agents row). Kept
 * out of Dashboard.tsx per AGENTS.md's "keep domain logic in reusable
 * utility files, not buried inside components" so each line of copy the
 * operator reads poolside is backed by a unit test rather than JSX.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Range status ──────────────────────────────────────────────────────────────

/**
 * Generic in-range classifier shared by every telemetry card except ORP
 * (which has its own three-tier band — see classifyOrp). Outside
 * [min, max] is critical; within the outer 10 % of the band on either
 * side is a "watch" warning so a value drifting toward the edge is
 * flagged before it crosses it.
 */
export function getRangeStatus(value: number, min: number, max: number): Status {
  if (value < min || value > max) return 'critical';
  const buffer = (max - min) * 0.1;
  if (value < min + buffer || value > max - buffer) return 'warning';
  return 'good';
}

// ── Telemetry source / sync pill ─────────────────────────────────────────────

export type TelemetrySource = 'controller' | 'manual';

/** Which path wrote a reading: the pool-controller sync job, or a person. */
export function getTelemetrySource(reading: Reading): TelemetrySource {
  return reading.notes && isAutoSyncBoilerplateNote(reading.notes) ? 'controller' : 'manual';
}

export type SyncPillKind = 'live' | 'stale' | 'manual' | 'none';

export interface SyncPillState {
  kind: SyncPillKind;
  /** Short uppercase label, e.g. "LIVE · 2 MIN", "STALE · 42 MIN", "MANUAL · 09:12". */
  label: string;
}

// Two missed 15-min controller polls (see sync.ts / isOrpStale): past this
// the "live" pulse would be a lie, so the pill switches to a stale warning.
export const LIVE_WINDOW_MS = 15 * 60 * 1000;

export function describeSync(latest: Reading | undefined, now: Date = new Date()): SyncPillState {
  if (!latest) return { kind: 'none', label: 'NO DATA' };
  if (getTelemetrySource(latest) === 'manual') {
    return { kind: 'manual', label: `MANUAL · ${latest.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` };
  }
  const ageMs = Math.max(0, now.getTime() - latest.timestamp.getTime());
  const minutes = Math.round(ageMs / 60000);
  const age = minutes < 60 ? `${minutes} MIN` : `${Math.round(minutes / 60)} H`;
  return ageMs <= LIVE_WINDOW_MS
    ? { kind: 'live', label: `LIVE · ${age}` }
    : { kind: 'stale', label: `STALE · ${age}` };
}

// ── Trend glyphs ─────────────────────────────────────────────────────────────

export type TrendGlyph = '↑' | '→' | '↓';

// Smallest change worth calling a move; anything under this is noise from
// test-kit resolution or sensor jitter, not a trend.
const TREND_EPSILON: Partial<Record<NumericReadingField, number>> = {
  ph: 0.05,
  chlorine: 0.1,
  totalChlorine: 0.1,
  sanitisationMv: 5,
  alkalinity: 5,
  calciumHardness: 10,
  cyanuricAcid: 2,
  temperature: 0.5,
  differentialPressure: 2,
};

/**
 * Trend epsilon for a field. A field with no entry logs a warning and falls
 * back to 0, so any change counts as a trend. That is noisier than intended,
 * so the warning points at the table to update.
 */
export function getEpsilonForField(field: NumericReadingField): number {
  const epsilon = TREND_EPSILON[field];
  if (epsilon === undefined) {
    console.warn(`dashboardSummary: no trend epsilon for "${field}"; any change will count as a trend. Add it to TREND_EPSILON.`);
    return 0;
  }
  return epsilon;
}

/**
 * Direction of the latest value versus the previous reading that measured
 * the same field. Expects newest-first order. Returns null when fewer than
 * two measurements exist — a glyph implies a comparison that isn't there.
 */
export function getTrendGlyph(readings: Reading[], field: NumericReadingField): TrendGlyph | null {
  const measured: number[] = [];
  for (const r of readings) {
    const v = r[field];
    if (typeof v === 'number' && Number.isFinite(v)) {
      measured.push(v);
      if (measured.length === 2) break;
    }
  }
  if (measured.length < 2) return null;
  const delta = measured[0] - measured[1];
  const epsilon = getEpsilonForField(field);
  if (delta > epsilon) return '↑';
  if (delta < -epsilon) return '↓';
  return '→';
}

// ── Operations tiles ─────────────────────────────────────────────────────────

export interface TileBadge {
  text: string;
  status: Status | 'neutral';
}

export interface TileSummary {
  sub: string;
  badge: TileBadge;
}

/**
 * Next service due date. The baseline is the last service, or the install
 * date when nothing has been serviced yet (same rule as the MCP server's
 * equipment calculation), so default equipment reports its first service.
 */
export function getNextServiceDate(item: EquipmentItem): Date | null {
  if (!item.serviceIntervalMonths) return null;
  const next = new Date(item.lastServiceDate ?? item.installDate);
  next.setMonth(next.getMonth() + item.serviceIntervalMonths);
  return next;
}

export function summarizeEquipment(equipment: EquipmentItem[], now: Date = new Date()): TileSummary {
  const scheduled = equipment
    .map((item) => ({ item, next: getNextServiceDate(item) }))
    .filter((x): x is { item: EquipmentItem; next: Date } => x.next != null)
    .map(({ item, next }) => ({ item, daysUntil: Math.ceil((next.getTime() - now.getTime()) / DAY_MS) }))
    .sort((a, b) => a.daysUntil - b.daysUntil);

  if (scheduled.length === 0) {
    return { sub: equipment.length === 0 ? 'No equipment registered' : 'No service intervals set', badge: { text: 'OK', status: 'neutral' } };
  }
  const dueCount = scheduled.filter((x) => x.daysUntil <= 0).length;
  const soonest = scheduled[0];
  const sub = soonest.daysUntil < 0
    ? `${soonest.item.name} service overdue by ${-soonest.daysUntil} d`
    : soonest.daysUntil === 0
      ? `${soonest.item.name} service due today`
      : `${soonest.item.name} service due in ${soonest.daysUntil} d`;
  return {
    sub,
    badge: dueCount > 0 ? { text: `${dueCount} DUE`, status: 'warning' } : { text: 'OK', status: 'neutral' },
  };
}

export function getLowInventory(inventory: InventoryItem[]): InventoryItem[] {
  return inventory.filter((item) => item.quantity <= item.minThreshold);
}

export function summarizeInventory(inventory: InventoryItem[]): TileSummary {
  const low = getLowInventory(inventory);
  if (low.length === 0) {
    return {
      sub: inventory.length === 0 ? 'No chemicals tracked yet' : `${inventory.length} item${inventory.length === 1 ? '' : 's'} above reorder level`,
      badge: { text: 'STOCKED', status: 'neutral' },
    };
  }
  const shown = low.slice(0, 2).map((item) => `${item.name} ${item.quantity} ${item.unit}`);
  const more = low.length - shown.length;
  return {
    sub: shown.join(' · ') + (more > 0 ? ` · +${more} more` : ''),
    badge: { text: `${low.length} LOW`, status: 'critical' },
  };
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Monday 00:00 local of the week containing `d`. */
export function startOfIsoWeek(d: Date): Date {
  const day = startOfLocalDay(d);
  const offset = (day.getDay() + 6) % 7; // Mon → 0 … Sun → 6
  day.setDate(day.getDate() - offset);
  return day;
}

/** Fields checked against their working range by isReadingNominal. */
const NOMINAL_FIELDS: readonly NumericReadingField[] = [
  'chlorine', 'totalChlorine', 'sanitisationMv', 'ph', 'alkalinity',
  'temperature', 'differentialPressure', 'calciumHardness', 'cyanuricAcid',
];

/** Every measured field of a reading sits inside its working range. */
export function isReadingNominal(reading: Reading): boolean | null {
  // Free and total chlorine can each sit in range while their difference is
  // not (FC 1.0 / TC 1.8 is 0.8 ppm combined), and total below free is a
  // measurement error. Both count as not nominal, matching the warnings
  // WeeklyReport and the home screen already show.
  if (reading.chlorine != null && reading.totalChlorine != null && reading.totalChlorine < reading.chlorine) {
    return false;
  }
  const combined = combinedChlorineOf(reading.chlorine, reading.totalChlorine);
  if (combined != null && getCombinedChlorineStatus(combined) !== 'good') return false;

  let observed = false;
  for (const field of NOMINAL_FIELDS) {
    const v = reading[field];
    if (v == null) continue;
    observed = true;
    if (field === 'sanitisationMv') {
      if (classifyOrp(v) !== 'good') return false;
      continue;
    }
    const range = DEFAULT_RANGES[field];
    if (v < range.min || v > range.max) return false;
  }
  return observed ? true : null;
}

export interface WeekSummary extends TileSummary {
  daysWithReadings: number;
  daysNominal: number;
}

/**
 * Monday-to-today roll-up for the Weekly Report tile: how many days so far
 * this week had any measurement, and how many of those stayed fully in
 * range. A day with reading documents but no actual measurements is a
 * monitoring gap, not a nominal day (same rule as WeeklyReport's heatmap).
 */
export function summarizeWeek(readings: Reading[], now: Date = new Date()): WeekSummary {
  const weekStart = startOfIsoWeek(now);
  const today = startOfLocalDay(now);
  const dayCount = Math.round((today.getTime() - weekStart.getTime()) / DAY_MS) + 1;
  const rangeLabel = dayCount === 1 ? WEEKDAY[weekStart.getDay()] : `${WEEKDAY[weekStart.getDay()]}–${WEEKDAY[today.getDay()]}`;

  let daysWithReadings = 0;
  let daysNominal = 0;
  for (let i = 0; i < dayCount; i += 1) {
    const dayStart = new Date(weekStart.getTime() + i * DAY_MS);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const dayReadings = readings.filter((r) => r.timestamp >= dayStart && r.timestamp < dayEnd);
    const verdicts = dayReadings.map(isReadingNominal).filter((v): v is boolean => v != null);
    if (verdicts.length === 0) continue;
    daysWithReadings += 1;
    if (verdicts.every(Boolean)) daysNominal += 1;
  }

  if (daysWithReadings === 0) {
    return { daysWithReadings, daysNominal, sub: `${rangeLabel} · no readings logged yet`, badge: { text: 'PENDING', status: 'neutral' } };
  }
  return {
    daysWithReadings,
    daysNominal,
    sub: `${rangeLabel} · ${daysNominal} of ${daysWithReadings} day${daysWithReadings === 1 ? '' : 's'} nominal`,
    badge: { text: 'READY', status: 'good' },
  };
}

const TREND_WINDOW_MS = 7 * DAY_MS;
// Below this, day-to-day pH movement is within test-kit resolution.
const PH_DRIFT_MIN_PER_DAY = 0.03;

/**
 * One-line pH trend for the Trends tile: a least-squares slope (pH units
 * per day) over the last 7 days. Needs at least three points spanning a
 * day — anything less is a comparison, not a trend.
 */
export function describePhDrift(readings: Reading[], now: Date = new Date()): string {
  const cutoff = now.getTime() - TREND_WINDOW_MS;
  const points = readings
    .filter((r) => r.ph != null && Number.isFinite(r.ph) && r.timestamp.getTime() >= cutoff)
    .map((r) => ({ t: r.timestamp.getTime() / DAY_MS, v: r.ph as number }))
    .sort((a, b) => a.t - b.t);
  if (points.length < 3 || points[points.length - 1].t - points[0].t < 1) {
    return 'Open 7-day charts';
  }
  const n = points.length;
  const meanT = points.reduce((s, p) => s + p.t, 0) / n;
  const meanV = points.reduce((s, p) => s + p.v, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.t - meanT) * (p.v - meanV);
    den += (p.t - meanT) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  if (Math.abs(slope) < PH_DRIFT_MIN_PER_DAY) return 'pH steady over 7 d';
  const since = WEEKDAY[new Date(points[0].t * DAY_MS).getDay()];
  const magnitude = Math.abs(slope) >= 0.1 ? Math.abs(slope).toFixed(1) : Math.abs(slope).toFixed(2);
  return `pH drifting ${slope > 0 ? '+' : '−'}${magnitude} / day since ${since}`;
}

// ── Connected agents (MCP) ───────────────────────────────────────────────────

export interface AgentActivity {
  /** MCP-submitted readings logged today (local day). */
  readingsToday: number;
  /** Most recent MCP-submitted reading, if any ever. */
  lastAt: Date | null;
  /** True when an agent wrote within the last 24 h. */
  live: boolean;
  sub: string;
}

const AGENT_LIVE_WINDOW_MS = DAY_MS;

/**
 * Reading.photoUrl is only ever set by the MCP server's
 * poolstatus_log_reading tool (see types.ts), so its presence is the one
 * reliable marker of agent activity the client can see. Tasks an agent
 * adds are stored as ordinary tasks and can't be told apart here.
 */
export function summarizeAgentActivity(readings: Reading[], now: Date = new Date()): AgentActivity {
  const agentReadings = readings.filter((r) => Boolean(r.photoUrl));
  const todayStart = startOfLocalDay(now);
  const readingsToday = agentReadings.filter((r) => r.timestamp >= todayStart).length;
  const lastAt = agentReadings.reduce<Date | null>((latest, r) => (!latest || r.timestamp > latest ? r.timestamp : latest), null);
  const live = lastAt != null && now.getTime() - lastAt.getTime() <= AGENT_LIVE_WINDOW_MS;
  const sub = readingsToday > 0
    ? `Agents logged ${readingsToday} reading${readingsToday === 1 ? '' : 's'} today`
    : lastAt
      ? `Last agent reading ${formatAge(lastAt, now)}`
      : 'No agent activity yet';
  return { readingsToday, lastAt, live, sub };
}

// ── LSI scale ────────────────────────────────────────────────────────────────

/** Marker position (0–100 %) on the −0.5 … +0.5 LSI scale, clamped. */
export function lsiMarkerPercent(lsi: number): number {
  return Math.min(100, Math.max(0, (lsi + 0.5) * 100));
}

/** Headline state word under the LSI value. */
export function getLsiStateWord(lsi: number): string {
  if (Math.abs(lsi) <= 0.1) return 'Balanced';
  return lsi > 0 ? 'Scale Tendency' : 'Corrosive';
}
