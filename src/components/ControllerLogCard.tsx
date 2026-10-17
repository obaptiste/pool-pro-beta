import React, { useMemo } from 'react';
import { ChevronRight, Gauge } from 'lucide-react';
import { ControllerLogWindow } from '../types';
import { CONTROLLER_METRICS, ControllerMetric, devicesByRecency, formatRange, formatSince, isDose, metricRange, sortWindows } from '../lib/controllerLog';
import { ControllerBandChart } from './ControllerCharts';

interface Props {
  windows: ControllerLogWindow[];
  onOpen: () => void;
  className?: string;
}

const STRIP_WINDOWS = 24;
const METRIC_KEYS: ControllerMetric[] = ['ph', 'orp', 'temperature'];

/**
 * Home-screen summary of the most recent imported controller windows. It
 * is deliberately a history card, not a status card: it says how old the
 * data is and shows no Good/Watch chips, because imported windows can be
 * days old and the live telemetry cards above are the current status.
 */
export default function ControllerLogCard({ windows, onOpen, className = '' }: Props) {
  const recent = useMemo(() => {
    const device = devicesByRecency(windows)[0];
    return sortWindows(windows.filter((w) => w.deviceId === device)).slice(-STRIP_WINDOWS);
  }, [windows]);
  if (recent.length === 0) return null;
  const latest = recent[recent.length - 1];
  const t0 = recent[0].start.getTime();
  const t1 = latest.end.getTime();
  const doses = recent.filter(isDose).length;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Controller log for ${latest.deviceId}, latest window ${formatSince(latest.end)}. Open controller log.`}
      className={`w-full text-left rounded-2xl bg-surface border border-border-dim p-4 flex flex-col gap-3 active:scale-[0.99] transition-transform ${className}`}
    >
      <div className="flex justify-between items-center gap-3">
        <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
          <Gauge size={14} aria-hidden="true" />Controller Log
        </p>
        <ChevronRight size={16} className="text-ink-dim" aria-hidden="true" />
      </div>
      <p className="text-xs text-ink-muted -mt-1">
        <span className="font-mono text-ink">{latest.deviceId}</span> · imported history · latest window {formatSince(latest.end)}
      </p>
      <div className="flex flex-col divide-y divide-border-dim">
        {METRIC_KEYS.map((k) => (
          <div key={k} className="py-2 grid grid-cols-[7.5rem_1fr] items-center gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-dim">{k === 'temperature' ? 'Temp' : CONTROLLER_METRICS[k].label}</p>
              <p className="font-mono text-xs text-ink truncate">{formatRange(metricRange(latest, k), k)}</p>
            </div>
            <ControllerBandChart windows={recent} metric={k} height={30} t0={t0} t1={t1} compact axes={false} graded={false} />
          </div>
        ))}
      </div>
      <p className="text-[10px] text-ink-dim">
        Strips: last {recent.length} windows, lowest to highest each hour. Doses in that time: {doses}.
      </p>
    </button>
  );
}
