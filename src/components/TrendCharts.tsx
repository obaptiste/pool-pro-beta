import React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format } from 'date-fns';
import { ArrowRight, Check, RefreshCcw, ShieldCheck, X } from 'lucide-react';
import { Reading, DEFAULT_RANGES } from '../types';
import { buildTrendPoints, filterReadingsFrom, TrendMetricKey } from '../lib/trends';

interface Props {
  readings: Reading[];
  userId: string;
  onLogReading: () => void;
}

const METRICS: { key: TrendMetricKey; title: string; color: string; unit: string }[] = [
  { key: 'chlorine', title: 'Free Chlorine', color: '#4fc3f7', unit: 'ppm' },
  { key: 'sanitisationMv', title: 'Sanitisation / ORP', color: '#60a5fa', unit: 'mV' },
  { key: 'ph', title: 'pH Level', color: '#10b981', unit: '' },
  { key: 'alkalinity', title: 'Total Alkalinity', color: '#f59e0b', unit: 'ppm' },
  { key: 'temperature', title: 'Temperature', color: '#ef4444', unit: '°C' },
  { key: 'differentialPressure', title: 'Differential Pressure', color: '#8ab4cc', unit: 'kPa' },
  { key: 'calciumHardness', title: 'Calcium Hardness', color: '#22d3ee', unit: 'ppm' },
  { key: 'cyanuricAcid', title: 'Cyanuric Acid', color: '#facc15', unit: 'ppm' },
];

const parseStoredDate = (value: string | null): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export default function TrendCharts({ readings, userId, onLogReading }: Props) {
  const storageKey = `poolpro:trend-start:${userId}`;
  const [resetAt, setResetAt] = React.useState<Date | null>(() => parseStoredDate(localStorage.getItem(storageKey)));
  const [showResetConfirm, setShowResetConfirm] = React.useState(false);
  const currentReadings = filterReadingsFrom(readings, resetAt);

  const resetTrend = () => {
    const now = new Date();
    localStorage.setItem(storageKey, now.toISOString());
    setResetAt(now);
    setShowResetConfirm(false);
    onLogReading();
  };

  return (
    <div className="space-y-5">
      <section className="card bg-[#0a1628] border-accent/20 p-5 md:p-6" aria-labelledby="trend-heading">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-accent">
              <ShieldCheck size={16} aria-hidden="true" />
              <p className="text-[9px] font-bold uppercase tracking-[0.22em]">Target-guided trends</p>
            </div>
            <h2 id="trend-heading" className="text-xl font-bold text-white">Your water, compared with the optimal zone</h2>
            <p className="max-w-2xl text-xs leading-relaxed text-ink-muted">
              The shaded band is the configured working range, the dotted line is its midpoint, and the solid line is your recorded result. Targets are guides—follow product labels and site guidance.
            </p>
          </div>
          <button type="button" onClick={() => setShowResetConfirm(true)} className="btn btn-secondary min-h-12 shrink-0" aria-haspopup="dialog">
            <RefreshCcw size={15} aria-hidden="true" />
            Start a new trend
          </button>
        </div>
        {resetAt && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-success" role="status">
            <Check size={14} aria-hidden="true" />
            Current trend started {format(resetAt, 'MMM d, yyyy · HH:mm')}. Older readings remain in History.
          </div>
        )}
      </section>

      {showResetConfirm && (
        <section className="card border-warning/30 bg-warning/5 p-5" role="dialog" aria-modal="true" aria-labelledby="reset-trend-title">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <h3 id="reset-trend-title" className="font-bold text-white">Start the trend again?</h3>
              <p className="max-w-2xl text-xs leading-relaxed text-ink-muted">
                Charts will start fresh from your next reading. Nothing is deleted—every earlier reading stays available in History and exports.
              </p>
            </div>
            <button type="button" onClick={() => setShowResetConfirm(false)} className="icon-btn" aria-label="Cancel trend reset"><X size={16} /></button>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setShowResetConfirm(false)} className="btn btn-secondary min-h-11">Keep current trend</button>
            <button type="button" onClick={resetTrend} className="btn btn-primary min-h-11">
              Reset &amp; add reading <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        </section>
      )}

      {currentReadings.length === 0 && (
        <div className="rounded-xl border border-dashed border-accent/30 bg-accent/5 px-5 py-4 text-center" role="status">
          <p className="text-xs font-bold text-white">Your optimal guides are ready.</p>
          <p className="mt-1 text-[10px] uppercase tracking-wider text-ink-dim">Add a reading to draw your actual results over them.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {METRICS.map((metric) => (
          <ChartSection
            key={metric.key}
            title={metric.title}
            data={buildTrendPoints(currentReadings, metric.key, (date) => format(date, 'MMM d, HH:mm'))}
            color={metric.color}
            unit={metric.unit}
            range={DEFAULT_RANGES[metric.key]}
          />
        ))}
      </div>
    </div>
  );
}

function ChartSection({ title, data, color, unit, range }: {
  title: string;
  data: ReturnType<typeof buildTrendPoints>;
  color: string;
  unit: string;
  range: { min: number; max: number };
}) {
  const gradientId = `gradient-${title.replace(/\s+/g, '-')}`;
  const hasActual = data.some((point) => point.actual != null);
  return (
    <section className="card bg-[#0d1f38] border-border-dim space-y-4 p-5" aria-label={`${title} trend chart`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-white">{title}</h3>
          <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-ink-dim">Optimal {range.min}–{range.max} {unit}</p>
        </div>
        <div className="flex items-center gap-4 text-[9px] font-bold uppercase tracking-wider text-ink-muted" aria-label="Chart legend">
          <span className="flex items-center gap-1.5"><i className="h-2 w-4 rounded-sm bg-success/20 ring-1 ring-success/50" /> Optimal zone</span>
          <span className="flex items-center gap-1.5"><i className="h-0.5 w-4" style={{ backgroundColor: color }} /> Actual</span>
        </div>
      </div>
      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.35} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e3a5f" opacity={0.55} />
            <XAxis dataKey="formattedDate" tick={{ fill: '#4a6a80', fontSize: 8 }} axisLine={false} tickLine={false} minTickGap={32} />
            <YAxis fontSize={9} tick={{ fill: '#4a6a80', fontWeight: 'bold' }} axisLine={false} tickLine={false} domain={['auto', 'auto']} tickFormatter={(value) => `${value}${unit}`} />
            <ReferenceArea y1={range.min} y2={range.max} fill="#10b981" fillOpacity={0.1} stroke="#10b981" strokeOpacity={0.28} />
            <Tooltip
              contentStyle={{ backgroundColor: '#060e1a', borderRadius: '8px', border: '1px solid #1e3a5f', fontSize: '10px', fontFamily: 'Space Mono, monospace', color: '#fff' }}
              labelStyle={{ fontWeight: 'bold', marginBottom: '4px', color: '#8ab4cc' }}
              formatter={(value: number, name: string) => [`${value}${unit}`, name === 'actual' ? 'Actual reading' : 'Optimal midpoint']}
            />
            <Line type="monotone" dataKey="optimal" stroke="#10b981" strokeWidth={1.5} strokeDasharray="5 5" dot={false} isAnimationActive animationDuration={900} />
            {hasActual && (
              <Area type="monotone" dataKey="actual" stroke={color} strokeWidth={2.5} fill={`url(#${gradientId})`} dot={{ r: 3, fill: color, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 0, fill: '#fff' }} connectNulls animationDuration={1400} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
