import React from 'react';
import { Bell, BellOff, Calendar, Clock, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MaintenanceSchedule, Frequency } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  schedule: MaintenanceSchedule;
  onUpdateSchedule: (schedule: MaintenanceSchedule) => void;
}

const FREQUENCIES: { value: Frequency; label: string; days: number }[] = [
  { value: 'daily', label: 'Daily', days: 1 },
  { value: 'weekly', label: 'Weekly', days: 7 },
  { value: 'biweekly', label: 'Bi-Weekly', days: 14 },
  { value: 'monthly', label: 'Monthly', days: 30 },
];

export default function ReminderSettings({ isOpen, onClose, schedule, onUpdateSchedule }: Props) {
  const requestPermission = async () => {
    if (!('Notification' in window)) {
      alert('This browser does not support desktop notifications');
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      onUpdateSchedule({ ...schedule, remindersEnabled: true });
    } else {
      alert('Notification permission denied');
    }
  };

  const handleFrequencyChange = (freq: Frequency) => {
    const frequencyObj = FREQUENCIES.find(f => f.value === freq);
    if (!frequencyObj) return;

    const lastTest = schedule.lastTestDate || new Date();
    const nextTest = new Date(lastTest);
    nextTest.setDate(nextTest.getDate() + frequencyObj.days);

    onUpdateSchedule({
      ...schedule,
      testFrequency: freq,
      nextTestDate: nextTest,
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="overlay z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="w-full max-w-md panel rounded-2xl overflow-hidden anim-fade-up"
          >
            <header className="panel-header p-4 flex items-center justify-between">
              <div className="flex items-center gap-3 text-accent font-bold text-[10px] uppercase tracking-widest">
                <Bell size={14} />
                <span>Test Reminders</span>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-surface rounded-lg transition-colors text-ink-dim hover:text-white"
              >
                <X size={16} />
              </button>
            </header>

            <div className="p-6 space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-ink">Enable Notifications</h3>
                    <p className="text-[10px] text-ink-dim">Get alerted when it's time to test</p>
                  </div>
                  <button
                    onClick={() => schedule.remindersEnabled ? onUpdateSchedule({ ...schedule, remindersEnabled: false }) : requestPermission()}
                    className={`w-12 h-6 rounded-full transition-colors relative ${schedule.remindersEnabled ? 'bg-accent' : 'bg-surface border border-border-dim'}`}
                  >
                    <motion.div
                      animate={{ x: schedule.remindersEnabled ? 26 : 2 }}
                      className="absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm"
                    />
                  </button>
                </div>

                <div className="space-y-3">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">Testing Frequency</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {FREQUENCIES.map((freq) => (
                      <button
                        key={freq.value}
                        onClick={() => handleFrequencyChange(freq.value)}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          schedule.testFrequency === freq.value
                            ? 'bg-accent/10 border-accent text-accent'
                            : 'bg-surface border-border-dim text-ink-dim hover:border-accent/30'
                        }`}
                      >
                        <div className="text-xs font-bold">{freq.label}</div>
                        <div className="text-[9px] opacity-60">Every {freq.days} {freq.days === 1 ? 'day' : 'days'}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {schedule.nextTestDate && (
                  <div className="p-4 bg-surface rounded-xl border border-border-dim flex items-center gap-4 anim-scan">
                    <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent">
                      <Calendar size={20} />
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">Next Scheduled Test</div>
                      <div className="text-sm text-ink font-mono">
                        {new Date(schedule.nextTestDate).toLocaleDateString(undefined, { 
                          weekday: 'short', 
                          month: 'short', 
                          day: 'numeric' 
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <footer className="panel-footer p-4">
              <button
                onClick={onClose}
                className="w-full py-3 rounded-xl bg-accent text-primary text-[10px] font-bold uppercase tracking-widest hover:brightness-110 transition-all"
              >
                Save Settings
              </button>
            </footer>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
