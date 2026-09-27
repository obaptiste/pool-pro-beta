import { Reading, Status } from '../types';

export function calculateLSI(reading: Reading): number | null {
  // LSI requires pH, temperature, calcium hardness, and alkalinity. If any are
  // missing (not measured), return null rather than fabricating a value.
  if (
    reading.ph == null ||
    reading.temperature == null ||
    reading.calciumHardness == null ||
    reading.alkalinity == null
  ) {
    return null;
  }

  const getTF = (temp: number) => {
    if (temp < 0) return 0;
    if (temp < 10) return 0.3;
    if (temp < 15) return 0.4;
    if (temp < 20) return 0.5;
    if (temp < 25) return 0.6;
    if (temp < 30) return 0.7;
    if (temp < 35) return 0.8;
    return 0.9;
  };

  const getCF = (ch: number) => {
    if (ch < 50) return 1.3;
    if (ch < 100) return 1.6;
    if (ch < 150) return 1.8;
    if (ch < 200) return 1.9;
    if (ch < 250) return 2.0;
    if (ch < 300) return 2.1;
    if (ch < 400) return 2.2;
    if (ch < 500) return 2.3;
    return 2.4;
  };

  const getAF = (alk: number) => {
    if (alk < 50) return 1.7;
    if (alk < 100) return 2.0;
    if (alk < 150) return 2.2;
    if (alk < 200) return 2.3;
    if (alk < 300) return 2.5;
    return 2.6;
  };

  const lsi =
    reading.ph +
    getTF(reading.temperature) +
    getCF(reading.calciumHardness) +
    getAF(reading.alkalinity) -
    12.1;
  return parseFloat(lsi.toFixed(2));
}

/**
 * Single source of truth for LSI severity -- Dashboard's status card,
 * WeeklyReport's per-day/per-period classification, and the MCP server's
 * fieldStatus/trend status each independently reimplemented this exact
 * ±0.1/±0.3 threshold check, and (unlike the ORP case this mirrors) all
 * three happened to already agree on the numbers. Centralized here so a
 * future change to one can't silently drift out of sync with the others.
 */
export function getLsiStatus(lsi: number): Status {
  const abs = Math.abs(lsi);
  if (abs > 0.3) return 'critical';
  if (abs > 0.1) return 'warning';
  return 'good';
}

export type LsiLabel = 'corrosive' | 'scale-forming' | 'drifting' | 'balanced';

/**
 * Single source of truth for describing an LSI value in words, at the same
 * ±0.1/±0.3 thresholds as getLsiStatus. Both Dashboard's status card and
 * the MCP server's derived.lsiLabel used to hardcode a 2-tier
 * corrosive/scale-forming/balanced label with no case for the 0.1-0.3
 * "drifting" band at all -- so a reading getLsiStatus already called
 * 'warning' would show that badge/status right next to text calling the
 * same value "balanced", flatly contradicting its own severity indicator.
 * WeeklyReport's LSI gauge already had this exact 4-tier scheme
 * (corrosive/scale-forming/drifting/balanced) independently correct; this
 * extracts it as the shared version instead of leaving it a third copy.
 */
export function getLsiLabel(lsi: number): LsiLabel {
  if (lsi < -0.3) return 'corrosive';
  if (lsi > 0.3) return 'scale-forming';
  if (Math.abs(lsi) > 0.1) return 'drifting';
  return 'balanced';
}

const LSI_LABEL_DISPLAY: Record<LsiLabel, string> = {
  corrosive: 'Corrosive',
  'scale-forming': 'Scale Forming',
  drifting: 'Drifting',
  balanced: 'Balanced',
};

/**
 * Capitalized, human-facing form of getLsiLabel -- for the two UI surfaces
 * (Dashboard's status card, WeeklyReport's LSI gauge) that show this as a
 * standalone label rather than embedding it lowercase in a sentence the way
 * the MCP server's text output does (getLsiLabel itself, used there
 * directly).
 */
export function getLsiDisplayLabel(lsi: number): string {
  return LSI_LABEL_DISPLAY[getLsiLabel(lsi)];
}
