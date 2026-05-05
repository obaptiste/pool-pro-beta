import React from 'react';
import { MapPin, Play, Square, Timer } from 'lucide-react';
import { WorkSession } from '../types';

interface Props {
  sessions: WorkSession[];
  activeSession: WorkSession | null;
  geoAutoStartEnabled: boolean;
  onStart: (source: 'manual' | 'geo') => void;
  onStop: () => void;
  onToggleGeoAutoStart: (enabled: boolean) => void;
}

const formatDuration = (ms: number) => {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
};

export default function WorkTracker({ sessions, activeSession, geoAutoStartEnabled, onStart, onStop, onToggleGeoAutoStart }: Props) {
  const totalMs = sessions.reduce((acc, session) => {
    const end = session.endTime ? session.endTime.getTime() : Date.now();
    return acc + Math.max(0, end - session.startTime.getTime());
  }, 0);

  const poolDays = new Set(sessions.map(s => s.startTime.toISOString().slice(0, 10))).size;

  return (
    <section className="card bg-surface border-border-dim p-4 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-ink">Work Time Tracker</h3>
          <p className="text-[10px] uppercase tracking-widest text-ink-dim">Joy Lane billing helper</p>
        </div>
        <Timer size={16} className="text-accent" />
      </header>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border-dim p-3">
          <p className="text-[10px] text-ink-dim uppercase tracking-widest">Pool Days</p>
          <p className="text-xl font-bold text-white">{poolDays}</p>
        </div>
        <div className="rounded-lg border border-border-dim p-3">
          <p className="text-[10px] text-ink-dim uppercase tracking-widest">Total Logged</p>
          <p className="text-xl font-bold text-white">{formatDuration(totalMs)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!activeSession ? (
          <button onClick={() => onStart('manual')} className="flex items-center gap-2 rounded-lg bg-accent text-primary px-3 py-2 text-xs font-bold uppercase tracking-widest">
            <Play size={14} /> Start Session
          </button>
        ) : (
          <button onClick={onStop} className="flex items-center gap-2 rounded-lg bg-critical/20 text-critical px-3 py-2 text-xs font-bold uppercase tracking-widest border border-critical/40">
            <Square size={14} /> Stop Session
          </button>
        )}

        <label className="flex items-center gap-2 text-xs text-ink-muted">
          <input type="checkbox" checked={geoAutoStartEnabled} onChange={(e) => onToggleGeoAutoStart(e.target.checked)} />
          Auto-start at Joy Lane
          <MapPin size={12} />
        </label>
      </div>
    </section>
  );
}
