import { DEFAULT_RANGES, Reading, Status } from '../types.js';

export type SoftValidationLevel = 'warning' | 'elevated';

export interface SoftValidationWarning {
  field: keyof Pick<Reading, 'chlorine' | 'totalChlorine' | 'ph' | 'alkalinity' | 'temperature' | 'differentialPressure' | 'calciumHardness' | 'cyanuricAcid' | 'sanitisationMv'>;
  message: string;
  level: SoftValidationLevel;
}

export const NUMERIC_READING_FIELDS = [
  'chlorine',
  'totalChlorine',
  'ph',
  'alkalinity',
  'temperature',
  'differentialPressure',
  'calciumHardness',
  'cyanuricAcid',
  'sanitisationMv',
] as const;

export type NumericReadingField = typeof NUMERIC_READING_FIELDS[number];

const HARD_MIN_BY_FIELD: Partial<Record<NumericReadingField, number>> = {
  chlorine: 0,
  totalChlorine: 0,
  ph: 0,
  alkalinity: 0,
  temperature: -50,
  differentialPressure: 0,
  calciumHardness: 0,
  cyanuricAcid: 0,
  sanitisationMv: 0,
};

const HARD_MAX_BY_FIELD: Partial<Record<NumericReadingField, number>> = {
  ph: 14,
  alkalinity: 2000,
  temperature: 100,
  differentialPressure: 10000,
  calciumHardness: 10000,
  cyanuricAcid: 1000,
  sanitisationMv: 1200,
};

export const FIELD_LABEL: Record<NumericReadingField, string> = {
  chlorine: 'Free Chlorine',
  totalChlorine: 'Total Chlorine',
  ph: 'pH',
  alkalinity: 'Alkalinity',
  temperature: 'Temperature',
  differentialPressure: 'Differential Pressure',
  calciumHardness: 'Calcium Hardness',
  cyanuricAcid: 'Cyanuric Acid',
  sanitisationMv: 'ORP',
};

export function getHardValidationError(field: NumericReadingField, value: number): string {
  if (!Number.isFinite(value)) return 'Enter a valid number.';
  const label = FIELD_LABEL[field];
  const min = HARD_MIN_BY_FIELD[field];
  if (typeof min === 'number' && value < min) {
    return min === 0
      ? `${label} cannot be negative.`
      : `${label} must be at least ${min}.`;
  }
  const max = HARD_MAX_BY_FIELD[field];
  if (typeof max === 'number' && value > max) {
    return `${label} cannot exceed ${max}.`;
  }
  return '';
}

/**
 * Rejects only genuinely impossible input — non-finite, or below the
 * field's physical minimum (e.g. a negative concentration) — never an
 * extreme-but-conceivably-real value. AGENTS.md is explicit: "out-of-range
 * values must not prevent submission" and validation should catch
 * "impossible input formats, not real-world abnormal readings." Unlike
 * getHardValidationError above (used by the manual entry form, which also
 * enforces a per-field plausibility ceiling to catch likely typos an
 * operator can immediately notice and correct), this has no upper bound:
 * a value this far outside DEFAULT_RANGES still gets a warning via
 * getSoftWarning, it just isn't blocked from saving. Used by the MCP
 * server's poolstatus_log_reading, where a value came from an AI's photo
 * transcription rather than a human typing directly into a form.
 *
 * sanitisationMv (ORP) has no minimum at all, unlike every other field
 * here: it's a signed electrode potential, not a concentration, so a
 * negative reading is abnormal but physically real — and AGENTS.md calls
 * out ORP specifically: "Never block saving low or high ORP values. These
 * values are essential for incident reports."
 *
 * pH has no minimum here either: the pH scale itself goes negative in
 * strongly acidic solutions (e.g. an acid-spill incident), so unlike a
 * concentration or a count, a negative pH is abnormal-but-real rather than
 * impossible — AGENTS.md's "out-of-range values must not prevent
 * submission" applies. getHardValidationError (the manual entry form)
 * intentionally keeps rejecting it there, since a human typing a negative
 * pH is almost always a typo they can immediately notice and correct.
 */
export function getImpossibleValueError(field: NumericReadingField, value: number): string {
  if (!Number.isFinite(value)) return 'Enter a valid number.';
  if (field === 'sanitisationMv' || field === 'ph') return '';
  const label = FIELD_LABEL[field];
  const min = HARD_MIN_BY_FIELD[field];
  if (typeof min === 'number' && value < min) {
    return min === 0
      ? `${label} cannot be negative.`
      : `${label} must be at least ${min}.`;
  }
  return '';
}

