import type { ControllerLogWindow } from '../types.js';
import { findGaps, sortWindows } from './controllerLog.js';

type Metric = 'phMin' | 'phMax' | 'orpMinMv' | 'orpMaxMv' | 'temperatureMinC' | 'temperatureMaxC';
const MEASURES: Metric[] = ['phMin', 'phMax', 'orpMinMv', 'orpMaxMv', 'temperatureMinC', 'temperatureMaxC'];
const observed = (w: ControllerLogWindow) => MEASURES.some((key) => w[key] != null);
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Aggregate every selected log window locally before sharing a deliberately
 * bounded, numerical evidence packet with AI. Missing values remain missing.
 * Dosing "max" columns are per-window readings, NOT totals.
 */
export function controllerAnalysisEvidence(windows: ControllerLogWindow[]) {
  const ordered = sortWindows(windows);
  if (!ordered.length) return null;
  const values = (key: Metric) => ordered.flatMap((w) => w[key] == null ? [] : [w[key] as number]);
  const stats = (key: Metric) => {
    const v = values(key);
    return v.length ? { count: v.length, min: Math.min(...v), max: Math.max(...v), mean: round(v.reduce((a, b) => a + b, 0) / v.length) } : null;
  };
  const samples = ordered.filter(observed);
  const unusual = samples.filter((w) =>
    (w.phMin != null && w.phMin < 7.2) || (w.phMax != null && w.phMax > 7.8) ||
    (w.orpMinMv != null && w.orpMinMv < 650) || (w.orpMaxMv != null && w.orpMaxMv > 800) ||
    (w.temperatureMaxC != null && w.temperatureMaxC > 32));
  const highTemp = [...samples].filter((w) => w.temperatureMaxC != null)
    .sort((a, b) => (b.temperatureMaxC ?? -Infinity) - (a.temperatureMaxC ?? -Infinity)).slice(0, 6);
  const doseEvents = ordered.filter((w) => (w.acidBaseMaxMl ?? 0) > 0 || (w.chlorineMaxMl ?? 0) > 0);
  const distinct = new Map<string, ControllerLogWindow>();
  for (const w of [...unusual.slice(0, 18), ...unusual.slice(-18), ...highTemp, ...doseEvents.slice(-12), ...samples.slice(-8)]) {
    distinct.set(w.id, w);
  }
  const compact = (w: ControllerLogWindow) => ({
    at: w.startLocal,
    ph: [w.phMin, w.phMax], orpMv: [w.orpMinMv, w.orpMaxMv],
    tempC: [w.temperatureMinC, w.temperatureMaxC],
    acidBaseReportedMl: [w.acidBaseMinMl, w.acidBaseMaxMl],
    chlorineReportedMl: [w.chlorineMinMl, w.chlorineMaxMl],
  });
  const gapList = findGaps(ordered);
  return {
    kind: 'historical-hanna-controller-windows',
    windows: ordered.length, measuredWindows: samples.length,
    coverage: { from: ordered[0].startLocal, to: ordered[ordered.length - 1].endLocal },
    device: ordered[0].deviceId,
    metrics: Object.fromEntries(MEASURES.map((k) => [k, stats(k)])),
    phWindowsBelow72: ordered.filter((w) => w.phMin != null && w.phMin < 7.2).length,
    phWindowsAbove78: ordered.filter((w) => w.phMax != null && w.phMax > 7.8).length,
    orpWindowsBelow650: ordered.filter((w) => w.orpMinMv != null && w.orpMinMv < 650).length,
    orpWindowsAbove800: ordered.filter((w) => w.orpMaxMv != null && w.orpMaxMv > 800).length,
    hotWindowsAbove32: ordered.filter((w) => w.temperatureMaxC != null && w.temperatureMaxC > 32).length,
    doseEventWindows: doseEvents.length,
    gapCount: gapList.length,
    largestGapsHours: gapList.map((g) => round((g.to.getTime() - g.from.getTime()) / 3_600_000)).sort((a, b) => b - a).slice(0, 5),
    // Include a bounded cross-section, but explicitly acknowledge this is a sample.
    sampleWindows: [...distinct.values()].slice(0, 70).map(compact),
    includedSamples: Math.min(distinct.size, 70),
    samplesAreSubset: distinct.size < ordered.length || ordered.length > 70,
  };
}
