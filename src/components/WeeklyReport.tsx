import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Printer, FileText } from 'lucide-react';
import type { User } from 'firebase/auth';
import { Reading, InventoryItem, DEFAULT_RANGES } from '../types';
import { calculateLSI } from '../lib/lsi';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TelemetryMetric {
  key: string;
  label: string;
  unit: string;
  avg: number;
  min: number;
  max: number;
  target: [number, number];
  status: 'good' | 'watch' | 'warning' | 'critical' | 'unknown';
}

interface DayStatus {
  date: string;
  status: 'good' | 'watch' | 'warning' | 'critical' | 'unknown';
  note: string;
}

interface TrendPoint {
  d: string;
  chlorine: number;
  ph: number;
  alk: number;
  press: number;
}

interface Advisory {
  tier: 'good' | 'watch' | 'warning' | 'critical';
  title: string;
  time: string;
  msg: string;
  action: string;
}

interface NextStep {
  id: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  due: string;
}

interface InventoryBurnItem {
  name: string;
  unit: string;
  current: number;
  start: number;
  burn: number;
  weeks: number;
  action: 'REORDER' | 'OK';
}

interface RequiredItem {
  type: 'chemical' | 'service' | 'consumable';
  name: string;
  reason: string;
  urgency: 'high' | 'medium' | 'low';
}

interface ReportData {
  facility: {
    name: string;
    pool: string;
    operator: string;
    location: string;
    period: string;
    generatedAt: string;
    reportId: string;
  };
  status: {
    overall: 'good' | 'watch' | 'warning' | 'critical';
    headline: string;
    lsi: number;
    lsiLabel: string;
    uptime: number;
    readings: number;
    swimmerHours: number;
  };
  telemetry: TelemetryMetric[];
  days: DayStatus[];
  trend: TrendPoint[];
  advisories: Advisory[];
  nextSteps: NextStep[];
  inventory: InventoryBurnItem[];
  required: RequiredItem[];
  endOfShiftPhoto: {
    url: null;
    timestamp: string;
    operator: string;
    gauges: { pressure: string; chlorine: string; ph: string };
  };
}

// ── Shared constants ──────────────────────────────────────────────────────────

const TIER = {
  good:     { label: 'OK',       fg: '#10B981', bg: 'rgba(16,185,129,.12)',  bd: 'rgba(16,185,129,.4)' },
  watch:    { label: 'Watch',    fg: '#F59E0B', bg: 'rgba(245,158,11,.14)',  bd: 'rgba(245,158,11,.4)' },
  warning:  { label: 'Action',   fg: '#FB923C', bg: 'rgba(251,146,60,.14)',  bd: 'rgba(251,146,60,.45)' },
  critical: { label: 'Critical', fg: '#EF4444', bg: 'rgba(239,68,68,.14)',   bd: 'rgba(239,68,68,.5)' },
};

const PRIO = {
  high:   { fg: '#EF4444', bg: 'rgba(239,68,68,.1)',   bd: 'rgba(239,68,68,.3)' },
  medium: { fg: '#F59E0B', bg: 'rgba(245,158,11,.1)',  bd: 'rgba(245,158,11,.3)' },
  low:    { fg: '#4FC3F7', bg: 'rgba(79,195,247,.08)', bd: 'rgba(79,195,247,.25)' },
};

