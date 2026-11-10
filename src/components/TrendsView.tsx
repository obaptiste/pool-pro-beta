import React from 'react';
import { Check, ChevronDown, ChevronLeft } from 'lucide-react';
import { motion } from 'motion/react';
import { Reading } from '../types';
import TrendCharts from './TrendCharts';
import {
  DEFAULT_TREND_RANGE,
  getTrendRangeOption,
  isTrendRange,
  TREND_RANGE_OPTIONS,
  TrendMetricKey,
  TrendRange,
} from '../lib/trends';

interface Props {
  readings: Reading[];
  userId: string;
  /** Chart to scroll into view on open — e.g. the telemetry card that was tapped. */
  focusMetric?: TrendMetricKey;
  onLogReading: () => void;
  onBack: () => void;
}

const readStoredRange = (key: string): TrendRange => {
  try {
    const stored = localStorage.getItem(key);
    return isTrendRange(stored) ? stored : DEFAULT_TREND_RANGE;
  } catch {
    return DEFAULT_TREND_RANGE;
  }
};

/** Full-screen wrapper around TrendCharts (the "Trends" Operations tile / telemetry-card tap target). */
export default function TrendsView({ readings, userId, focusMetric, onLogReading, onBack }: Props) {
  const rangeKey = `poolpro:trend-range:${userId}`;
  const [range, setRange] = React.useState<TrendRange>(() => readStoredRange(rangeKey));

  const selectRange = (next: TrendRange) => {
    setRange(next);
    try {
      localStorage.setItem(rangeKey, next);
    } catch {
      // Private mode / storage full: the choice still applies for this visit.
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="fixed inset-0 z-50 bg-bg overflow-y-auto"
    >
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6" style={{ paddingBottom: 'calc(120px + env(safe-area-inset-bottom))' }}>
        <header className="flex items-center justify-between border-b border-border-dim pb-6">
          <button onClick={onBack} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-ink-dim hover:text-accent transition-colors min-h-11">
            <ChevronLeft size={16} /> Back to Dashboard
          </button>
          <RangePicker range={range} onSelect={selectRange} />
        </header>
        <TrendCharts readings={readings} userId={userId} range={range} onLogReading={onLogReading} focusMetric={focusMetric} />
      </div>
    </motion.div>
  );
}

/** The page title doubles as the range switcher: tap "7-Day Trends" to pick 4 / 7 / 14 days or all time. */
function RangePicker({ range, onSelect }: { range: TrendRange; onSelect: (range: TrendRange) => void }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const listId = React.useId();
  const current = getTrendRangeOption(range);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    // Move focus to the selected option so keyboard users land inside the menu.
    rootRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const choose = (value: TrendRange) => {
    onSelect(value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <h1 className="m-0">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={`${current.title}. Change time range`}
          className="flex items-center gap-1.5 min-h-11 rounded-lg px-2 -mr-2 text-lg font-bold text-ink tracking-tight hover:text-accent focus-visible:outline-2 focus-visible:outline-accent transition-colors"
        >
          {current.title}
          <ChevronDown size={18} aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </h1>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Trend time range"
          className="absolute right-0 top-full z-10 mt-2 w-44 overflow-hidden rounded-xl border border-border-dim bg-surface-2 py-1 shadow-xl"
        >
          {TREND_RANGE_OPTIONS.map((option) => {
            const selected = option.value === range;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => choose(option.value)}
                className={`flex w-full items-center justify-between min-h-11 px-4 text-[11px] font-bold uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:bg-accent/10 hover:bg-accent/10 ${selected ? 'text-accent' : 'text-ink-muted'}`}
              >
                {option.label}
                {selected && <Check size={14} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
