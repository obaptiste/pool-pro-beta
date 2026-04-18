import React, { useState } from 'react';
import { 
  X, 
  Volume2, 
  Sparkles, 
  ShieldCheck, 
  Clock, 
  Zap, 
  Star,
  ChevronRight,
  BookOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function CheatSheet({ isOpen, onClose }: Props) {
  const [simplified, setSimplified] = useState(false);

  const sections = [
    {
      title: 'Golden Parameters',
      icon: <Star size={16} className="text-amber-400" />,
      items: [
        { label: 'Free Chlorine', value: '1.0 - 3.0 ppm', desc: 'Primary sanitization' },
        { label: 'pH Level', value: '7.2 - 7.6', desc: 'Water balance & comfort' },
        { label: 'Total Alkalinity', value: '80 - 120 ppm', desc: 'pH buffering capacity' },
        { label: 'Calcium Hardness', value: '200 - 400 ppm', desc: 'Structural protection' },
      ]
    },
    {
      title: 'Operational Protocol',
      icon: <Clock size={16} className="text-accent" />,
      items: [
        { label: 'Skimmer Baskets', value: 'Clear Debris', desc: 'Daily inspection' },
        { label: 'Pump Strainer', value: 'Verify Flow', desc: 'Daily inspection' },
        { label: 'Water Level', value: 'Mid-Skimmer', desc: 'Maintain equilibrium' },
        { label: 'Filter Pressure', value: 'Monitor PSI', desc: 'Backwash if +10 PSI' },
      ]
    },
    {
      title: 'Diagnostic Codes',
      icon: <Zap size={16} className="text-critical" />,
      items: [
        { label: 'Turbid Water', value: 'Check Filtration', desc: 'High pH or low CL' },
        { label: 'Algae Bloom', value: 'Shock Protocol', desc: 'Hyper-chlorination' },
        { label: 'Ocular Stress', value: 'Verify pH', desc: 'Acid/Base imbalance' },
        { label: 'Chemical Odor', value: 'Combined CL', desc: 'Breakpoint chlorination' },
      ]
    },
    {
      title: 'Safety Directives',
      icon: <ShieldCheck size={16} className="text-emerald-400" />,
      items: [
        { label: 'Storage', value: 'Dry & Isolated', desc: 'Prevent cross-reaction' },
        { label: 'PPE Protocol', value: 'Eyes & Dermal', desc: 'Handling concentrates' },
        { label: 'Ventilation', value: 'Active Airflow', desc: 'Chemical containment' },
      ]
    }
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="overlay z-[60]"
          />
          <motion.div 
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-md panel z-[70] border-l border-border-dim flex flex-col no-print rounded-none"
          >
            <header className="panel-header p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center border border-accent/20">
                  <BookOpen size={20} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white tracking-tight">Technical Reference</h2>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-ink-dim">Maintenance Protocol v2.4</p>
                </div>
              </div>
              <button 
                onClick={onClose} 
                className="icon-btn border-transparent bg-transparent hover:bg-surface"
              >
                <X size={20} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-6 space-y-10 custom-scrollbar">
              <div className="flex items-center justify-between p-4 bg-bg/70 rounded-xl border border-border-dim">
                <div className="flex items-center gap-3">
                  <Sparkles size={14} className="text-accent" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">Simplified View</span>
                </div>
                <button 
                  onClick={() => setSimplified(!simplified)}
                  className={`w-10 h-5 rounded-full transition-all relative ${simplified ? 'bg-accent' : 'bg-surface border border-border-dim'}`}
                >
                  <motion.div 
                    animate={{ x: simplified ? 22 : 2 }}
                    className={`absolute top-0.5 w-3.5 h-3.5 rounded-full shadow-sm ${simplified ? 'bg-primary' : 'bg-ink-dim'}`}
                  />
                </button>
              </div>

              {sections.map((section, i) => (
                <section key={i} className="space-y-4">
                  <div className="flex items-center gap-2 border-b border-border-dim/30 pb-2">
                    {section.icon}
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">{section.title}</h3>
                  </div>
                  <div className="grid gap-3">
                    {section.items.map((item, j) => (
                        <div key={j} className="card bg-bg/30 border-border-dim p-4 flex items-center justify-between group hover:border-accent/50 transition-all">
                        <div className="space-y-1">
                          <p className="text-[9px] font-bold text-ink-dim uppercase tracking-widest">{item.label}</p>
                          <p className="text-sm font-bold text-white font-mono">{item.value}</p>
                          {!simplified && <p className="text-[10px] text-ink-dim/70 leading-relaxed italic">{item.desc}</p>}
                        </div>
                        <ChevronRight size={14} className="text-border-dim group-hover:text-accent transition-colors" />
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <footer className="panel-footer p-6">
              <button className="flex items-center justify-center gap-2 w-full py-4 rounded-xl bg-surface border border-border-dim text-[10px] font-bold uppercase tracking-widest text-ink-dim hover:text-white transition-all">
                <Volume2 size={16} />
                Audio Protocol Summary
              </button>
            </footer>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
