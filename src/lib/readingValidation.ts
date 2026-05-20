import { DEFAULT_RANGES, Reading } from '../types';

export type SoftValidationLevel = 'warning' | 'elevated';

export interface SoftValidationWarning {
  field: keyof Pick<Reading, 'chlorine' | 'ph' | 'alkalinity' | 'temperature' | 'differentialPressure' | 'calciumHardness' | 'cyanuricAcid' | 'sanitisationMv'>;
  message: string;
  level: SoftValidationLevel;
}

export const NUMERIC_READING_FIELDS = [
  'chlorine',
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
  ph: 0,
  alkalinity: 0,
  temperature: -50,
  differentialPressure: 0,
  calciumHardness: 0,
  cyanuricAcid: 0,
  sanitisationMv: 0,
};

export function getHardValidationError(field: NumericReadingField, value: number): string {
  if (!Number.isFinite(value)) return 'Enter a valid number.';
  const min = HARD_MIN_BY_FIELD[field];
  if (typeof min === 'number' && value < min) {
    return `${field === 'ph' ? 'pH' : 'Value'} cannot be negative.`;
  }
  return '';
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