// ── Data derivation ───────────────────────────────────────────────────────────

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtTrendLabel(d: Date) {
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${String(d.getHours()).padStart(2, '0')}`;
}

function isoWeek(d: Date): number {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function deriveReportData(readings: Reading[], inventory: InventoryItem[], user: User | null): ReportData {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 7);

  const weekReadings = readings
    .filter(r => r.timestamp >= cutoff)
    .slice()
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const METRICS = [
    { key: 'chlorine', label: 'Free Chlorine',    unit: 'ppm', target: [DEFAULT_RANGES.chlorine.min,             DEFAULT_RANGES.chlorine.max]             as [number, number], get: (r: Reading) => r.chlorine },
    { key: 'ph',       label: 'pH Level',          unit: '',    target: [DEFAULT_RANGES.ph.min,                  DEFAULT_RANGES.ph.max]                   as [number, number], get: (r: Reading) => r.ph },
    { key: 'alk',      label: 'Alkalinity',        unit: 'ppm', target: [DEFAULT_RANGES.alkalinity.min,          DEFAULT_RANGES.alkalinity.max]           as [number, number], get: (r: Reading) => r.alkalinity },
    { key: 'ca',       label: 'Calcium Hardness',  unit: 'ppm', target: [DEFAULT_RANGES.calciumHardness.min,     DEFAULT_RANGES.calciumHardness.max]      as [number, number], get: (r: Reading) => r.calciumHardness },
    { key: 'cya',      label: 'Cyanuric Acid',     unit: 'ppm', target: [DEFAULT_RANGES.cyanuricAcid.min,        DEFAULT_RANGES.cyanuricAcid.max]         as [number, number], get: (r: Reading) => r.cyanuricAcid },
    { key: 'temp',     label: 'Temperature',       unit: '°C',  target: [DEFAULT_RANGES.temperature.min,         DEFAULT_RANGES.temperature.max]          as [number, number], get: (r: Reading) => r.temperature },
    { key: 'press',    label: 'Diff. Pressure',    unit: 'kPa', target: [DEFAULT_RANGES.differentialPressure.min, DEFAULT_RANGES.differentialPressure.max] as [number, number], get: (r: Reading) => r.differentialPressure },
  ];

  const telemetry: TelemetryMetric[] = METRICS.map(m => {
    const vals = weekReadings.map(m.get).filter((v): v is number => v != null);
    if (vals.length === 0) {
      const mid = parseFloat(((m.target[0] + m.target[1]) / 2).toFixed(1));
      return { key: m.key, label: m.label, unit: m.unit, avg: mid, min: mid, max: mid, target: m.target, status: 'unknown' };
    }
    const avg = parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1));
    const min = parseFloat(Math.min(...vals).toFixed(1));
    const max = parseFloat(Math.max(...vals).toFixed(1));
    const [lo, hi] = m.target;
    const status: TelemetryMetric['status'] =
      (avg < lo * 0.8 || avg > hi * 1.2) ? 'critical' :
      (avg < lo * 0.9 || avg > hi * 1.1) ? 'warning'  :
      (avg < lo || avg > hi)             ? 'watch'    : 'good';
    return { key: m.key, label: m.label, unit: m.unit, avg, min, max, target: m.target, status };
  });

  // Build 7-day calendar rows
  const days: DayStatus[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    d.setHours(0, 0, 0, 0);
    const end = new Date(d);
    end.setDate(end.getDate() + 1);
    const dayR = weekReadings.filter(r => r.timestamp >= d && r.timestamp < end);
    if (dayR.length === 0) {
      return { date: fmtDate(d), status: 'unknown' as const, note: 'No readings' };
    }
    let worst: 'good' | 'watch' | 'warning' | 'critical' = 'good';
    const notes: string[] = [];
    dayR.forEach(r => {
      METRICS.forEach(m => {
        const v = m.get(r);
        const [lo, hi] = m.target;
        if (v < lo * 0.8 || v > hi * 1.2)      { worst = 'critical'; notes.push(`${m.label} critical`); }
        else if (v < lo * 0.9 || v > hi * 1.1)  { if (worst !== 'critical') worst = 'warning'; notes.push(`${m.label} off`); }
        else if (v < lo || v > hi)               { if (worst === 'good') worst = 'watch'; notes.push(`${m.label} watch`); }
      });
    });
    return {
      date: fmtDate(d),
      status: worst,
      note: notes.length === 0 ? 'All nominal' : [...new Set(notes)].slice(0, 2).join(', '),
    };
  });

  const trend: TrendPoint[] = weekReadings.map(r => ({
    d: fmtTrendLabel(r.timestamp),
    chlorine: r.chlorine,
    ph: r.ph,
    alk: r.alkalinity,
    press: r.differentialPressure,
  }));

  // Use the latest in-window reading for LSI; fall back to global latest only for the gauge snapshot
  const latestWeekR = weekReadings.length > 0 ? weekReadings[weekReadings.length - 1] : null;
  const latestR = latestWeekR ?? readings[0] ?? null;
  const lsi = latestWeekR ? calculateLSI(latestWeekR) : 0;
  const lsiAbs = Math.abs(lsi);
  const lsiLabel = lsiAbs > 0.3 ? 'Critical' : lsiAbs > 0.1 ? 'Drifting' : 'Balanced';

  const allUnknown = weekReadings.length === 0;
  const hasCritical = !allUnknown && (telemetry.some(m => m.status === 'critical') || lsiAbs > 0.3);
  const hasWarning  = !allUnknown && (telemetry.some(m => m.status === 'warning')  || (lsiAbs > 0.1 && lsiAbs <= 0.3));
  const hasWatch    = !allUnknown && telemetry.some(m => m.status === 'watch');
  const overall: ReportData['status']['overall'] =
    allUnknown    ? 'watch' :
    hasCritical   ? 'critical' :
    hasWarning    ? 'warning'  :
    hasWatch      ? 'watch'    : 'good';

  // Only flag metrics that have actual data (exclude unknown placeholders)
  const badMetrics = telemetry.filter(m => m.status !== 'good' && m.status !== 'unknown').map(m => m.label.toLowerCase());
  const headline = allUnknown
    ? 'No readings recorded this week — monitoring gap'
    : badMetrics.length === 0
    ? 'All parameters within specification this week'
    : badMetrics.length === 1
    ? `${badMetrics[0]} requires attention this week`
    : `${badMetrics.slice(0, -1).join(', ')} and ${badMetrics[badMetrics.length - 1]} need monitoring`;

  const advisories: Advisory[] = [];
  const pressM = telemetry.find(m => m.key === 'press');
  const phM    = telemetry.find(m => m.key === 'ph');
  const clM    = telemetry.find(m => m.key === 'chlorine');

  if (pressM && pressM.max > DEFAULT_RANGES.differentialPressure.max) {
    advisories.push({ tier: 'warning', title: 'Filter pressure spike', time: 'This week',
      msg: `Pressure reached ${pressM.max} kPa (target ${DEFAULT_RANGES.differentialPressure.min}–${DEFAULT_RANGES.differentialPressure.max} kPa). Possible partial bed clog.`,
      action: 'Backwash if not done. Schedule sand inspection if pressure persists.' });
  }
  if (phM && phM.max > DEFAULT_RANGES.ph.max) {
    advisories.push({ tier: 'watch', title: 'pH trended high', time: 'This week',
      msg: `pH reached ${phM.max} (target ${DEFAULT_RANGES.ph.min}–${DEFAULT_RANGES.ph.max}). Reduces chlorine sanitizing efficiency.`,
      action: 'Run acid demand test. Adjust dosing to keep pH below 7.6.' });
  }
  if (clM && clM.min < DEFAULT_RANGES.chlorine.min) {
    advisories.push({ tier: 'watch', title: 'Free chlorine dipped below minimum', time: 'This week',
      msg: `FC dropped to ${clM.min} ppm — below target of ${DEFAULT_RANGES.chlorine.min} ppm.`,
      action: 'Check chlorine supply and dosing schedule.' });
  }
  advisories.push({ tier: 'good', title: 'Monitoring active', time: 'Week',
    msg: `${weekReadings.length} reading${weekReadings.length !== 1 ? 's' : ''} recorded this week. LSI: ${lsi >= 0 ? '+' : ''}${lsi} (${lsiLabel}).`,
    action: 'Continue current monitoring cadence.' });

  const nextSteps: NextStep[] = [];
  const lowStock = inventory.filter(i => i.quantity <= i.minThreshold);
  if (pressM && pressM.max > DEFAULT_RANGES.differentialPressure.max)
    nextSteps.push({ id: 'n1', priority: 'high', title: 'Inspect filter system', detail: 'Pressure spike detected. Backwash if not done; inspect sand bed if pressure persists.', due: 'Within 7 days' });
  if (lowStock.length > 0)
    nextSteps.push({ id: 'n2', priority: 'high', title: `Restock ${lowStock[0].name.toLowerCase()}`, detail: `${lowStock[0].name} is at ${lowStock[0].quantity} ${lowStock[0].unit}, below minimum of ${lowStock[0].minThreshold} ${lowStock[0].unit}.`, due: 'Before next session' });
  if (phM && phM.max > DEFAULT_RANGES.ph.max)
    nextSteps.push({ id: 'n3', priority: 'medium', title: 'Acid demand test', detail: 'pH drifted high this week. Run a full demand test to recalibrate dosing.', due: 'Next service' });
  nextSteps.push({ id: 'n4', priority: 'low', title: 'Review weekly trends', detail: 'Review chart data weekly to catch gradual drifts early.', due: 'Ongoing' });

  const inventoryBurn: InventoryBurnItem[] = inventory.map(item => {
    const needsReorder = item.quantity <= item.minThreshold;
    // start is estimated as enough to show relative fill on the bar; no time-series data available
    const start = parseFloat((Math.max(item.quantity * 2, item.minThreshold * 4)).toFixed(1));
    return { name: item.name, unit: item.unit, current: item.quantity, start, burn: -1, weeks: -1, action: needsReorder ? 'REORDER' : 'OK' };
  });

  const required: RequiredItem[] = [
    ...lowStock.map(i => ({ type: 'chemical' as const, name: `${i.name} (reorder)`, reason: `Below minimum ${i.minThreshold} ${i.unit}`, urgency: 'high' as const })),
    ...(pressM && pressM.max > DEFAULT_RANGES.differentialPressure.max ? [{ type: 'service' as const, name: 'Filter inspection', reason: 'Pressure spike detected', urgency: 'medium' as const }] : []),
  ];
  if (required.length === 0) required.push({ type: 'consumable', name: 'DPD test reagents check', reason: 'Routine monthly check', urgency: 'low' });

  const operatorName = user?.displayName || user?.email || 'Operator';
  const periodStr = weekReadings.length > 0
    ? `${fmtDate(weekReadings[0].timestamp)} – ${fmtDate(weekReadings[weekReadings.length - 1].timestamp)}`
    : `${fmtDate(cutoff)} – ${fmtDate(now)}`;

  return {
    facility: {
      name: operatorName,
      pool: 'Main Pool',
      operator: operatorName,
      location: 'PoolStatus AI',
      period: periodStr,
      generatedAt: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      reportId: `PS-${now.getFullYear()}-W${String(isoWeek(now)).padStart(2, '0')}`,
    },
    status: { overall, headline, lsi, lsiLabel, uptime: 100, readings: weekReadings.length, swimmerHours: 0 },
    telemetry, days,
    trend,
    advisories, nextSteps, inventory: inventoryBurn, required,
    endOfShiftPhoto: {
      url: null,
      // prefer the latest in-window reading; latestR is null only when there are no readings at all
      timestamp: latestR ? `${fmtDate(latestR.timestamp)} · ${latestR.timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}` : 'No data',
      operator: operatorName,
      gauges: {
        pressure: latestR ? `${latestR.differentialPressure} kPa` : '— kPa',
        chlorine: latestR ? `${latestR.chlorine} ppm` : '— ppm',
        ph: latestR ? `${latestR.ph}` : '—',
      },
    },
  };
}

// ── Visualization components ──────────────────────────────────────────────────

function LsiGauge({ value = 0, size = 220, theme = 'dark' }: { value?: number; size?: number; theme?: 'dark' | 'light' }) {
  const min = -0.5, max = 0.5;
  const v = Math.max(min, Math.min(max, value));
  const pct = (v - min) / (max - min);
  const angle = -90 + pct * 180;
  const r = size * 0.42;
  const cx = size / 2, cy = size * 0.72;
  const ink = theme === 'light' ? '#1a2740' : '#fff';
  const dim = theme === 'light' ? '#7d8aa3' : '#4A6A80';

  const seg = (a1: number, a2: number, color: string) => {
    const toXY = (a: number): [number, number] => [cx + r * Math.cos((a - 90) * Math.PI / 180), cy + r * Math.sin((a - 90) * Math.PI / 180)];
    const [x1, y1] = toXY(a1), [x2, y2] = toXY(a2);
    return <path d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`} stroke={color} strokeWidth="14" fill="none" strokeLinecap="butt" />;
  };

  const nx = cx + (r - 2) * Math.cos(angle * Math.PI / 180);
  const ny = cy + (r - 2) * Math.sin(angle * Math.PI / 180);
  const status = Math.abs(v) > 0.3 ? 'critical' : Math.abs(v) > 0.1 ? 'watch' : 'good';
  const accent = status === 'good' ? '#10B981' : status === 'watch' ? '#F59E0B' : '#EF4444';
  const lsiLabel = v < -0.3 ? 'Corrosive' : v > 0.3 ? 'Scale Forming' : Math.abs(v) > 0.1 ? 'Drifting' : 'Balanced';

  return (
    <svg width={size} height={size * 0.85} viewBox={`0 0 ${size} ${size * 0.85}`}>
      {seg(-90, -55, '#EF4444')}
      {seg(-55, -20, '#F59E0B')}
      {seg(-20,  20, '#10B981')}
      {seg( 20,  55, '#F59E0B')}
      {seg( 55,  90, '#EF4444')}
      {([-0.5, -0.25, 0, 0.25, 0.5] as number[]).map((t, i) => {
        const a = (-90 + ((t - min) / (max - min)) * 180) - 90;
        const x1 = cx + (r - 22) * Math.cos(a * Math.PI / 180);
        const y1 = cy + (r - 22) * Math.sin(a * Math.PI / 180);
        const x2 = cx + (r - 30) * Math.cos(a * Math.PI / 180);
        const y2 = cy + (r - 30) * Math.sin(a * Math.PI / 180);
        const lx = cx + (r - 44) * Math.cos(a * Math.PI / 180);
        const ly = cy + (r - 44) * Math.sin(a * Math.PI / 180);
        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={dim} strokeWidth="1.5" />
            <text x={lx} y={ly + 3} fill={dim} fontSize="10" fontFamily="Space Mono, monospace" textAnchor="middle">{t > 0 ? `+${t}` : t}</text>
          </g>
        );
      })}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={ink} strokeWidth="3" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="6" fill={ink} />
      <circle cx={cx} cy={cy} r="3" fill={accent} />
      <text x={cx} y={cy + 30} textAnchor="middle" fontSize="32" fontWeight="700" fontFamily="Space Mono, monospace" fill={ink}>{v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2)}</text>
      <text x={cx} y={cy + 50} textAnchor="middle" fontSize="10" fontWeight="700" letterSpacing="0.16em" fill={accent} style={{ textTransform: 'uppercase' }}>{lsiLabel}</text>
    </svg>
  );
}

