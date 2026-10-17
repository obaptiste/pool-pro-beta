import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, ChevronLeft, FileUp, Gauge } from 'lucide-react';
import { ControllerLogWindow } from '../types';
import {
  CONTROLLER_METRICS, ControllerMetric, ControllerRange, devicesByRecency, findGaps, formatRange, formatSince,
  isDose, metricRange, sortWindows, windowGrade, windowsInRange,
} from '../lib/controllerLog';
import { ControllerBandChart, ControllerDoseStrip, DoseLegend } from './ControllerCharts';

interface Props {
  windows: ControllerLogWindow[];
  onImport: () => void;
  onBack: () => void;
}

const RANGES: { key: ControllerRange; label: string }[] = [
  { key: '48h', label: '48 h' },
  { key: '7d', label: '7 d' },
  { key: '30d', label: '30 d' },
  { key: 'all', label: 'All' },
];
const METRIC_KEYS: ControllerMetric[] = ['ph', 'orp', 'temperature'];
const LABEL = 'text-[10px] font-bold uppercase tracking-[0.16em] text-ink-dim';

const when = (d: Date) => d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

function Segmented<T extends string>({ label, options, value, onChange }: {
  label: string; options: { key: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-xl bg-surface-2 border border-border-dim p-1 gap-1">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={o.key === value}
          onClick={() => onChange(o.key)}
          className={`min-h-9 px-3 rounded-lg text-[11px] font-bold tracking-wide transition-colors ${o.key === value ? 'bg-accent text-primary' : 'text-ink-muted hover:text-white'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Full-screen history of imported controller windows (Hanna CSV exports):
 * min–max bands per hour for pH, ORP or temperature, the pump doses
 * underneath, and a readout for the window you tap. History only: imported
 * windows never feed alerts, LSI, or the AI assistant.
 */
export default function ControllerLogView({ windows, onImport, onBack }: Props) {
  const devices = useMemo(() => devicesByRecency(windows), [windows]);
  const [device, setDevice] = useState<string | null>(null);
  const activeDevice = device && devices.includes(device) ? device : devices[0];
  const sorted = useMemo(() => sortWindows(windows.filter((w) => w.deviceId === activeDevice)), [windows, activeDevice]);
  const [range, setRange] = useState<ControllerRange>('48h');
  const [metric, setMetric] = useState<ControllerMetric>('ph');
  const shown = useMemo(() => windowsInRange(sorted, range), [sorted, range]);
  const gaps = useMemo(() => findGaps(shown), [shown]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = shown.find((w) => w.id === selectedId) ?? shown[shown.length - 1];
  const latest = sorted[sorted.length - 1];
  const doses = shown.filter(isDose).reverse();

  const step = (dir: -1 | 1) => {
    const i = shown.findIndex((w) => w.id === selected?.id);
    const next = shown[Math.min(shown.length - 1, Math.max(0, i + dir))];
    if (next) setSelectedId(next.id);
  };

  const t0 = shown[0]?.start.getTime() ?? 0;
  const t1 = shown[shown.length - 1]?.end.getTime() ?? 1;
  const grade = selected ? windowGrade(selected, metric) : null;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="fixed inset-0 z-50 bg-bg overflow-y-auto"
    >
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-5" style={{ paddingBottom: 'calc(120px + env(safe-area-inset-bottom))' }}>
        <header className="flex items-center justify-between border-b border-border-dim pb-5">
          <button onClick={onBack} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-ink-dim hover:text-accent transition-colors min-h-11">
            <ChevronLeft size={16} /> Back
          </button>
          <h1 className="text-lg font-bold text-ink tracking-tight flex items-center gap-2"><Gauge size={18} className="text-accent" />Controller Log</h1>
        </header>

        {!latest ? (
          <div className="rounded-2xl bg-surface border border-border-dim p-8 flex flex-col items-center text-center gap-3">
            <FileUp size={28} className="text-accent" />
            <h2 className="text-base font-bold text-ink">No controller data yet</h2>
            <p className="text-sm text-ink-muted max-w-sm">
              Import a CSV export from your Hanna controller to see its hourly pH, ORP and temperature ranges and the doses it made.
            </p>
            <button type="button" onClick={onImport} className="mt-2 px-5 py-3 rounded-xl bg-accent text-primary text-[10px] font-bold uppercase tracking-widest hover:brightness-110">
              Import controller data
            </button>
          </div>
        ) : (
          <>
            <section className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-1 min-w-0">
                {devices.length > 1 ? (
                  <select
                    id="controller-log-device"
                    aria-label="Controller"
                    value={activeDevice}
                    onChange={(e) => { setDevice(e.target.value); setSelectedId(null); }}
                    className="bg-surface-2 border border-border-dim rounded-lg px-2 py-1 text-sm font-mono text-ink"
                  >
                    {devices.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                ) : (
                  <p className="text-sm font-mono text-ink">{activeDevice}{latest.location ? ` · ${latest.location}` : ''}</p>
                )}
                <p className="text-xs text-ink-muted">
                  Imported history, not live. Latest window {formatSince(latest.end)} ({when(latest.end)}).
                </p>
              </div>
              <button type="button" onClick={onImport} className="min-h-9 px-3 rounded-lg border border-border-dim text-[10px] font-bold uppercase tracking-widest text-ink-muted hover:text-white">
                Import more
              </button>
            </section>

            <div className="flex flex-wrap gap-2 justify-between">
              <Segmented<ControllerMetric> label="Metric" value={metric} onChange={setMetric}
                options={METRIC_KEYS.map((k) => ({ key: k, label: k === 'temperature' ? 'Temp' : CONTROLLER_METRICS[k].label }))} />
              <Segmented<ControllerRange> label="Time range" value={range} onChange={(r) => { setRange(r); setSelectedId(null); }} options={RANGES} />
            </div>

            {selected && (
              <section aria-live="polite" className="rounded-xl bg-surface-2 border border-border-dim px-4 py-3 flex flex-wrap items-baseline gap-x-5 gap-y-2">
                <span className="text-sm font-bold text-ink">{when(selected.start)}–{time(selected.end)}</span>
                {METRIC_KEYS.map((k) => (
                  <span key={k} className="inline-flex items-baseline gap-1.5">
                    <span className={LABEL}>{k === 'temperature' ? 'Temp' : CONTROLLER_METRICS[k].label}</span>
                    <span className={`font-mono text-sm ${k === metric ? 'text-ink' : 'text-ink-muted'}`}>{formatRange(metricRange(selected, k), k)}</span>
                  </span>
                ))}
                <span className="inline-flex items-baseline gap-1.5"><span className={LABEL}>Acid</span><span className="font-mono text-sm text-ink-muted">{selected.acidBaseMaxMl != null ? `${Math.round(selected.acidBaseMaxMl)} mL` : '—'}</span></span>
                <span className="inline-flex items-baseline gap-1.5"><span className={LABEL}>Cl₂</span><span className="font-mono text-sm text-ink-muted">{selected.chlorineMaxMl != null ? `${Math.round(selected.chlorineMaxMl)} mL` : '—'}</span></span>
                {grade && (
                  <p className={`basis-full flex items-start gap-2 text-xs ${grade.level === 'warning' ? 'text-critical-text' : 'text-warning-text'}`}>
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
                    <span><b>{grade.level === 'warning' ? 'Warning' : 'Watch'}:</b> {grade.message}</span>
                  </p>
                )}
              </section>
            )}

            <section
              tabIndex={0}
              aria-label="Controller chart. Use the left and right arrow keys to step through windows."
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
                if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
              }}
              className="rounded-2xl bg-surface border border-border-dim p-3 space-y-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <div className="flex flex-wrap justify-between gap-2 px-1">
                <span className={LABEL}>{CONTROLLER_METRICS[metric].label}{CONTROLLER_METRICS[metric].unit ? ` (${CONTROLLER_METRICS[metric].unit})` : ''} · lowest to highest per window</span>
                <ZoneLegend metric={metric} />
              </div>
              <ControllerBandChart windows={shown} metric={metric} height={220} gaps={gaps} t0={t0} t1={t1}
                selectedId={selected?.id} onSelect={setSelectedId} />
              <div className="flex justify-between gap-2 px-1 pt-1">
                <span className={LABEL}>Doses (mL)</span>
                <DoseLegend />
              </div>
              <ControllerDoseStrip windows={shown} height={56} t0={t0} t1={t1} selectedId={selected?.id} onSelect={setSelectedId} />
            </section>

            <section className="space-y-2">
              <h2 className={LABEL}>Dose events in this range ({doses.length})</h2>
              {doses.length === 0 ? (
                <p className="text-sm text-ink-muted">The controller didn't dose in this range.</p>
              ) : (
                <ul className="rounded-xl bg-surface border border-border-dim divide-y divide-border-dim">
                  {doses.slice(0, 50).map((w) => (
                    <li key={w.id}>
                      <button type="button" onClick={() => setSelectedId(w.id)}
                        className={`w-full flex justify-between gap-3 px-4 py-2.5 text-left text-xs hover:bg-surface-2 ${w.id === selected?.id ? 'bg-surface-2' : ''}`}>
                        <span className="text-ink-muted">{when(w.start)}</span>
                        <span className="font-mono text-ink">
                          {(w.acidBaseMaxMl ?? 0) > 0 && `Acid ${Math.round(w.acidBaseMaxMl!)} mL`}
                          {(w.acidBaseMaxMl ?? 0) > 0 && (w.chlorineMaxMl ?? 0) > 0 && ' · '}
                          {(w.chlorineMaxMl ?? 0) > 0 && `Cl₂ ${Math.round(w.chlorineMaxMl!)} mL`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {doses.length > 50 && <p className="text-[10px] text-ink-dim">Showing the latest 50.</p>}
              <p className="text-[10px] text-ink-dim">
                Volumes are the per-window maximum the export reports. Times are the importing device's local time.
                {gaps.length > 0 && ' Hatched areas are periods the export had no data for.'}
              </p>
            </section>
          </>
        )}
      </div>
    </motion.div>
  );
}

function ZoneLegend({ metric }: { metric: ControllerMetric }) {
  const m = CONTROLLER_METRICS[metric];
  const name = (kind: 'good' | 'watch') =>
    kind === 'watch' ? (metric === 'orp' ? 'Elevated' : 'Watch') : metric === 'ph' ? 'Target' : metric === 'orp' ? 'Good' : 'App range';
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-muted">
      {m.zones.map(([kind, a, b]) => (
        <span key={kind} className="inline-flex items-center gap-1.5">
          <span className={`w-2.5 h-2.5 rounded-sm ${kind === 'good' ? 'bg-success/30' : 'bg-warning/30'}`} />{name(kind)} {a}–{b}
        </span>
      ))}
      {m.lines.map((v) => (
        <span key={v} className="inline-flex items-center gap-1.5"><span className="w-3 border-t border-dashed border-warning" />{v} {m.unit} alert</span>
      ))}
    </div>
  );
}
