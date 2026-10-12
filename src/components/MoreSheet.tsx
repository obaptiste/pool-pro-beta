import React, { useRef } from 'react';
import { useModalFocus } from '../lib/useModalFocus';
import { Book, BookOpen, Bell, Download, FileText, Heart, LineChart, LogOut, Plug, Printer, Timer, Upload, Wrench, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onOpenEquipment: () => void;
  onOpenWeeklyReport: () => void;
  onOpenTrends: () => void;
  onOpenWishlist: () => void;
  onOpenWorkTracker: () => void;
  onOpenGlossary: () => void;
  onOpenCheatSheet: () => void;
  onOpenReminderSettings: () => void;
  onOpenAgents: () => void;
  onTemplateUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onExport: () => void;
  onPrint: () => void;
  onSignOut: () => void;
}

type Item = { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; onClick: () => void; tone?: 'danger' };

/** The "More" tab: everything that isn't one of the four main tabs, anchored above the tab bar. */
export default function MoreSheet({
  isOpen, onClose, onOpenEquipment, onOpenWeeklyReport, onOpenTrends, onOpenWishlist, onOpenWorkTracker, onOpenGlossary,
  onOpenCheatSheet, onOpenReminderSettings, onOpenAgents, onTemplateUpload, onExport, onPrint, onSignOut,
}: Props) {
  const run = (fn: () => void) => () => { onClose(); fn(); };
  // The file input stays hidden; the focusable button opens it, so keyboard users can upload too.
  const templateInputRef = useRef<HTMLInputElement>(null);

  const sheetRef = useModalFocus<HTMLDivElement>(isOpen, onClose);
  const items: Item[] = [
    { label: 'Equipment', icon: Wrench, onClick: run(onOpenEquipment) },
    { label: 'Weekly Report', icon: FileText, onClick: run(onOpenWeeklyReport) },
    { label: 'Trends', icon: LineChart, onClick: run(onOpenTrends) },
    { label: 'Wishlist', icon: Heart, onClick: run(onOpenWishlist) },
    { label: 'Work Tracker', icon: Timer, onClick: run(onOpenWorkTracker) },
    { label: 'Glossary', icon: Book, onClick: run(onOpenGlossary) },
    { label: 'Cheat Sheet', icon: BookOpen, onClick: run(onOpenCheatSheet) },
    { label: 'Reminders', icon: Bell, onClick: run(onOpenReminderSettings) },
    { label: 'Connected Agents (MCP)', icon: Plug, onClick: run(onOpenAgents) },
    { label: 'Export CSV', icon: Download, onClick: run(onExport) },
    { label: 'Print', icon: Printer, onClick: run(onPrint) },
    { label: 'Sign Out', icon: LogOut, onClick: run(onSignOut), tone: 'danger' },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="more-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[52] bg-bg/60"
            aria-hidden="true"
          />
          <motion.div
            ref={sheetRef}
            tabIndex={-1}
            key="more-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="More"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed left-3 right-3 z-[53] mx-auto max-w-md rounded-2xl bg-surface border border-border-dim shadow-[0_20px_40px_rgba(0,0,0,0.5)] p-4 flex flex-col gap-3 max-h-[70vh]"
            style={{ bottom: 'calc(76px + env(safe-area-inset-bottom))' }}
          >
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-dim">More</p>
              <button type="button" onClick={onClose} aria-label="Close" className="-m-2 p-2 text-ink-dim hover:text-white"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 overflow-y-auto custom-scrollbar">
              {items.map(({ label, icon: Icon, onClick, tone }) => (
                <button
                  key={label}
                  type="button"
                  onClick={onClick}
                  className={`h-12 px-3 rounded-[10px] bg-surface-2 border border-border-dim flex items-center gap-2.5 text-left text-[10px] font-bold uppercase tracking-[0.12em] active:scale-95 transition-transform ${tone === 'danger' ? 'text-red-400' : 'text-white'}`}
                >
                  <Icon size={14} className={tone === 'danger' ? 'text-red-400' : 'text-accent'} />
                  <span className="truncate">{label}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => templateInputRef.current?.click()}
                className="h-12 px-3 rounded-[10px] bg-surface-2 border border-border-dim flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white active:scale-95 transition-transform"
              >
                <Upload size={14} className="text-accent" />
                <span className="truncate">Report Template</span>
              </button>
              <input
                ref={templateInputRef}
                type="file"
                accept=".txt,.md,.csv"
                onChange={(e) => { onTemplateUpload(e); onClose(); }}
                className="hidden"
                tabIndex={-1}
                aria-hidden="true"
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
