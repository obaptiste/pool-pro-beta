import React, { useMemo, useState } from 'react';
import { ChevronLeft, Calendar, Clock, Droplets, Activity, Thermometer, TrendingUp, FileText, Trash2, Gauge, Waves, Sun, Grid3X3, List, ChevronRight, ImagePlus } from 'lucide-react';
import { motion } from 'motion/react';
import { Reading } from '../types';
import { addDays, endOfMonth, format, isSameDay, isSameMonth, startOfMonth, startOfWeek, subMonths, addMonths } from 'date-fns';
import { getSoftWarning } from '../lib/readingValidation';

interface Props {
  readings: Reading[];
  onBack: () => void;
  onDelete: (id: string) => void;
}

export default function History({ readings, onBack, onDelete }: Props) {
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('calendar');
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date | null>(readings[0]?.timestamp ?? null);

  const uniqueVisitDays = new Set(readings.map((reading) => format(reading.timestamp, 'yyyy-MM-dd'))).size;
  const firstVisit = readings.length ? readings[readings.length - 1].timestamp : null;
  const lastVisit = readings.length ? readings[0].timestamp : null;

  const groupedByDay = useMemo(() => {
    return readings.reduce<Record<string, Reading[]>>((acc, reading) => {
      const dayKey = format(reading.timestamp, 'yyyy-MM-dd');
      acc[dayKey] = acc[dayKey] ?? [];
      acc[dayKey].push(reading);
      return acc;
    }, {});
  }, [readings]);

  const selectedDayReadings = selectedDay ? groupedByDay[format(selectedDay, 'yyyy-MM-dd')] ?? [] : [];

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(calendarMonth);
    const monthEnd = endOfMonth(calendarMonth);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const days: Date[] = [];
    for (let i = 0; i < 42; i += 1) {
      const current = addDays(gridStart, i);
      if (current > monthEnd && current.getDay() === 1) break;
      days.push(current);
    }
    return days;
  }, [calendarMonth]);

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed inset-0 z-50 bg-bg overflow-y-auto anim-fade-up">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        <header className="flex items-center justify-between border-b border-border-dim pb-6">
          <button onClick={onBack} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-ink-dim hover:text-accent transition-colors">
            <ChevronLeft size={16} />Back to Dashboard
          </button>
          <div className="text-right space-y-2">
            <h1 className="text-lg font-bold text-ink tracking-tight">Telemetry Logs</h1>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setViewMode('calendar')} className={`px-2.5 py-1.5 rounded border text-[10px] uppercase tracking-widest font-bold ${viewMode === 'calendar' ? 'border-accent text-accent' : 'border-border-dim text-ink-dim'}`}>
                <Grid3X3 size={12} className="inline mr-1" />Calendar
              </button>
              <button onClick={() => setViewMode('list')} className={`px-2.5 py-1.5 rounded border text-[10px] uppercase tracking-widest font-bold ${viewMode === 'list' ? 'border-accent text-accent' : 'border-border-dim text-ink-dim'}`}>
                <List size={12} className="inline mr-1" />List
              </button>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="card bg-surface border-border-dim p-4"><p className="text-[10px] uppercase tracking-widest text-ink-dim">Logged Visits</p><p className="text-2xl font-bold text-white">{uniqueVisitDays}</p></div>
          <div className="card bg-surface border-border-dim p-4"><p className="text-[10px] uppercase tracking-widest text-ink-dim">Total Logs</p><p className="text-2xl font-bold text-white">{readings.length}</p></div>
          <div className="card bg-surface border-border-dim p-4"><p className="text-[10px] uppercase tracking-widest text-ink-dim">Range</p><p className="text-xs font-mono text-ink-muted">{firstVisit ? format(firstVisit, 'MMM d, yyyy') : '—'} → {lastVisit ? format(lastVisit, 'MMM d, yyyy') : '—'}</p></div>
        </div>

        {viewMode === 'calendar' ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 card bg-surface border-border-dim p-4 space-y-3">
              <div className="flex items-center justify-between">
                <button onClick={() => setCalendarMonth(subMonths(calendarMonth, 1))} className="p-2 rounded border border-border-dim text-ink-dim"><ChevronLeft size={14} /></button>
                <p className="text-sm font-bold text-white">{format(calendarMonth, 'MMMM yyyy')}</p>
                <button onClick={() => setCalendarMonth(addMonths(calendarMonth, 1))} className="p-2 rounded border border-border-dim text-ink-dim"><ChevronRight size={14} /></button>
              </div>
              <div className="grid grid-cols-7 gap-2 text-center text-[10px] uppercase tracking-widest text-ink-dim">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d}>{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-2">
                {calendarDays.map((day) => {
                  const dayKey = format(day, 'yyyy-MM-dd');
                  const logs = groupedByDay[dayKey] ?? [];
                  return (
                    <button key={dayKey} onClick={() => setSelectedDay(day)} className={`min-h-16 rounded border p-2 text-left ${isSameMonth(day, calendarMonth) ? 'border-border-dim' : 'border-border-dim/40 opacity-50'} ${selectedDay && isSameDay(selectedDay, day) ? 'ring-1 ring-accent' : ''}`}>
                      <div className="flex items-center justify-between"><span className="text-xs text-ink">{format(day, 'd')}</span>{logs.length > 0 ? <span className="text-[10px] text-accent font-bold">{logs.length}</span> : null}</div>
                      {logs.length > 0 ? <p className="text-[9px] text-ink-dim mt-1">{logs.length} report{logs.length === 1 ? '' : 's'}</p> : null}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="card bg-surface border-border-dim p-4 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-ink-dim">{selectedDay ? format(selectedDay, 'EEE, MMM d') : 'Pick a day'}</h3>
              <p className="text-[11px] text-ink-muted">{selectedDayReadings.length} logs for this day. You can review each report, delete incorrect entries, and re-log corrected values.</p>
              <button disabled className="w-full rounded-lg border border-border-dim p-2 text-xs text-ink-dim flex items-center justify-center gap-2"><ImagePlus size={13} />Bulk photo upload (coming soon)</button>
              <div className="space-y-2 max-h-[24rem] overflow-y-auto pr-1">
                {selectedDayReadings.map((reading) => (
                  <div key={reading.id} className="rounded border border-border-dim p-2 space-y-1">
                    <p className="text-[10px] text-ink-dim">{format(reading.timestamp, 'HH:mm:ss')}</p>
                    <p className="text-xs text-ink">pH {reading.ph ?? '—'} • ORP {reading.sanitisationMv ?? '—'} mV • FC {reading.chlorine ?? '—'} ppm</p>
                    {reading.notes ? <p className="text-[11px] text-ink-muted">{reading.notes}</p> : null}
                  </div>
                ))}
                {selectedDayReadings.length === 0 ? <p className="text-xs text-ink-dim">No logs for this day yet.</p> : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {readings.length === 0 ? <div className="card bg-bg/40 border-border-dim p-12 text-center space-y-4"><div className="text-4xl opacity-20">⬡</div><p className="text-sm font-bold uppercase tracking-widest text-ink-muted">No Logs Found</p></div> : readings.map((reading) => (
              <div key={reading.id} className="card anim-scan bg-surface border-border-dim p-0 overflow-hidden group"><div className="grid grid-cols-1 md:grid-cols-4"><div className="bg-bg p-4 flex flex-col justify-center border-r border-border-dim md:col-span-1"><div className="flex items-center gap-2 text-accent mb-1"><Calendar size={14} /><span className="text-xs font-bold font-mono">{format(reading.timestamp, 'MMM d, yyyy')}</span></div><div className="flex items-center gap-2 text-ink-dim"><Clock size={14} /><span className="text-[10px] font-bold font-mono uppercase tracking-widest">{format(reading.timestamp, 'HH:mm:ss')}</span></div></div>
                <div className="p-4 md:col-span-3 flex flex-col justify-between gap-4"><div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4"><DataPoint label="Chlorine" value={reading.chlorine} unit="ppm" icon={<Droplets size={12} />} color="text-sky-400" /><DataPoint label="Sanitisation / ORP" value={reading.sanitisationMv ?? null} unit="mV" icon={<Droplets size={12} />} color="text-blue-300" warning={reading.sanitisationMv != null ? getSoftWarning('sanitisationMv', reading.sanitisationMv) : null} /><DataPoint label="pH Level" value={reading.ph} unit="" icon={<Activity size={12} />} color="text-emerald-400" /><DataPoint label="Alkalinity" value={reading.alkalinity} unit="ppm" icon={<TrendingUp size={12} />} color="text-amber-400" /><DataPoint label="Temp" value={reading.temperature} unit="°C" icon={<Thermometer size={12} />} color="text-red-400" /><DataPoint label="Pressure" value={reading.differentialPressure} unit="PSI" icon={<Gauge size={12} />} color="text-indigo-400" /><DataPoint label="Calcium" value={reading.calciumHardness} unit="ppm" icon={<Waves size={12} />} color="text-cyan-400" /><DataPoint label="CYA" value={reading.cyanuricAcid} unit="ppm" icon={<Sun size={12} />} color="text-yellow-400" /></div>
                  {reading.notes && (<div className="flex gap-2 p-3 bg-bg/60 rounded-lg border border-border-dim/30"><FileText size={14} className="text-ink-dim shrink-0 mt-0.5" /><p className="text-[11px] text-ink-muted italic leading-relaxed">{reading.notes}</p></div>)}
                  <div className="flex justify-end border-t border-border-dim/30 pt-3 mt-1"><button onClick={() => onDelete(reading.id)} className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-critical/50 hover:text-critical transition-colors"><Trash2 size={12} />Purge Record</button></div>
                </div></div></div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function DataPoint({ label, value, unit, icon, color, warning }: { label: string; value: number | null; unit: string; icon: React.ReactNode; color: string; warning?: { message: string } | null }) {
  const isMissing = value == null;
  return <div className="space-y-1"><div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-ink-dim">{icon}{label}</div><div className="flex items-baseline gap-1"><span className={`text-lg font-bold font-mono ${isMissing ? 'text-ink-dim' : color}`}>{isMissing ? '—' : value.toFixed(label === 'pH Level' ? 1 : 0)}</span><span className="text-[9px] text-ink-dim font-bold uppercase">{unit}</span></div>{warning && !isMissing ? <p className="text-[9px] text-amber-300 leading-tight">{warning.message}</p> : null}</div>;
}
