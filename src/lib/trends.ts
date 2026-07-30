import { DEFAULT_RANGES, Reading, Ranges } from '../types';

export type TrendMetricKey = keyof Ranges;

export interface TrendPoint {
  timestamp: number;
  formattedDate: string;
  actual: number | null;
  optimal: number;
  optimalMin: number;
  optimalMax: number;
}

export const getOptimalValue = (metric: TrendMetricKey): number => {
  const range = DEFAULT_RANGES[metric];
  return (range.min + range.max) / 2;
};

export const filterReadingsFrom = (readings: Reading[], resetAt: Date | null): Reading[] => {
  if (!resetAt) return readings;
  return readings.filter((reading) => reading.timestamp.getTime() >= resetAt.getTime());
};

export const buildTrendPoints = (
  readings: Reading[],
  metric: TrendMetricKey,
  formatDate: (date: Date) => string,
  now = new Date(),
): TrendPoint[] => {
  const range = DEFAULT_RANGES[metric];
  const actualPoints = [...readings]
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .filter((reading) => typeof reading[metric] === 'number' && Number.isFinite(reading[metric]))
    .map((reading) => ({
      timestamp: reading.timestamp.getTime(),
      formattedDate: formatDate(reading.timestamp),
      actual: reading[metric] as number,
      optimal: getOptimalValue(metric),
      optimalMin: range.min,
      optimalMax: range.max,
    }));

  if (actualPoints.length > 0) return actualPoints;

  const nextTest = new Date(now);
  nextTest.setDate(nextTest.getDate() + 7);
  return [now, nextTest].map((date) => ({
    timestamp: date.getTime(),
    formattedDate: formatDate(date),
    actual: null,
    optimal: getOptimalValue(metric),
    optimalMin: range.min,
    optimalMax: range.max,
  }));
};
