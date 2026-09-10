import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Droplets,
  FileText,
  Gauge,
  Hand,
  Plus,
  Sun,
  Thermometer,
  Trash2,
  TrendingUp,
  Waves,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { Reading } from '../types';

interface Props {
  readings: Reading[];
  onBack: () => void;
  onDelete: (id: string) => void;
  onAddHistoricReading: (timestamp: Date) => void;
}

interface DataPointProps {
  label: string;
  value: number;
  unit: string;
  icon: React.ReactNode;
  color: string;
}

const LONG_PRESS_DURATION_MS = 550;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function History({ readings, onBack, onDelete, onAddHistoricReading }: Props) {
  const [today] = useState(() => startOfDay(new Date()));
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(today));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null);
  const didLongPressRef = useRef(false);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(visibleMonth);
    const monthEnd = endOfMonth(visibleMonth);

    return eachDayOfInterval({
      start: startOfWeek(monthStart, { weekStartsOn: 1 }),
      end: endOfWeek(monthEnd, { weekStartsOn: 1 }),
    });
  }, [visibleMonth]);

  const readingCounts = useMemo(() => {
    return readings.reduce<Map<string, number>>((counts, reading) => {
      const dayKey = format(reading.timestamp, 'yyyy-MM-dd');
      counts.set(dayKey, (counts.get(dayKey) ?? 0) + 1);
      return counts;
    }, new Map());
  }, [readings]);

  const displayedReadings = useMemo(() => {
    if (!selectedDay) return readings;
    return readings.filter((reading) => isSameDay(reading.timestamp, selectedDay));
  }, [readings, selectedDay]);

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pointerOriginRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  const openHistoricReading = (day: Date) => {
    const timestamp = new Date(day);
    const now = new Date();
    timestamp.setHours(now.getHours(), now.getMinutes(), 0, 0);
    onAddHistoricReading(timestamp);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>, day: Date) => {
    if (event.button !== 0 || isAfter(startOfDay(day), today)) return;

    clearLongPress();
    didLongPressRef.current = false;
    pointerOriginRef.current = { x: event.clientX, y: event.clientY };
    longPressTimerRef.current = setTimeout(() => {
      didLongPressRef.current = true;
      setSelectedDay(day);
      setVisibleMonth(startOfMonth(day));
      navigator.vibrate?.(25);
      openHistoricReading(day);
      clearLongPress();
    }, LONG_PRESS_DURATION_MS);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const origin = pointerOriginRef.current;
    if (!origin) return;

    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) {
      clearLongPress();
    }
  };

  const handleDayClick = (day: Date) => {
    if (didLongPressRef.current) {
      didLongPressRef.current = false;
      return;
    }

    setSelectedDay((current) => current && isSameDay(current, day) ? null : day);
    setVisibleMonth(startOfMonth(day));
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="fixed inset-0 z-50 bg-[#060e1a] overflow-y-auto"
    >
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <header className="flex items-center justify-between border-b border-border-dim pb-6">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-ink-dim hover:text-accent transition-colors"
          >
            <ChevronLeft size={16} />
            Back to Dashboard
          </button>
          <div className="text-right">
            <h1 className="text-lg font-bold text-ink tracking-tight">Telemetry Logs</h1>
            <p className="text-[9px] font-bold uppercase tracking-widest text-ink-dim">Historical Data Archive</p>
          </div>
        </header>

        <section className="card bg-[#0a1628] border-border-dim p-0 overflow-hidden" aria-label="Reading history calendar">
          <div className="flex flex-col gap-4 border-b border-border-dim px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-white">
                <Calendar size={16} className="text-accent" />
                <h2 className="text-sm font-bold tracking-wide">{format(visibleMonth, 'MMMM yyyy')}</h2>
              </div>
              <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-ink-dim">
                Tap to filter · press and hold to add a log
              </p>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => setVisibleMonth((month) => subMonths(month, 1))}
                className="btn btn-secondary h-9 w-9 p-0"
                aria-label="Previous month"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => setVisibleMonth((month) => addMonths(month, 1))}
                disabled={isSameMonth(visibleMonth, today)}
                className="btn btn-secondary h-9 w-9 p-0"
                aria-label="Next month"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="p-3 sm:p-4">
            <div className="grid grid-cols-7">
              {WEEKDAYS.map((weekday) => (
                <div
                  key={weekday}
                  className="pb-2 text-center text-[8px] font-bold uppercase tracking-widest text-ink-dim"
                >
                  {weekday}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((day) => {
                const dayKey = format(day, 'yyyy-MM-dd');
                const readingCount = readingCounts.get(dayKey) ?? 0;
                const isOutsideMonth = !isSameMonth(day, visibleMonth);
                const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
                const isCurrentDay = isSameDay(day, today);
                const isFutureDay = isAfter(startOfDay(day), today);
                const readingLabel = readingCount === 1 ? '1 log' : `${readingCount} logs`;

                return (
                  <button
                    key={dayKey}
                    type="button"
                    disabled={isFutureDay}
                    onClick={() => handleDayClick(day)}
                    onPointerDown={(event) => handlePointerDown(event, day)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={clearLongPress}
                    onPointerCancel={clearLongPress}
                    onPointerLeave={clearLongPress}
                    onContextMenu={(event) => event.preventDefault()}
                    className={`relative flex aspect-square min-h-10 select-none flex-col items-center justify-center rounded-lg border text-xs font-bold transition-all touch-manipulation sm:min-h-12 ${
                      isSelected
                        ? 'border-accent bg-accent text-primary shadow-lg shadow-accent/20'
                        : isCurrentDay
                          ? 'border-accent/60 bg-accent/10 text-accent'
                          : 'border-transparent bg-[#0d1f38]/60 text-ink-muted hover:border-border-dim hover:bg-[#0d1f38]'
                    } ${isOutsideMonth ? 'opacity-35' : ''} ${isFutureDay ? 'cursor-not-allowed opacity-20' : ''}`}
                    aria-label={`${format(day, 'EEEE, MMMM d, yyyy')}, ${readingLabel}. ${isFutureDay ? 'Future date' : 'Select day; press and hold to add a historic log'}`}
                    aria-pressed={isSelected}
                    aria-current={isCurrentDay ? 'date' : undefined}
                  >
                    <span className="font-mono">{format(day, 'd')}</span>
                    {readingCount > 0 && (
                      <span
                        className={`mt-1 min-w-4 rounded-full px-1 text-[7px] leading-4 ${
                          isSelected ? 'bg-primary/20 text-primary' : 'bg-accent/15 text-accent'
                        }`}
                        aria-hidden="true"
                      >
                        {readingCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border-dim bg-[#060e1a]/45 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-ink-dim">
              <Hand size={13} className="text-accent" />
              Hold today or any past date for half a second
            </div>
            {selectedDay ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedDay(null)}
                  className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-ink-dim hover:text-white"
                >
                  All logs
                </button>
                <button
                  type="button"
                  onClick={() => openHistoricReading(selectedDay)}
                  className="btn btn-primary gap-2 px-3 py-2 text-[9px] uppercase tracking-widest"
                >
                  <Plus size={13} />
                  Add log for {format(selectedDay, 'd MMM')}
                </button>
              </div>
            ) : null}
          </div>
        </section>

        <section className="space-y-4" aria-live="polite">
          <div>
            <h2 className="text-sm font-bold text-white">
              {selectedDay ? format(selectedDay, 'EEEE, d MMMM yyyy') : 'All telemetry logs'}
            </h2>
            <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-ink-dim">
              {displayedReadings.length} {displayedReadings.length === 1 ? 'record' : 'records'}
            </p>
          </div>

          {displayedReadings.length === 0 ? (
            <div className="card bg-[#0a1628] border-border-dim p-10 text-center space-y-4">
              <div className="text-4xl opacity-20">⬡</div>
              <p className="text-sm font-bold uppercase tracking-widest text-ink-muted">
                {selectedDay ? 'No logs for this day' : 'No logs found'}
              </p>
              {selectedDay ? (
                <button
                  type="button"
                  onClick={() => openHistoricReading(selectedDay)}
                  className="btn btn-secondary mx-auto gap-2 text-[9px] uppercase tracking-widest"
                >
                  <Plus size={13} />
                  Add historic log
                </button>
              ) : null}
            </div>
          ) : (
            displayedReadings.map((reading) => (
              <article key={reading.id} className="card bg-[#0d1f38] border-border-dim p-0 overflow-hidden group">
                <div className="grid grid-cols-1 md:grid-cols-4">
                  <div className="bg-[#060e1a] p-4 flex flex-col justify-center border-r border-border-dim md:col-span-1">
                    <div className="flex items-center gap-2 text-accent mb-1">
                      <Calendar size={14} />
                      <span className="text-xs font-bold font-mono">{format(reading.timestamp, 'MMM d, yyyy')}</span>
                    </div>
                    <div className="flex items-center gap-2 text-ink-dim">
                      <Clock size={14} />
                      <span className="text-[10px] font-bold font-mono uppercase tracking-widest">{format(reading.timestamp, 'HH:mm:ss')}</span>
                    </div>
                  </div>

                  <div className="p-4 md:col-span-3 flex flex-col justify-between gap-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
                      <DataPoint label="Chlorine" value={reading.chlorine} unit="ppm" icon={<Droplets size={12} />} color="text-sky-400" />
                      <DataPoint label="pH Level" value={reading.ph} unit="" icon={<Activity size={12} />} color="text-emerald-400" />
                      <DataPoint label="Alkalinity" value={reading.alkalinity} unit="ppm" icon={<TrendingUp size={12} />} color="text-amber-400" />
                      <DataPoint label="Temp" value={reading.temperature} unit="°C" icon={<Thermometer size={12} />} color="text-red-400" />
                      <DataPoint label="Pressure" value={reading.differentialPressure} unit="kPa" icon={<Gauge size={12} />} color="text-indigo-400" />
                      <DataPoint label="Calcium" value={reading.calciumHardness} unit="ppm" icon={<Waves size={12} />} color="text-cyan-400" />
                      <DataPoint label="CYA" value={reading.cyanuricAcid} unit="ppm" icon={<Sun size={12} />} color="text-yellow-400" />
                    </div>

                    {reading.notes && (
                      <div className="flex gap-2 p-3 bg-[#060e1a]/50 rounded-lg border border-border-dim/30">
                        <FileText size={14} className="text-ink-dim shrink-0 mt-0.5" />
                        <p className="text-[11px] text-ink-muted italic leading-relaxed">{reading.notes}</p>
                      </div>
                    )}

                    <div className="flex justify-end border-t border-border-dim/30 pt-3 mt-1">
                      <button
                        onClick={() => onDelete(reading.id)}
                        className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-critical/50 hover:text-critical transition-colors"
                      >
                        <Trash2 size={12} />
                        Purge Record
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </motion.div>
  );
}

function DataPoint({ label, value, unit, icon, color }: DataPointProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-ink-dim">
        {icon}
        {label}
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-lg font-bold font-mono ${color}`}>{value.toFixed(label === 'pH Level' ? 1 : 0)}</span>
        <span className="text-[9px] text-ink-dim font-bold uppercase">{unit}</span>
      </div>
    </div>
  );
}