function RangeBand({ label, unit, min, max, lo, hi, value, theme = 'dark' }: { label: string; unit: string; min: number; max: number; lo: number; hi: number; value: number; theme?: 'dark' | 'light' }) {
  const span = max - min || 1;
  const loPct  = ((lo - min) / span) * 100;
  const hiPct  = ((hi - min) / span) * 100;
  const vPct   = Math.min(100, Math.max(0, ((value - min) / span) * 100));
  const ok     = value >= lo && value <= hi;
  const accent = ok ? '#10B981' : '#F59E0B';
  const ink    = theme === 'light' ? '#1a2740' : '#fff';
  const dim    = theme === 'light' ? '#7d8aa3' : '#4A6A80';
  const trackBg = theme === 'light' ? '#e9eef5' : '#0A1628';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: dim }}>{label}</span>
        <span style={{ fontFamily: '"Space Mono",monospace', fontSize: 18, fontWeight: 700, color: ink }}>{value}<span style={{ fontSize: 10, color: dim, marginLeft: 4 }}>{unit}</span></span>
      </div>
      <div style={{ position: 'relative', height: 14, background: trackBg, borderRadius: 9999, overflow: 'visible' }}>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${loPct}%`, width: `${hiPct - loPct}%`, background: 'rgba(16,185,129,.25)', borderLeft: '1px dashed rgba(16,185,129,.6)', borderRight: '1px dashed rgba(16,185,129,.6)' }} />
        <div style={{ position: 'absolute', top: -3, bottom: -3, left: `calc(${vPct}% - 4px)`, width: 8, background: accent, borderRadius: 2, boxShadow: `0 0 0 2px ${theme === 'light' ? '#fff' : '#0D1F38'}` }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: '"Space Mono",monospace', fontSize: 9, color: dim, letterSpacing: '.1em' }}>
        <span>{min}{unit}</span>
        <span>Target {lo}–{hi}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

const STATUS_COLOR = {
  good:     { fg: '#10B981', bg: 'rgba(16,185,129,.18)' },
  watch:    { fg: '#F59E0B', bg: 'rgba(245,158,11,.20)' },
  warning:  { fg: '#FB923C', bg: 'rgba(251,146,60,.22)' },
  critical: { fg: '#EF4444', bg: 'rgba(239,68,68,.22)' },
  unknown:  { fg: '#4A6A80', bg: 'rgba(74,106,128,.12)' },
};

function DayHeatmap({ days, theme = 'dark', height = 110 }: { days: DayStatus[]; theme?: 'dark' | 'light'; height?: number }) {
  const ink = theme === 'light' ? '#1a2740' : '#fff';
  const dim = theme === 'light' ? '#7d8aa3' : '#4A6A80';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${days.length}, 1fr)`, gap: 6 }}>
      {days.map((d, i) => {
        const c = STATUS_COLOR[d.status];
        return (
          <div key={i} style={{ padding: '10px 8px', background: c.bg, border: `1px solid ${c.fg}55`, borderRadius: 8, minHeight: height, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: dim }}>{d.date}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: c.fg, textTransform: 'uppercase', marginTop: 4, letterSpacing: '.1em' }}>
                {d.status === 'good' ? '✓ OK' : d.status === 'watch' ? '⚠ Watch' : d.status === 'unknown' ? '— No data' : '✕ Action'}
              </div>
            </div>
            <div style={{ fontSize: 10, color: ink, opacity: .85, lineHeight: 1.3 }}>{d.note}</div>
          </div>
        );
      })}
    </div>
  );
}

