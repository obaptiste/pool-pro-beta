import React from 'react';
import { 
  X, 
  Search, 
  Book, 
  Info,
  ChevronRight,
  Terminal
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const GLOSSARY_TERMS = [
  {
    term: 'Free Chlorine (FC)',
    definition: 'The active chlorine available to sanitize water and kill algae/bacteria. This is the most critical metric for pool safety.',
    category: 'Sanitization'
  },
  {
    term: 'pH Level',
    definition: 'A measure of how acidic or basic the water is. Ideal range (7.2-7.6) ensures chlorine effectiveness and swimmer comfort.',
    category: 'Balance'
  },
  {
    term: 'Total Alkalinity (TA)',
    definition: 'The measure of alkaline substances in the water. It acts as a "buffer" for pH, preventing rapid fluctuations.',
    category: 'Balance'
  },
  {
    term: 'Calcium Hardness (CH)',
    definition: 'The amount of dissolved calcium in the water. Low levels can corrode surfaces; high levels cause scaling.',
    category: 'Structural'
  },
  {
    term: 'Cyanuric Acid (CYA)',
    definition: 'Often called "sunscreen" for chlorine. It protects chlorine from being depleted by UV rays from the sun.',
    category: 'Protection'
  },
  {
    term: 'Differential Pressure (PSI)',
    definition: 'The difference in pressure between the filter inlet and outlet. High PSI indicates a dirty filter that needs cleaning.',
    category: 'Filtration'
  },
  {
    term: 'Combined Chlorine (CC)',
    definition: 'Chlorine that has already reacted with contaminants (chloramines). High CC causes the "pool smell" and eye irritation.',
    category: 'Sanitization'
  },
  {
    term: 'Shocking',
    definition: 'The process of adding a large dose of chlorine to reach "breakpoint chlorination" and eliminate combined chlorine/algae.',
    category: 'Maintenance'
  },
  {
    term: 'Backwashing',
    definition: 'Reversing the flow of water through the filter to flush out trapped debris and lower the operating pressure.',
    category: 'Maintenance'
  },
  {
    term: 'LSI (Langelier Saturation Index)',
    definition: 'A mathematical formula used to determine if water is corrosive, balanced, or scale-forming based on multiple factors.',
    category: 'Advanced'
  }
];

export default function Glossary({ isOpen, onClose }: Props) {
  const [search, setSearch] = React.useState('');

  const filteredTerms = GLOSSARY_TERMS.filter(t => 
    t.term.toLowerCase().includes(search.toLowerCase()) || 
    t.definition.toLowerCase().includes(search.toLowerCase()) ||
    t.category.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="overlay z-[90]"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-4 md:inset-10 lg:inset-20 panel z-[100] rounded-3xl flex flex-col overflow-hidden no-print"
          >
            <header className="panel-header p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center border border-accent/20">
                  <Book size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white tracking-tight">Terminology Glossary</h2>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-ink-dim">Technical Definitions & Protocols</p>
                </div>
              </div>
              <button 
                onClick={onClose} 
                className="icon-btn border-transparent bg-transparent hover:bg-surface"
              >
                <X size={24} />
              </button>
            </header>

            <div className="p-6 border-b border-border-dim bg-bg/50">
              <div className="relative group">
                <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-dim group-focus-within:text-accent transition-colors" />
                <input 
                  type="text"
                  placeholder="Search technical terms, categories, or definitions..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="input pl-12 bg-[#060e1a] border-border-dim text-sm"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-surface">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredTerms.map((item, i) => (
                  <motion.div 
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="card bg-bg/30 border-border-dim p-5 space-y-3 group hover:border-accent/30 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-accent bg-accent/10 px-2 py-0.5 rounded border border-accent/20">
                        {item.category}
                      </span>
                      <Info size={14} className="text-ink-dim opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <h3 className="text-md font-bold text-white tracking-tight">{item.term}</h3>
                    <p className="text-xs text-ink-muted leading-relaxed font-sans">{item.definition}</p>
                    <div className="pt-2 flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-ink-dim group-hover:text-accent transition-colors">
                      <Terminal size={10} />
                      <span>Reference Protocol Active</span>
                      <ChevronRight size={10} className="ml-auto" />
                    </div>
                  </motion.div>
                ))}
              </div>

              {filteredTerms.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 space-y-4 opacity-30">
                  <Search size={48} />
                  <p className="text-xs font-bold uppercase tracking-widest">No matching terms found</p>
                </div>
              )}
            </div>

            <footer className="panel-footer p-4 text-center">
              <p className="text-[9px] font-bold uppercase tracking-widest text-ink-dim">
                PoolStatus Technical Documentation — Version 2026.03
              </p>
            </footer>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
