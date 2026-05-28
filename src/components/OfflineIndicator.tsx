import React from 'react';
import { Wifi, WifiOff, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  isOnline: boolean;
  lastSaved?: Date;
}

export default function OfflineIndicator({ isOnline, lastSaved }: Props) {
  return (
    <>
      <div className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 overflow-hidden ${isOnline ? 'h-0' : 'h-10'}`}>
        <div className={`flex items-center justify-center h-full px-4 text-[10px] font-bold uppercase tracking-widest ${isOnline ? 'bg-success text-primary' : 'bg-warning text-primary'}`}>
          {isOnline ? (
            <div className="flex items-center gap-2">
              <Wifi size={14} />
              <span>Telemetry Link Restored</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <WifiOff size={14} />
              <span>Offline Mode — Local Cache Active</span>
            </div>
          )}
        </div>
      </div>
      <AnimatePresence>
        {isOnline && lastSaved && (
          <motion.div
            key={lastSaved.getTime()}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed top-16 right-4 md:right-6 z-40 bg-[#0d1f38]/90 backdrop-blur-md border border-border-dim rounded-full px-3 py-1.5 shadow-2xl flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-ink-dim"
          >
            <CheckCircle2 size={12} className="text-success" />
            <span>Synced {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