function TrendLines({ trend, metrics, theme = 'dark', height = 220 }: { trend: TrendPoint[]; metrics: { key: keyof TrendPoint; label: string; color: string }[]; theme?: 'dark' | 'light'; height?: number }) {
  const ink   = theme === 'light' ? '#1a2740' : '#fff';
  const dim   = theme === 'light' ? '#7d8aa3' : '#4A6A80';
  const grid  = theme === 'light' ? '#e9eef5' : '#1E3A5F';
  const W = 600, H = height, padL = 40, padR = 16, padT = 12, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  if (trend.length === 0) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height}>
        {[0, 1, 2, 3].map(i => <line key={i} x1={padL} x2={W - padR} y1={padT + (innerH / 3) * i} y2={padT + (innerH / 3) * i} stroke={grid} strokeWidth="1" strokeDasharray="2 4" />)}
        <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="11" fontFamily="Space Mono, monospace" fill={dim} style={{ textTransform: 'uppercase', letterSpacing: '.15em' }}>No readings this week</text>
      </svg>
    );
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height}>
      {[0, 1, 2, 3].map(i => <line key={i} x1={padL} x2={W - padR} y1={padT + (innerH / 3) * i} y2={padT + (innerH / 3) * i} stroke={grid} strokeWidth="1" strokeDasharray="2 4" />)}
      {trend.map((t, i) => {
        const x = padL + (trend.length > 1 ? (i / (trend.length - 1)) * innerW : innerW / 2);
        return <text key={i} x={x} y={H - 8} fontSize="8" fontFamily="Space Mono, monospace" fill={dim} textAnchor="middle">{i % 2 === 0 ? t.d : ''}</text>;
      })}
      {metrics.map(m => {
        const vals = trend.map(t => t[m.key] as number);
        const vMin = Math.min(...vals), vRange = (Math.max(...vals) - vMin) || 1;
        const pts = vals.map((v, i) => {
          const x = padL + (trend.length > 1 ? (i / (trend.length - 1)) * innerW : innerW / 2);
          const y = padT + innerH - ((v - vMin) / vRange) * innerH;
          return `${x},${y}`;
        }).join(' ');
        return (
          <g key={m.key as string}>
            <polyline points={pts} fill="none" stroke={m.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {vals.map((v, i) => {
              const x = padL + (trend.length > 1 ? (i / (trend.length - 1)) * innerW : innerW / 2);
              const y = padT + innerH - ((v - vMin) / vRange) * innerH;
              return <circle key={i} cx={x} cy={y} r="2" fill={m.color} />;
            })}
          </g>
        );
      })}
      {metrics.map((m, i) => (
        <g key={m.key as string}>
          <rect x={padL + i * 120} y={2} width="10" height="3" fill={m.color} />
          <text x={padL + i * 120 + 14} y={7} fontSize="9" fontFamily="Exo 2, sans-serif" fontWeight="700" fill={ink} style={{ textTransform: 'uppercase', letterSpacing: '.1em' }}>{m.label}</text>
        </g>
      ))}
    </svg>
  );
}

