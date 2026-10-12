import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { motion } from 'motion/react';
import { Reading } from '../types';
import TrendCharts from './TrendCharts';
import { TrendMetricKey } from '../lib/trends';

interface Props {
  readings: Reading[];
  userId: string;
  /** Chart to scroll into view on open — e.g. the telemetry card that was tapped. */
  focusMetric?: TrendMetricKey;
  onLogReading: () => void;
  onBack: () => void;
}

/** Full-screen wrapper around TrendCharts (the "Trends" Operations tile / telemetry-card tap target). */
export default function TrendsView({ readings, userId, focusMetric, onLogReading, onBack }: Props) {
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
          <h1 className="text-lg font-bold text-ink tracking-tight">7-Day Trends</h1>
        </header>
        <TrendCharts readings={readings} userId={userId} onLogReading={onLogReading} focusMetric={focusMetric} />
      </div>
    </motion.div>
  );
}