// Combined chlorine (chloramines) = total − free. It isn't a stored field,
// so it has no DEFAULT_RANGES entry: under 0.5 ppm is the usual commercial
// target, and above 1 ppm is where bathers notice it (the "chlorine smell"
// is actually chloramines) and a shock/superchlorination is due.
export const COMBINED_CHLORINE_OK_MAX = 0.5;
export const COMBINED_CHLORINE_MAX = 1;

// Rounded to 0.01 so binary float noise (1.6 − 1.1 = 0.5000000000000001)
// can't tip a value over a threshold it visibly sits on.
export const combinedChlorineOf = (free: number | null | undefined, total: number | null | undefined): number | null =>
  free == null || total == null ? null : Math.max(0, Math.round((total - free) * 100) / 100);

export const getCombinedChlorineStatus = (value: number): Status =>
  value > COMBINED_CHLORINE_MAX ? 'critical' : value > COMBINED_CHLORINE_OK_MAX ? 'warning' : 'good';

/**
 * Cross-field check for free vs total chlorine. Each value can sit inside its
 * own range while their difference is still a problem (FC 1 / TC 3 is 2 ppm
 * combined), and total below free is a measurement error. Non-blocking, like
 * every other soft warning — the reading still saves.
 */
export function getCombinedChlorineWarning(free: number | null | undefined, total: number | null | undefined): SoftValidationWarning | null {
  if (free == null || total == null || !Number.isFinite(free) || !Number.isFinite(total)) return null;
  const field = 'totalChlorine';
  if (total < free) {
    return { field, level: 'warning', message: 'Total chlorine is below free chlorine — it can\'t be. Re-test both.' };
  }
  const combined = combinedChlorineOf(free, total) as number;
  if (combined > COMBINED_CHLORINE_MAX) {
    return { field, level: 'warning', message: `Combined chlorine ${combined.toFixed(1)} ppm (>${COMBINED_CHLORINE_MAX}) — chloramines high. Shock and retest before swimming.` };
  }
  if (combined > COMBINED_CHLORINE_OK_MAX) {
    return { field, level: 'elevated', message: `Combined chlorine ${combined.toFixed(1)} ppm — ideal is under ${COMBINED_CHLORINE_OK_MAX}. Watch it on the next test.` };
  }
  return null;
}

// The one ORP threshold that isn't already DEFAULT_RANGES.sanitisationMv's
// min (650) or max (750) -- exported so callers needing this getSoftWarning
// "truly high, not just elevated" boundary (e.g. classifyOrp's status
// badge) don't re-derive it as a separate literal.
export const ORP_HIGH_WARNING_MV = 850;

// AGENTS.md's own literal instruction: "Above 800 mV: warn that
// sanitisation may be high; verify before swimming or adding more
// chlorine." That's a lower, stricter line than ORP_HIGH_WARNING_MV above
// -- getSoftWarning's 750-850 mV "elevated, usually acceptable" band is this
// module's own interpretive gap-filling for a range AGENTS.md leaves silent,
// but AGENTS.md's explicit verify-before-swimming instruction still applies
// to the whole 800+ mV range, not just its top end. Dashboard's orp_high
// alert and WeeklyReport's weekly ORP-high advisory both key off this
// constant rather than ORP_HIGH_WARNING_MV, so the loud "verify before
// swimming" action banner each surfaces stays anchored to AGENTS.md's own
// number.
export const ORP_ACTION_ALERT_MV = 800;

export function getSoftWarning(field: NumericReadingField, value: number): SoftValidationWarning | null {
  if (!Number.isFinite(value)) return null;
  if (field === 'sanitisationMv') {
    const { min, max } = DEFAULT_RANGES.sanitisationMv;
    if (value < min) return { field, level: 'warning', message: `Sanitisation may be too low (<${min} mV).` };
    if (value > ORP_HIGH_WARNING_MV) return { field, level: 'warning', message: `Sanitisation may be too high (>${ORP_HIGH_WARNING_MV} mV).` };
    if (value >= max) return { field, level: 'elevated', message: `High ORP (${max}–${ORP_HIGH_WARNING_MV} mV), usually acceptable depending on context.` };
    return null;
  }

  const range = DEFAULT_RANGES[field as keyof typeof DEFAULT_RANGES];
  if (!range) return null;
  if (value < range.min || value > range.max) {
    return {
      field,
      level: 'warning',
      message: 'This value is outside the normal operating range. Please double-check it, but you can still save the reading.',
    };
  }
  return null;
}