function InventoryBurn({ items, theme = 'dark' }: { items: InventoryBurnItem[]; theme?: 'dark' | 'light' }) {
  const ink     = theme === 'light' ? '#1a2740' : '#fff';
  const dim     = theme === 'light' ? '#7d8aa3' : '#4A6A80';
  const trackBg = theme === 'light' ? '#e9eef5' : '#0A1628';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {items.map(it => {
        const pct = it.start > 0 ? (it.current / it.start) * 100 : 0;
        const fg  = it.action === 'REORDER' ? '#EF4444' : pct < 50 ? '#F59E0B' : '#10B981';
        return (
          <div key={it.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: ink }}>{it.name}</span>
              <span style={{ fontFamily: '"Space Mono",monospace', fontSize: 11, color: dim }}>
                <span style={{ color: fg, fontWeight: 700 }}>{it.current}</span> / {it.start} {it.unit}
                {it.action === 'REORDER' && <span style={{ marginLeft: 8, padding: '1px 6px', background: 'rgba(239,68,68,.2)', color: '#EF4444', border: '1px solid rgba(239,68,68,.4)', borderRadius: 3, fontSize: 8, letterSpacing: '.15em' }}>REORDER</span>}
              </span>
            </div>
            <div style={{ height: 10, background: trackBg, borderRadius: 9999, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: fg, borderRadius: 9999 }} />
            </div>
            {it.action === 'REORDER' && (
              <div style={{ fontSize: 9, fontFamily: '"Space Mono",monospace', color: '#EF4444', letterSpacing: '.1em' }}>BELOW MINIMUM — REORDER NOW</div>
            )}
            {it.burn < 0 && (
              <div style={{ fontSize: 9, fontFamily: '"Space Mono",monospace', color: dim, letterSpacing: '.1em' }}>NO BURN HISTORY AVAILABLE</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PoolDiagram({ width = 360, height = 180, theme = 'dark', indicators = {} }: { width?: number; height?: number; theme?: 'dark' | 'light'; indicators?: { chlorine?: boolean; pressure?: boolean } }) {
  const wall = theme === 'light' ? '#1a2740' : '#cce4f0';
  const water = '#4FC3F7';
  const tile = theme === 'light' ? '#dbe2ed' : '#1E3A5F';
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height}>
      <defs>
        <linearGradient id="poolwater" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={water} stopOpacity="0.4" />
          <stop offset="100%" stopColor={water} stopOpacity="0.15" />
        </linearGradient>
        <pattern id="ripple" width="20" height="6" patternUnits="userSpaceOnUse">
          <path d="M0 3 Q 5 0 10 3 T 20 3" stroke={water} strokeWidth="0.8" fill="none" opacity="0.6" />
        </pattern>
      </defs>
      <rect x="0" y="0" width={width} height="40" fill={tile} opacity="0.2" />
      <rect x="0" y="40" width={width} height={height - 40} fill={tile} opacity="0.3" />
      <path d={`M 30 50 L 30 130 Q 30 150 50 150 L ${width - 50} 150 Q ${width - 30} 150 ${width - 30} 130 L ${width - 30} 50 Z`} fill="url(#poolwater)" stroke={wall} strokeWidth="2" />
      <line x1="30" y1="58" x2={width - 30} y2="58" stroke={wall} strokeWidth="0.5" opacity=".4" />
      <rect x="30" y="46" width={width - 60} height="6" fill="url(#ripple)" />
      <rect x="38" y="40" width="14" height="10" fill={wall} opacity=".6" />
      <text x="45" y="36" textAnchor="middle" fontSize="7" fontFamily="Space Mono, monospace" fill={wall}>SKIM</text>
      <circle cx={width - 40} cy={80} r="4" fill={water} />
      <line x1={width - 44} y1={80} x2={width - 60} y2={80} stroke={water} strokeWidth="1.5" strokeDasharray="2 2" />
      <rect x={width / 2 - 8} y="148" width="16" height="3" fill={wall} />
      <text x="38" y="68" fontSize="8" fontFamily="Space Mono, monospace" fill={wall} opacity=".7">1.2 m</text>
      <text x={width - 58} y="68" fontSize="8" fontFamily="Space Mono, monospace" fill={wall} opacity=".7">2.4 m</text>
      {indicators.chlorine && <g><circle cx="80" cy="100" r="4" fill="#10B981" /><text x="88" y="103" fontSize="8" fontFamily="Exo 2, sans-serif" fontWeight="700" fill={wall} style={{ textTransform: 'uppercase', letterSpacing: '.1em' }}>FC OK</text></g>}
      {indicators.pressure && <g><circle cx={width / 2} cy="158" r="4" fill="#F59E0B" /><text x={width / 2 + 8} y="161" fontSize="8" fontFamily="Exo 2, sans-serif" fontWeight="700" fill={wall}>FILTER WATCH</text></g>}
    </svg>
  );
}

function EquipmentFlow({ width = 520, height = 140, theme = 'dark', flagFilter = false }: { width?: number; height?: number; theme?: 'dark' | 'light'; flagFilter?: boolean }) {
  const wall   = theme === 'light' ? '#1a2740' : '#cce4f0';
  const accent = '#4FC3F7';
  const dim    = theme === 'light' ? '#7d8aa3' : '#4A6A80';
  const node = (x: number, y: number, label: string, sub: string, color?: string) => (
    <g key={label}>
      <rect x={x - 32} y={y - 22} width="64" height="44" rx="8" fill="none" stroke={color || wall} strokeWidth="1.5" />
      <text x={x} y={y - 2} fontSize="9" fontFamily="Exo 2, sans-serif" fontWeight="700" textAnchor="middle" fill={color || wall} style={{ textTransform: 'uppercase', letterSpacing: '.1em' }}>{label}</text>
      <text x={x} y={y + 12} fontSize="8" fontFamily="Space Mono, monospace" textAnchor="middle" fill={dim}>{sub}</text>
    </g>
  );
  const flow = (x1: number, x2: number, y: number) => (
    <g key={`f-${x1}`}>
      <line x1={x1 + 34} y1={y} x2={x2 - 34} y2={y} stroke={accent} strokeWidth="2" strokeDasharray="4 3" />
      <polygon points={`${x2 - 34},${y - 3} ${x2 - 30},${y} ${x2 - 34},${y + 3}`} fill={accent} />
    </g>
  );
  const nodes = [60, 180, 300, 420];
  const labels = ['Skimmer', 'Pump', 'Filter', 'Heater'];
  const subs   = ['intake', '1.5 kW', 'Sand · 25 µm', '27°C'];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="xMidYMid meet">
      {nodes.map((x, i) => node(x, 70, labels[i], subs[i], i === 2 && flagFilter ? '#F59E0B' : undefined))}
      {nodes.slice(0, -1).map((x, i) => flow(x, nodes[i + 1], 70))}
      {flow(420, width - 10, 70)}
      <g>
        <rect x={width - 32 - 10} y={70 - 22} width="64" height="44" rx="8" fill="none" stroke={accent} strokeWidth="1.5" />
        <text x={width - 10} y={68} fontSize="9" fontFamily="Exo 2, sans-serif" fontWeight="700" textAnchor="middle" fill={accent} style={{ textTransform: 'uppercase', letterSpacing: '.1em' }}>Pool</text>
        <text x={width - 10} y={82} fontSize="8" fontFamily="Space Mono, monospace" textAnchor="middle" fill={dim}>return</text>
      </g>
      {flagFilter && (
        <g>
          <line x1={300} y1={94} x2={300} y2={120} stroke="#F59E0B" strokeWidth="1.5" strokeDasharray="2 2" />
          <text x={300} y={132} fontSize="8" fontFamily="Exo 2, sans-serif" fontWeight="700" textAnchor="middle" fill="#F59E0B" style={{ textTransform: 'uppercase', letterSpacing: '.15em' }}>Pressure spike this week</text>
        </g>
      )}
    </svg>
  );
}

function Droplet({ size = 80, color = '#4FC3F7' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <path d="M32 6 C 18 28, 10 40, 18 52 A 16 16 0 0 0 46 52 C 54 40, 46 28, 32 6 Z" fill={color} />
      <path d="M24 44 a 8 8 0 0 0 8 4" stroke="rgba(0,0,0,.35)" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function GaugePhoto({ width = 360, height = 220, theme = 'dark', data }: { width?: number; height?: number; theme?: 'dark' | 'light'; data: ReportData['endOfShiftPhoto'] }) {
  const wall   = theme === 'light' ? '#1a2740' : '#cce4f0';
  const bg     = theme === 'light' ? '#e9eef5' : '#0A1628';
  const accent = '#4FC3F7';
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ borderRadius: 8, display: 'block' }}>
      <rect width={width} height={height} fill={bg} />
      {[...Array(20)].map((_, i) => <line key={i} x1={i * 30} y1={0} x2={i * 30} y2={height} stroke={wall} strokeWidth="0.4" opacity=".06" />)}
      <circle cx="100" cy="100" r="58" fill="none" stroke={wall} strokeWidth="2" opacity=".7" />
      <circle cx="100" cy="100" r="56" fill="none" stroke={wall} strokeWidth="0.5" opacity=".3" />
      {[...Array(11)].map((_, i) => {
        const a = -135 + i * 27;
        const x1 = 100 + Math.cos(a * Math.PI / 180) * 52, y1 = 100 + Math.sin(a * Math.PI / 180) * 52;
        const x2 = 100 + Math.cos(a * Math.PI / 180) * 46, y2 = 100 + Math.sin(a * Math.PI / 180) * 46;
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={wall} strokeWidth="1.4" opacity=".7" />;
      })}
      <line x1="100" y1="100" x2="135" y2="80" stroke={accent} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="100" cy="100" r="5" fill={accent} />
      <text x="100" y="146" textAnchor="middle" fontSize="9" fontWeight="700" fontFamily="Exo 2, sans-serif" fill={wall} style={{ textTransform: 'uppercase', letterSpacing: '.15em' }} opacity=".7">Pressure</text>
      <text x="100" y="162" textAnchor="middle" fontSize="13" fontWeight="700" fontFamily="Space Mono, monospace" fill={accent}>{data.gauges.pressure}</text>
      <g transform="translate(200, 36)">
        <rect width="120" height="22" fill="rgba(16,185,129,.4)" stroke={wall} strokeOpacity=".4" />
        <text x="60" y="15" textAnchor="middle" fontSize="9" fontWeight="700" fill={wall} fontFamily="Exo 2, sans-serif" style={{ textTransform: 'uppercase', letterSpacing: '.1em' }}>FC {data.gauges.chlorine}</text>
      </g>
      <g transform="translate(200, 68)">
        <rect width="120" height="22" fill="rgba(245,158,11,.35)" stroke={wall} strokeOpacity=".4" />
        <text x="60" y="15" textAnchor="middle" fontSize="9" fontWeight="700" fill={wall} fontFamily="Exo 2, sans-serif" style={{ textTransform: 'uppercase', letterSpacing: '.1em' }}>pH {data.gauges.ph}</text>
      </g>
      <rect x={width - 148} y={height - 26} width="138" height="18" fill="rgba(0,0,0,.5)" />
      <text x={width - 12} y={height - 13} textAnchor="end" fontSize="9" fontFamily="Space Mono, monospace" fill="#fff">{data.timestamp}</text>
      {([[8, 8, 1, 1], [width - 8, 8, -1, 1], [8, height - 8, 1, -1], [width - 8, height - 8, -1, -1]] as [number, number, number, number][]).map(([x, y, sx, sy], i) => (
        <g key={i}>
          <line x1={x} y1={y} x2={x + 10 * sx} y2={y} stroke={accent} strokeWidth="1.5" />
          <line x1={x} y1={y} x2={x} y2={y + 10 * sy} stroke={accent} strokeWidth="1.5" />
        </g>
      ))}
    </svg>
  );
}

// ── Report sub-components ─────────────────────────────────────────────────────

function ReportHeader({ d, theme = 'dark', subtitle }: { d: ReportData; theme?: 'dark' | 'light'; subtitle?: string }) {
  const ink = theme === 'light' ? '#1a2740' : '#fff';
  const dim = theme === 'light' ? '#7d8aa3' : '#4A6A80';
  const bd  = theme === 'light' ? '#dbe2ed' : '#1E3A5F';
  return (
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 24, borderBottom: `1px solid ${bd}` }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <svg width="28" height="28" viewBox="0 0 64 64"><path fill="#4FC3F7" d="M32 8 C 18 30, 12 40, 18 52 A 14 14 0 0 0 46 52 C 52 40, 46 30, 32 8 Z" /></svg>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '.18em', textTransform: 'uppercase', color: ink }}>Pool<span style={{ color: '#4FC3F7' }}>Status</span></div>
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: ink, letterSpacing: '-.01em' }}>{d.facility.name}</div>
        <div style={{ fontSize: 12, color: dim, marginTop: 4, fontFamily: '"Space Mono",monospace', letterSpacing: '.08em' }}>{d.facility.pool} · {d.facility.location}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', color: dim }}>{subtitle || 'Weekly Health Report'}</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: ink, marginTop: 4, fontFamily: '"Space Mono",monospace' }}>{d.facility.period}</div>
        <div style={{ fontSize: 10, color: dim, marginTop: 6, fontFamily: '"Space Mono",monospace' }}>ID {d.facility.reportId}</div>
        <div style={{ fontSize: 10, color: dim, fontFamily: '"Space Mono",monospace' }}>Generated {d.facility.generatedAt}</div>
      </div>
    </header>
  );
}

