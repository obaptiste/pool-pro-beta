import React from 'react';
import { ChevronLeft, Calendar, Clock, Droplets, Activity, Thermometer, TrendingUp, FileText, Trash2, Gauge, Waves, Sun } from 'lucide-react';
import { motion } from 'motion/react';
import { Reading } from '../types';
import { format } from 'date-fns';

interface Props {
  readings: Reading[];
  onBack: () => void;
  onDelete: (id: string) => void;
}

export default function History({ readings, onBack, onDelete }: Props) {
  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="fixed inset-0 z-50 bg-bg overflow-y-auto anim-fade-up"
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

        <div className="space-y-4">
          {readings.length === 0 ? (
            <div className="card bg-bg/40 border-border-dim p-12 text-center space-y-4">
              <div className="text-4xl opacity-20">⬡</div>
              <p className="text-sm font-bold uppercase tracking-widest text-ink-muted">No Logs Found</p>
            </div>
          ) : (
            readings.map((reading) => (
              <div key={reading.id} className="card anim-scan bg-surface border-border-dim p-0 overflow-hidden group">
                <div className="grid grid-cols-1 md:grid-cols-4">
                  {/* Date/Time Sidebar */}
                  <div className="bg-bg p-4 flex flex-col justify-center border-r border-border-dim md:col-span-1">
                    <div className="flex items-center gap-2 text-accent mb-1">
                      <Calendar size={14} />
                      <span className="text-xs font-bold font-mono">{format(reading.timestamp, 'MMM d, yyyy')}</span>
                    </div>
                    <div className="flex items-center gap-2 text-ink-dim">
                      <Clock size={14} />
                      <span className="text-[10px] font-bold font-mono uppercase tracking-widest">{format(reading.timestamp, 'HH:mm:ss')}</span>
                    </div>
                  </div>

                  {/* Data Grid */}
                  <div className="p-4 md:col-span-3 flex flex-col justify-between gap-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
                      <DataPoint label="Chlorine" value={reading.chlorine} unit="ppm" icon={<Droplets size={12} />} color="text-sky-400" />
                      <DataPoint label="pH Level" value={reading.ph} unit="" icon={<Activity size={12} />} color="text-emerald-400" />
                      <DataPoint label="Alkalinity" value={reading.alkalinity} unit="ppm" icon={<TrendingUp size={12} />} color="text-amber-400" />
                      <DataPoint label="Temp" value={reading.temperature} unit="°C" icon={<Thermometer size={12} />} color="text-red-400" />
                      <DataPoint label="Pressure" value={reading.differentialPressure} unit="PSI" icon={<Gauge size={12} />} color="text-indigo-400" />
                      <DataPoint label="Calcium" value={reading.calciumHardness} unit="ppm" icon={<Waves size={12} />} color="text-cyan-400" />
                      <DataPoint label="CYA" value={reading.cyanuricAcid} unit="ppm" icon={<Sun size={12} />} color="text-yellow-400" />
                    </div>

                    {reading.notes && (
                      <div className="flex gap-2 p-3 bg-bg/60 rounded-lg border border-border-dim/30">
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
              </div>
            ))
          )}
        </div>
      </div>
    </motion.div>
  );
}

function DataPoint({ label, value, unit, icon, color }: any) {
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
