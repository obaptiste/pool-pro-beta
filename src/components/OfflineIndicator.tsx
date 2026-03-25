import React from 'react';
import { Wifi, WifiOff, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  isOnline: boolean;
  lastSaved?: Date;
}

export default function OfflineIndicator({ isOnline, lastSaved }: Props) {
  return (
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
      {isOnline && lastSaved && (
        <AnimatePresence>
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-14 right-6 bg-[#0d1f38]/90 backdrop-blur-md border border-border-dim rounded-full px-4 py-1.5 shadow-2xl flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-ink-dim"
          >
            <CheckCircle2 size={12} className="text-success" />
            <span>Database Synced: {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