function SectionLabel({ title, sub, theme }: { title: string; sub?: string; theme: 'dark' | 'light' }) {
  const ink = theme === 'light' ? '#1a2740' : '#fff';
  const dim = theme === 'light' ? '#7d8aa3' : '#4A6A80';
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14, paddingBottom: 6, borderBottom: `1px dashed ${theme === 'light' ? '#dbe2ed' : '#1E3A5F'}` }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: ink }}>{title}</span>
      {sub && <span style={{ fontSize: 9, fontFamily: '"Space Mono",monospace', color: dim, letterSpacing: '.1em', textTransform: 'uppercase' }}>· {sub}</span>}
    </div>
  );
}

function AdvisoryCard({ a, theme }: { a: Advisory; theme: 'dark' | 'light' }) {
  const tier = TIER[a.tier];
  const ink  = theme === 'light' ? '#1a2740' : '#fff';
  const dim  = theme === 'light' ? '#7d8aa3' : '#8AB4CC';
  return (
    <div style={{ padding: '12px 14px', borderRadius: 10, background: tier.bg, border: `1px solid ${tier.bd}`, display: 'flex', gap: 14 }}>
      <div style={{ width: 4, alignSelf: 'stretch', background: tier.fg, borderRadius: 9999, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: ink }}>{a.title}</div>
          <div style={{ fontSize: 9, fontFamily: '"Space Mono",monospace', color: dim, letterSpacing: '.1em', whiteSpace: 'nowrap' }}>{a.time}</div>
        </div>
        <p style={{ fontSize: 11, color: dim, margin: '6px 0 0', lineHeight: 1.5 }}>{a.msg}</p>
        <p style={{ fontSize: 11, color: ink, margin: '6px 0 0', lineHeight: 1.5 }}><b style={{ color: tier.fg, letterSpacing: '.1em', textTransform: 'uppercase', fontSize: 9 }}>Action · </b>{a.action}</p>
      </div>
    </div>
  );
}

function NextStepCard({ n, theme }: { n: NextStep; theme: 'dark' | 'light' }) {
  const p       = PRIO[n.priority];
  const ink     = theme === 'light' ? '#1a2740' : '#fff';
  const dim     = theme === 'light' ? '#7d8aa3' : '#8AB4CC';
  const cardBg  = theme === 'light' ? '#fff' : '#0D1F38';
  const cardBd  = theme === 'light' ? '#dbe2ed' : '#1E3A5F';
  return (
    <div style={{ padding: '12px 14px', borderRadius: 10, background: cardBg, border: `1px solid ${cardBd}`, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: p.bg, border: `1px solid ${p.bd}`, color: p.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 14, fontWeight: 700 }}>›</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: ink }}>{n.title}</div>
          <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 9999, color: p.fg, background: p.bg, border: `1px solid ${p.bd}`, whiteSpace: 'nowrap' }}>{n.priority}</span>
        </div>
        <p style={{ fontSize: 11, color: dim, margin: '4px 0 0', lineHeight: 1.5 }}>{n.detail}</p>
        <div style={{ fontSize: 9, fontFamily: '"Space Mono",monospace', color: dim, marginTop: 6, letterSpacing: '.1em', textTransform: 'uppercase' }}>Due · {n.due}</div>
      </div>
    </div>
  );
}

function Rule() {
  return (
    <div style={{ margin: '36px 0', borderTop: '1px solid #dbe2ed', position: 'relative' }}>
      <div style={{ position: 'absolute', top: -4, left: '50%', transform: 'translateX(-50%)', width: 8, height: 8, background: '#4FC3F7', borderRadius: 9999 }} />
    </div>
  );
}

function Footer({ d, theme }: { d: ReportData; theme: 'dark' | 'light' }) {
  const dim = theme === 'light' ? '#7d8aa3' : '#4A6A80';
  const bd  = theme === 'light' ? '#dbe2ed' : '#1E3A5F';
  return (
    <footer style={{ marginTop: 40, paddingTop: 18, borderTop: `1px solid ${bd}`, display: 'flex', justifyContent: 'space-between', fontSize: 9, fontFamily: '"Space Mono",monospace', color: dim, letterSpacing: '.15em', textTransform: 'uppercase' }}>
      <span>Pool<span style={{ color: '#4FC3F7' }}>Status</span> · auto-generated</span>
      <span>{d.facility.reportId} · {d.facility.generatedAt}</span>
    </footer>
  );
}

// ── Variation A — Telemetry Console (dark) ────────────────────────────────────

function ReportA({ d }: { d: ReportData }) {
  const t = TIER[d.status.overall];
  return (
    <div style={{ background: '#060E1A', color: '#fff', fontFamily: '"Exo 2", sans-serif', padding: 48, boxSizing: 'border-box' }}>
      <ReportHeader d={d} theme="dark" subtitle="Weekly Health Report · Console" />

      <section style={{ marginTop: 28, padding: '20px 24px', background: t.bg, border: `1px solid ${t.bd}`, borderRadius: 14, display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 24, alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 14, height: 14, borderRadius: 9999, background: t.fg, boxShadow: `0 0 0 4px ${t.bg}` }} />
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: t.fg }}>Overall Status</div>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#fff' }}>{t.label}</div>
          </div>
        </div>
        <div style={{ color: '#fff', fontSize: 14, lineHeight: 1.5, maxWidth: 540 }}>{d.status.headline}</div>
        <div style={{ display: 'flex', gap: 24 }}>
          {[{ l: 'Uptime', v: `${d.status.uptime}%` }, { l: 'Readings', v: d.status.readings }, { l: 'LSI', v: d.status.lsi >= 0 ? `+${d.status.lsi}` : d.status.lsi }].map(s => (
            <div key={s.l} style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: '#4A6A80' }}>{s.l}</div>
              <div style={{ fontSize: 18, fontFamily: '"Space Mono",monospace', fontWeight: 700, color: '#4FC3F7', marginTop: 2 }}>{s.v}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24 }}>
        <div style={{ background: '#0D1F38', border: '1px solid #1E3A5F', borderRadius: 14, padding: 20 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: '#4A6A80', marginBottom: 8 }}>Saturation Index (LSI)</div>
          <LsiGauge value={d.status.lsi} size={260} theme="dark" />
          <p style={{ fontSize: 11, color: '#8AB4CC', margin: '8px 0 0', lineHeight: 1.5 }}>LSI measures water balance. Negative = corrosive; positive = scale-forming; ±0.1 is ideal.</p>
        </div>
        <div style={{ background: '#0D1F38', border: '1px solid #1E3A5F', borderRadius: 14, padding: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '22px 36px' }}>
          {d.telemetry.map(m => (
            <RangeBand key={m.key} label={m.label} unit={m.unit}
              min={parseFloat((Math.min(m.target[0] * 0.6, m.min * 0.9)).toFixed(1))}
              max={parseFloat((Math.max(m.target[1] * 1.4, m.max * 1.05)).toFixed(1))}
              lo={m.target[0]} hi={m.target[1]} value={m.avg} theme="dark" />
          ))}
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        <SectionLabel theme="dark" title="Daily Status" sub="7-day overview" />
        <DayHeatmap days={d.days} theme="dark" />
      </section>

      <section style={{ marginTop: 28, background: '#0D1F38', border: '1px solid #1E3A5F', borderRadius: 14, padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <SectionLabel theme="dark" title="Telemetry Trend" sub={`${d.status.readings} readings · normalized`} />
          <span style={{ fontSize: 9, fontFamily: '"Space Mono",monospace', color: '#4A6A80', letterSpacing: '.15em' }}>SCALE: PER-METRIC</span>
        </div>
        <TrendLines trend={d.trend} metrics={[{ key: 'chlorine', label: 'FC', color: '#4FC3F7' }, { key: 'ph', label: 'pH', color: '#F59E0B' }, { key: 'press', label: 'Pressure', color: '#10B981' }]} theme="dark" height={220} />
      </section>

      <section style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <SectionLabel theme="dark" title="Advisories" sub={`${d.advisories.length} items`} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {d.advisories.map((a, i) => <AdvisoryCard key={i} a={a} theme="dark" />)}
          </div>
        </div>
        <div>
          <SectionLabel theme="dark" title="Next Steps" sub={`${d.nextSteps.length} actions`} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {d.nextSteps.map(n => <NextStepCard key={n.id} n={n} theme="dark" />)}
          </div>
        </div>
      </section>

      <section style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24 }}>
        <div style={{ background: '#0D1F38', border: '1px solid #1E3A5F', borderRadius: 14, padding: 20 }}>
          <SectionLabel theme="dark" title="Equipment Loop" sub="filter status" />
          <EquipmentFlow theme="dark" flagFilter={d.telemetry.find(m => m.key === 'press')?.status !== 'good'} />
        </div>
        <div style={{ background: '#0D1F38', border: '1px solid #1E3A5F', borderRadius: 14, padding: 20 }}>
          <SectionLabel theme="dark" title="End-of-Shift Photo" sub={d.endOfShiftPhoto.timestamp} />
          <GaugePhoto theme="dark" data={d.endOfShiftPhoto} />
          <div style={{ marginTop: 10, fontSize: 10, color: '#4A6A80', fontFamily: '"Space Mono",monospace', letterSpacing: '.1em' }}>OPERATOR · {d.endOfShiftPhoto.operator.toUpperCase()}</div>
        </div>
      </section>

      <section style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 24 }}>
        <div style={{ background: '#0D1F38', border: '1px solid #1E3A5F', borderRadius: 14, padding: 24 }}>
          <SectionLabel theme="dark" title="Inventory" sub="current levels" />
          <InventoryBurn items={d.inventory} theme="dark" />
        </div>
        <div style={{ background: '#0D1F38', border: '1px solid #1E3A5F', borderRadius: 14, padding: 24 }}>
          <SectionLabel theme="dark" title="Required Items" sub="this week" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {d.required.map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 10, background: r.urgency === 'high' ? 'rgba(239,68,68,.08)' : r.urgency === 'medium' ? 'rgba(245,158,11,.08)' : 'rgba(255,255,255,.03)', border: `1px solid ${r.urgency === 'high' ? 'rgba(239,68,68,.3)' : r.urgency === 'medium' ? 'rgba(245,158,11,.3)' : '#1E3A5F'}` }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', color: '#4A6A80' }}>{r.type}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginTop: 2 }}>{r.name}</div>
                  <div style={{ fontSize: 10, color: '#8AB4CC', marginTop: 2 }}>{r.reason}</div>
                </div>
                <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '.18em', padding: '3px 8px', borderRadius: 9999, background: 'rgba(255,255,255,.06)', color: r.urgency === 'high' ? '#EF4444' : r.urgency === 'medium' ? '#F59E0B' : '#8AB4CC' }}>{r.urgency.toUpperCase()}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer d={d} theme="dark" />
    </div>
  );
}

