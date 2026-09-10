import { DEFAULT_RANGES, Reading, Status } from '../types';

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

export function getSoftWarning(field: NumericReadingField, value: number): SoftValidationWarning | null {
  if (!Number.isFinite(value)) return null;
  if (field === 'sanitisationMv') {
    if (value < 650) return { field, level: 'warning', message: 'Sanitisation may be too low (<650 mV).' };
    if (value > 850) return { field, level: 'warning', message: 'Sanitisation may be too high (>850 mV).' };
    if (value >= 750) return { field, level: 'elevated', message: 'High ORP (750–850 mV), usually acceptable depending on context.' };
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
