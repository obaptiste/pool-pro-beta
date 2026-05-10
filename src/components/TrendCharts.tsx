import React from 'react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';
import { format } from 'date-fns';
import { Reading, DEFAULT_RANGES } from '../types';

interface Props {
  readings: Reading[];
}

type MetricKey = 'chlorine' | 'ph' | 'alkalinity' | 'temperature' | 'differentialPressure' | 'calciumHardness' | 'cyanuricAcid';

const METRICS: { key: MetricKey; title: string; color: string; unit: string }[] = [
  { key: 'chlorine', title: 'Free Chlorine', color: '#4fc3f7', unit: 'ppm' },
  { key: 'ph', title: 'pH Level', color: '#10b981', unit: '' },
  { key: 'alkalinity', title: 'Total Alkalinity', color: '#f59e0b', unit: 'ppm' },
  { key: 'temperature', title: 'Temperature', color: '#ef4444', unit: '°C' },
  { key: 'differentialPressure', title: 'Differential Pressure', color: '#8ab4cc', unit: 'kPa' },
  { key: 'calciumHardness', title: 'Calcium Hardness', color: '#22d3ee', unit: 'ppm' },
  { key: 'cyanuricAcid', title: 'Cyanuric Acid', color: '#facc15', unit: 'ppm' },
];

const MIN_POINTS_PER_METRIC = 2;

export default function TrendCharts({ readings }: Props) {
  const sorted = [...readings].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const seriesByMetric = METRICS.map((metric) => {
    const points = sorted
      .filter((r) => typeof r[metric.key] === 'number' && !isNaN(r[metric.key] as number))
      .map((r) => ({
        value: r[metric.key] as number,
        formattedDate: format(r.timestamp, 'MMM d, HH:mm'),
      }));
    return { ...metric, points };
  });

  const renderableMetrics = seriesByMetric.filter((m) => m.points.length >= MIN_POINTS_PER_METRIC);

  if (renderableMetrics.length === 0) {
    const readingsWithAnyMeasurement = readings.filter((r) =>
      METRICS.some((m) => typeof r[m.key] === 'number' && !isNaN(r[m.key] as number))
    ).length;
    const remaining = Math.max(0, MIN_POINTS_PER_METRIC - readingsWithAnyMeasurement);
    return (
      <div className="card bg-[#0a1628] border-border-dim p-12 text-center space-y-4">
        <div className="text-4xl opacity-20">⬡</div>
        <div className="space-y-1">
          <p className="text-sm font-bold uppercase tracking-widest text-ink-muted">Insufficient Data</p>
          <p className="text-[10px] text-ink-dim uppercase tracking-widest">
            {remaining > 0
              ? `Log ${remaining} more reading${remaining === 1 ? '' : 's'} with measurements to generate patterns.`
              : 'Log additional readings that measure the same metric to generate patterns.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {renderableMetrics.map((metric) => (
        <ChartSection
          key={metric.key}
          title={metric.title}
          data={metric.points}
          color={metric.color}
          unit={metric.unit}
          range={DEFAULT_RANGES[metric.key]}
        />
      ))}
    </div>
  );
}

function ChartSection({ title, data, color, unit, range }: {
  title: string;
  data: { value: number; formattedDate: string }[];
  color: string;
  unit: string;
  range: { min: number; max: number };
}) {
  const dataKey = 'value';
  const gradientId = `gradient-${title.replace(/\s+/g, '-')}`;
  return (
    <div className="card bg-[#0d1f38] border-border-dim space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">{title}</h3>
        <div className="flex items-center gap-3">
          <span className="text-[9px] font-bold uppercase tracking-widest text-ink-dim">Target: {range.min}-{range.max} {unit}</span>
          <span className="text-[9px] font-bold uppercase tracking-widest text-ink-dim">{data.length} pts</span>
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        </div>
      </div>
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.3}/>
                <stop offset="95%" stopColor={color} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e3a5f" opacity={0.5} />
            <XAxis
              dataKey="formattedDate"
              hide
            />
            <YAxis
              fontSize={9}
              tick={{ fill: '#4a6a80', fontWeight: 'bold' }}
              axisLine={false}
              tickLine={false}
              domain={['auto', 'auto']}
              tickFormatter={(val) => `${val}${unit}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#060e1a',
                borderRadius: '8px',
                border: '1px solid #1e3a5f',
                boxShadow: '0 10px 20px rgba(0,0,0,0.4)',
                fontSize: '10px',
                fontFamily: 'Space Mono, monospace',
                color: '#fff'
              }}
              itemStyle={{ color: color }}
              labelStyle={{ fontWeight: 'bold', marginBottom: '4px', color: '#8ab4cc' }}
              formatter={(value: number) => [`${value}${unit}`, title]}
            />
            <ReferenceLine y={range.min} stroke="#1e3a5f" strokeDasharray="5 5" />
            <ReferenceLine y={range.max} stroke="#1e3a5f" strokeDasharray="5 5" />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              fillOpacity={1}
              fill={`url(#${gradientId})`}
              dot={{ r: 3, fill: color, strokeWidth: 0 }}
              activeDot={{ r: 5, strokeWidth: 0, fill: '#fff' }}
              animationDuration={1500}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