// ── Variation B — Editorial Brief (light) ─────────────────────────────────────

function ReportB({ d }: { d: ReportData }) {
  const t = TIER[d.status.overall];
  return (
    <div style={{ background: '#f7f5f0', color: '#1a2740', fontFamily: '"Exo 2", sans-serif', padding: '56px 64px', boxSizing: 'border-box' }}>
      <ReportHeader d={d} theme="light" subtitle="Weekly Health Report · Brief" />

      <section style={{ marginTop: 40, display: 'grid', gridTemplateColumns: '180px 1fr 200px', gap: 40, alignItems: 'center' }}>
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
          <Droplet size={160} color={t.fg} />
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-30%)', textAlign: 'center', color: '#fff' }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', opacity: .85 }}>Status</div>
            <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase' }}>{t.label}</div>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: '#7d8aa3', marginBottom: 14 }}>Headline</div>
          <p style={{ fontSize: 24, lineHeight: 1.3, fontWeight: 600, color: '#1a2740', margin: 0, letterSpacing: '-.01em' }}>"{d.status.headline}."</p>
          <div style={{ marginTop: 18, fontSize: 12, color: '#7d8aa3', fontFamily: '"Space Mono",monospace', letterSpacing: '.08em' }}>{d.status.readings} readings · {d.status.uptime}% uptime · LSI {d.status.lsi >= 0 ? `+${d.status.lsi}` : d.status.lsi}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: '#7d8aa3' }}>Saturation Index</div>
          <LsiGauge value={d.status.lsi} size={180} theme="light" />
        </div>
      </section>

      <section style={{ marginTop: 48, display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 40, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: '#7d8aa3', marginBottom: 8 }}>Pool Profile</div>
          <PoolDiagram width={420} height={200} theme="light" indicators={{ chlorine: true, pressure: d.telemetry.find(m => m.key === 'press')?.status !== 'good' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 28px' }}>
          {d.telemetry.slice(0, 6).map(m => (
            <RangeBand key={m.key} label={m.label} unit={m.unit}
              min={parseFloat((Math.min(m.target[0] * 0.6, m.min * 0.9)).toFixed(1))}
              max={parseFloat((Math.max(m.target[1] * 1.4, m.max * 1.05)).toFixed(1))}
              lo={m.target[0]} hi={m.target[1]} value={m.avg} theme="light" />
          ))}
        </div>
      </section>

      <Rule />

      <section>
        <SectionLabel theme="light" title="Daily Status" sub={d.facility.period} />
        <DayHeatmap days={d.days} theme="light" />
      </section>

      <Rule />

      <section>
        <SectionLabel theme="light" title="Advisories" sub="ranked by severity" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 32px' }}>
          {d.advisories.map((a, i) => {
            const tier = TIER[a.tier];
            return (
              <div key={i} style={{ paddingTop: 14, borderTop: `2px solid ${tier.fg}` }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: tier.fg }}>{tier.label}</div>
                  <div style={{ fontSize: 9, fontFamily: '"Space Mono",monospace', color: '#7d8aa3', letterSpacing: '.1em' }}>{a.time}</div>
                </div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#1a2740', marginTop: 6, letterSpacing: '-.01em' }}>{a.title}</div>
                <p style={{ fontSize: 13, color: '#3a4a66', lineHeight: 1.5, margin: '8px 0 0' }}>{a.msg}</p>
                <p style={{ fontSize: 12, color: '#1a2740', lineHeight: 1.5, margin: '10px 0 0', borderLeft: `3px solid ${tier.fg}`, paddingLeft: 10 }}><b style={{ letterSpacing: '.1em', textTransform: 'uppercase', fontSize: 10 }}>Action.</b> {a.action}</p>
              </div>
            );
          })}
        </div>
      </section>

      <Rule />

      <section>
        <SectionLabel theme="light" title="Trend Insights" sub={`${d.status.readings} readings`} />
        <div style={{ background: '#fff', border: '1px solid #dbe2ed', borderRadius: 14, padding: 24 }}>
          <TrendLines trend={d.trend} metrics={[{ key: 'chlorine', label: 'FC', color: '#0EA5E9' }, { key: 'ph', label: 'pH', color: '#D97706' }, { key: 'press', label: 'Pressure', color: '#059669' }]} theme="light" height={220} />
        </div>
        <p style={{ fontSize: 13, color: '#3a4a66', lineHeight: 1.7, margin: '18px 0 0', columnCount: 2, columnGap: 32 }}>
          {d.status.readings === 0
            ? 'No readings recorded for this week. Start logging readings to see trend analysis here.'
            : `${d.status.readings} reading${d.status.readings !== 1 ? 's' : ''} recorded this week. LSI held at ${d.status.lsi >= 0 ? `+${d.status.lsi}` : d.status.lsi} (${d.status.lsiLabel}). ${d.status.overall === 'good' ? 'All parameters remained within spec for the full period.' : 'Some parameters required attention — see advisories above.'}`}
        </p>
      </section>

      <Rule />

      <section style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 32 }}>
        <div>
          <SectionLabel theme="light" title="Suggested Next Steps" sub={`${d.nextSteps.length} actions`} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {d.nextSteps.map(n => <NextStepCard key={n.id} n={n} theme="light" />)}
          </div>
        </div>
        <div>
          <SectionLabel theme="light" title="Inventory" sub="current levels" />
          <InventoryBurn items={d.inventory.slice(0, 5)} theme="light" />
        </div>
      </section>

      <Footer d={d} theme="light" />
    </div>
  );
}

