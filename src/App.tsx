import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Reading, MaintenanceTask } from './types';
import Dashboard from './components/Dashboard';
import ReadingForm from './components/ReadingForm';
import CheatSheet from './components/CheatSheet';
import OfflineIndicator from './components/OfflineIndicator';
import GeminiAssistant from './components/GeminiAssistant';
import History from './components/History';
import Glossary from './components/Glossary';

const INITIAL_TASKS: MaintenanceTask[] = [
  { id: '1', title: 'Empty skimmer baskets', completed: false },
  { id: '2', title: 'Check pump strainer', completed: false },
  { id: '3', title: 'Inspect water level', completed: false },
  { id: '4', title: 'Test chemical levels', completed: true },
  { id: '5', title: 'Backwash filter (if needed)', completed: false },
];

const INITIAL_READINGS: Reading[] = [
  {
    id: '1',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2),
    chlorine: 1.2,
    ph: 7.8,
    alkalinity: 110,
    temperature: 27,
    differentialPressure: 12,
    notes: 'Morning check. Water looks clear.',
  },
  {
    id: '2',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24),
    chlorine: 2.1,
    ph: 7.4,
    alkalinity: 100,
    temperature: 26,
    differentialPressure: 11,
    notes: 'Standard reading.',
  },
];

export default function App() {
  const [readings, setReadings] = useState<Reading[]>(() => {
    const saved = localStorage.getItem('pool_readings');
    if (saved) {
      return JSON.parse(saved).map((r: any) => ({ ...r, timestamp: new Date(r.timestamp) }));
    }
    return INITIAL_READINGS;
  });

  const [tasks, setTasks] = useState<MaintenanceTask[]>(() => {
    const saved = localStorage.getItem('pool_tasks');
    return saved ? JSON.parse(saved) : INITIAL_TASKS;
  });

  const [isLogging, setIsLogging] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isCheatSheetOpen, setIsCheatSheetOpen] = useState(false);
  const [isGlossaryOpen, setIsGlossaryOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastSaved, setLastSaved] = useState<Date | undefined>();

  useEffect(() => {
    localStorage.setItem('pool_readings', JSON.stringify(readings));
    localStorage.setItem('pool_tasks', JSON.stringify(tasks));
    setLastSaved(new Date());
  }, [readings, tasks]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleSaveReading = (newReading: Omit<Reading, 'id' | 'timestamp'>) => {
    const reading: Reading = {
      ...newReading,
      id: Date.now().toString(),
      timestamp: new Date(),
    };
    setReadings([reading, ...readings]);
    setIsLogging(false);
  };

  const handleDeleteReading = (id: string) => {
    setReadings(readings.filter(r => r.id !== id));
  };

  const toggleTask = (id: string) => {
    setTasks(tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  const exportToCSV = () => {
    const headers = ['Timestamp', 'Chlorine (ppm)', 'pH', 'Alkalinity (ppm)', 'Temp (°C)', 'Diff Pressure (PSI)', 'Notes'];
    const rows = readings.map(r => [
      r.timestamp.toISOString(),
      r.chlorine,
      r.ph,
      r.alkalinity,
      r.temperature,
      r.differentialPressure,
      r.notes || '',
    ]);
    
    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `pool_report_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-[#060e1a] text-ink selection:bg-accent/30 selection:text-white">
      <OfflineIndicator isOnline={isOnline} lastSaved={lastSaved} />
      
      <main className="max-w-4xl mx-auto px-4 pt-16 pb-24 md:pt-20">
        <Dashboard 
          readings={readings} 
          tasks={tasks}
          onLogReading={() => setIsLogging(true)}
          onOpenCheatSheet={() => setIsCheatSheetOpen(true)}
          onOpenGlossary={() => setIsGlossaryOpen(true)}
          onViewHistory={() => setIsHistoryOpen(true)}
          onExport={exportToCSV}
          onPrint={() => window.print()}
          toggleTask={toggleTask}
        />
      </main>

      <AnimatePresence>
        {isLogging && (
          <ReadingForm 
            onSave={handleSaveReading}
            onCancel={() => setIsLogging(false)}
          />
        )}
        
        {isHistoryOpen && (
          <History 
            readings={readings}
            onBack={() => setIsHistoryOpen(false)}
            onDelete={handleDeleteReading}
          />
        )}
      </AnimatePresence>

      <CheatSheet 
        isOpen={isCheatSheetOpen}
        onClose={() => setIsCheatSheetOpen(false)}
      />

      <Glossary 
        isOpen={isGlossaryOpen}
        onClose={() => setIsGlossaryOpen(false)}
      />

      <GeminiAssistant latestReading={readings[0]} />
    </div>
  );
}
