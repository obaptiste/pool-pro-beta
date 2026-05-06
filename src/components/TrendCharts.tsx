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

export default function TrendCharts({ readings }: Props) {
  // Preserve nulls so Recharts renders gaps for unmeasured fields rather than plotting fake zeros.
  const num = (v: number | null) => (typeof v === 'number' && !isNaN(v) ? v : null);
  const chartData = [...readings]
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .map(r => ({
      ...r,
      chlorine: num(r.chlorine),
      ph: num(r.ph),
      alkalinity: num(r.alkalinity),
      temperature: num(r.temperature),
      differentialPressure: num(r.differentialPressure),
      calciumHardness: num(r.calciumHardness),
      cyanuricAcid: num(r.cyanuricAcid),
      formattedDate: format(r.timestamp, 'MMM d, HH:mm'),
    }));

  if (readings.length < 2) {
    return (
      <div className="card bg-[#0a1628] border-border-dim p-12 text-center space-y-4">
        <div className="text-4xl opacity-20">⬡</div>
        <div className="space-y-1">
          <p className="text-sm font-bold uppercase tracking-widest text-ink-muted">Insufficient Data</p>
          <p className="text-[10px] text-ink-dim uppercase tracking-widest">Log at least 2 readings to generate patterns.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ChartSection 
        title="Free Chlorine" 
        data={chartData} 
        dataKey="chlorine" 
        color="#4fc3f7" 
        unit="ppm"
        range={DEFAULT_RANGES.chlorine}
      />
      <ChartSection 
        title="pH Level" 
        data={chartData} 
        dataKey="ph" 
        color="#10b981" 
        unit=""
        range={DEFAULT_RANGES.ph}
      />
      <ChartSection 
        title="Total Alkalinity" 
        data={chartData} 
        dataKey="alkalinity" 
        color="#f59e0b" 
        unit="ppm"
        range={DEFAULT_RANGES.alkalinity}
      />
      <ChartSection 
        title="Temperature" 
        data={chartData} 
        dataKey="temperature" 
        color="#ef4444" 
        unit="°C"
        range={DEFAULT_RANGES.temperature}
      />
      <ChartSection 
        title="Differential Pressure" 
        data={chartData} 
        dataKey="differentialPressure" 
        color="#8ab4cc" 
        unit="kPa"
        range={DEFAULT_RANGES.differentialPressure}
      />
      <ChartSection 
        title="Calcium Hardness" 
        data={chartData} 
        dataKey="calciumHardness" 
        color="#22d3ee" 
        unit="ppm"
        range={DEFAULT_RANGES.calciumHardness}
      />
      <ChartSection 
        title="Cyanuric Acid" 
        data={chartData} 
        dataKey="cyanuricAcid" 
        color="#facc15" 
        unit="ppm"
        range={DEFAULT_RANGES.cyanuricAcid}
      />
    </div>
  );
}

function ChartSection({ title, data, dataKey, color, unit, range }: any) {
  return (
    <div className="card bg-[#0d1f38] border-border-dim space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">{title}</h3>
        <div className="flex items-center gap-3">
          <span className="text-[9px] font-bold uppercase tracking-widest text-ink-dim">Target: {range.min}-{range.max} {unit}</span>
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        </div>
      </div>
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
            <defs>
              <linearGradient id={`gradient-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
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
            />
            <ReferenceLine y={range.min} stroke="#1e3a5f" strokeDasharray="5 5" />
            <ReferenceLine y={range.max} stroke="#1e3a5f" strokeDasharray="5 5" />
            <Area 
              type="monotone" 
              dataKey={dataKey} 
              stroke={color} 
              strokeWidth={2} 
              fillOpacity={1} 
              fill={`url(#gradient-${dataKey})`}
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