// ── Variation C — Hero Chart (dark, data-as-illustration) ─────────────────────

function ReportC({ d }: { d: ReportData }) {
  const t = TIER[d.status.overall];
  const daysOK = d.days.filter(x => x.status === 'good').length;
  return (
    <div style={{ background: '#060E1A', color: '#fff', fontFamily: '"Exo 2", sans-serif', padding: 48, boxSizing: 'border-box' }}>
      <ReportHeader d={d} theme="dark" subtitle="Weekly Health Report · Hero" />

      <section style={{ marginTop: 32, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, alignItems: 'center' }}>
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, fontSize: 9, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: '#4A6A80' }}>Saturation Index</div>
          <LsiGauge value={d.status.lsi} size={460} theme="dark" />
        </div>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 12px', borderRadius: 9999, background: t.bg, border: `1px solid ${t.bd}`, color: t.fg }}>
            <span style={{ width: 8, height: 8, borderRadius: 9999, background: t.fg }} />
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase' }}>{t.label}</span>
          </div>
          <div style={{ fontSize: 42, fontWeight: 800, marginTop: 18, lineHeight: 1.1, letterSpacing: '-.01em' }}>{d.status.headline}.</div>
          <div style={{ display: 'flex', gap: 28, marginTop: 28, flexWrap: 'wrap' }}>
            {[{ l: 'Uptime', v: `${d.status.uptime}%` }, { l: 'Readings', v: d.status.readings }, { l: 'LSI', v: d.status.lsi >= 0 ? `+${d.status.lsi}` : d.status.lsi }, { l: 'Days OK', v: `${daysOK}/7` }].map(s => (
              <div key={s.l}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: '#4A6A80' }}>{s.l}</div>
                <div style={{ fontSize: 28, fontFamily: '"Space Mono",monospace', fontWeight: 700, color: '#4FC3F7', marginTop: 2 }}>{s.v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ marginTop: 32, position: 'relative', background: 'linear-gradient(180deg, #0D1F38 0%, #0A1628 100%)', border: '1px solid #1E3A5F', borderRadius: 18, padding: '28px 32px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: '#4A6A80' }}>Telemetry — full week</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{d.status.readings} readings, 3 metrics tracked</div>
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            {[{ label: 'FC', color: '#4FC3F7' }, { label: 'pH', color: '#F59E0B' }, { label: 'PRESS', color: '#10B981' }].map(m => (
              <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 14, height: 3, background: m.color, display: 'inline-block' }} />
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: '#fff' }}>{m.label}</span>
              </div>
            ))}
          </div>
        </div>
        <TrendLines trend={d.trend} metrics={[{ key: 'chlorine', label: 'FC', color: '#4FC3F7' }, { key: 'ph', label: 'pH', color: '#F59E0B' }, { key: 'press', label: 'PRESS', color: '#10B981' }]} theme="dark" height={280} />
      </section>

      <section style={{ marginTop: 32 }}>
        <SectionLabel theme="dark" title="Daily Status" sub="visual cadence" />
        <DayHeatmap days={d.days} theme="dark" height={140} />
      </section>

      <section style={{ marginTop: 32, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <SectionLabel theme="dark" title="Advisories" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {d.advisories.map((a, i) => <AdvisoryCard key={i} a={a} theme="dark" />)}
          </div>
        </div>
        <div>
          <SectionLabel theme="dark" title="Next Steps" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {d.nextSteps.map(n => <NextStepCard key={n.id} n={n} theme="dark" />)}
          </div>
        </div>
      </section>

      <section style={{ marginTop: 32, display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: 24 }}>
        <div style={{ background: '#0D1F38', border: '1px solid #1E3A5F', borderRadius: 14, padding: 20 }}>
          <SectionLabel theme="dark" title="Equipment Loop" />
          <EquipmentFlow theme="dark" flagFilter={d.telemetry.find(m => m.key === 'press')?.status !== 'good'} />
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {d.required.map((r, i) => (
              <span key={i} style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 9999, border: `1px solid ${r.urgency === 'high' ? 'rgba(239,68,68,.4)' : '#1E3A5F'}`, color: r.urgency === 'high' ? '#EF4444' : '#8AB4CC' }}>{r.name}</span>
            ))}
          </div>
        </div>
        <div style={{ background: '#0D1F38', border: '1px solid #1E3A5F', borderRadius: 14, padding: 20 }}>
          <SectionLabel theme="dark" title="Inventory" />
          <InventoryBurn items={d.inventory.slice(0, 4)} theme="dark" />
        </div>
        <div style={{ background: '#0D1F38', border: '1px solid #1E3A5F', borderRadius: 14, padding: 20 }}>
          <SectionLabel theme="dark" title="End-of-Shift" sub={d.endOfShiftPhoto.timestamp} />
          <GaugePhoto theme="dark" data={d.endOfShiftPhoto} width={320} height={200} />
        </div>
      </section>

      <Footer d={d} theme="dark" />
    </div>
  );
}

// ── Main WeeklyReport component ───────────────────────────────────────────────

interface WeeklyReportProps {
  isOpen: boolean;
  onClose: () => void;
  readings: Reading[];
  inventory: InventoryItem[];
  user: User | null;
}

const VARIATIONS = [
  { id: 'A', label: 'A · Telemetry Console', desc: 'Dark dashboard, instrument density' },
  { id: 'B', label: 'B · Editorial Brief',   desc: 'Light, magazine-style, printable' },
  { id: 'C', label: 'C · Hero Chart',        desc: 'Dark, big LSI gauge hero' },
] as const;

type VariationId = typeof VARIATIONS[number]['id'];

export default function WeeklyReport({ isOpen, onClose, readings, inventory, user }: WeeklyReportProps) {
  const [variation, setVariation] = useState<VariationId>('A');

  const data = useMemo(
    () => deriveReportData(readings, inventory, user),
    [readings, inventory, user],
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 bg-bg/90 backdrop-blur-md overflow-y-auto"
        >
          {/* Sticky toolbar */}
          <div className="sticky top-0 z-10 bg-bg/95 backdrop-blur border-b border-border-dim px-4 py-3 flex items-center gap-3">
            <button onClick={onClose} className="icon-btn flex-shrink-0" title="Close">
              <X size={18} />
            </button>

            <div className="flex items-center gap-2 flex-shrink-0">
              <FileText size={16} className="text-accent" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-white">Weekly Report</span>
            </div>

            <div className="flex items-center gap-1 mx-auto">
              {VARIATIONS.map(v => (
                <button
                  key={v.id}
                  onClick={() => setVariation(v.id)}
                  title={v.desc}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                    variation === v.id
                      ? 'bg-accent text-primary'
                      : 'bg-surface border border-border-dim text-ink-muted hover:text-white'
                  }`}
                >
                  {v.id}
                </button>
              ))}
            </div>

            <div className="flex-shrink-0 hidden sm:flex items-center gap-2">
              <span className="text-[10px] text-ink-dim uppercase tracking-widest font-mono hidden md:block">
                {VARIATIONS.find(v => v.id === variation)?.desc}
              </span>
              <button
                onClick={() => window.print()}
                className="icon-btn"
                title="Print report"
              >
                <Printer size={16} />
              </button>
            </div>
          </div>

          {/* Report content */}
          <div className="max-w-[1180px] mx-auto my-6 px-4 pb-12">
            <div className="rounded-2xl overflow-hidden shadow-2xl">
              {variation === 'A' && <ReportA d={data} />}
              {variation === 'B' && <ReportB d={data} />}
              {variation === 'C' && <ReportC d={data} />}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
