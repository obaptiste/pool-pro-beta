import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Reading, MaintenanceTask, InventoryItem, Equipment } from './types';
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
  { id: '6', title: 'Vacuum the entire pool', completed: false },
  { id: '7', title: 'Brush walls and floors', completed: false },
  { id: '8', title: 'Check heating is running properly', completed: false },
];

const INITIAL_MONTHLY_TASKS: MaintenanceTask[] = [
  { id: 'm1', title: 'Deep clean filter media or replace cartridge', completed: false, frequency: 'monthly' },
  { id: 'm2', title: 'Inspect pump seals and gaskets for leaks', completed: false, frequency: 'monthly' },
  { id: 'm3', title: 'Lubricate o-rings and valve fittings', completed: false, frequency: 'monthly' },
  { id: 'm4', title: 'Check and calibrate automatic chemical dosing system', completed: false, frequency: 'monthly' },
  { id: 'm5', title: 'Inspect pool lighting and replace bulbs if needed', completed: false, frequency: 'monthly' },
  { id: 'm6', title: 'Test and inspect safety equipment (life rings, hooks)', completed: false, frequency: 'monthly' },
  { id: 'm7', title: 'Check pool fence and gate latch operation', completed: false, frequency: 'monthly' },
  { id: 'm8', title: 'Inspect pool cover for damage or wear', completed: false, frequency: 'monthly' },
  { id: 'm9', title: 'Clean pool deck and surrounding area', completed: false, frequency: 'monthly' },
  { id: 'm10', title: 'Review and restock chemical inventory', completed: false, frequency: 'monthly' },
];

const INITIAL_INVENTORY: InventoryItem[] = [
  { id: 'i1', name: 'Chlorine Tablets', quantity: 5, unit: 'kg', lowThreshold: 2, category: 'chemical' },
  { id: 'i2', name: 'pH Down (Muriatic Acid)', quantity: 3, unit: 'L', lowThreshold: 1, category: 'chemical' },
  { id: 'i3', name: 'pH Up (Soda Ash)', quantity: 2, unit: 'kg', lowThreshold: 1, category: 'chemical' },
  { id: 'i4', name: 'Algaecide', quantity: 0.5, unit: 'L', lowThreshold: 1, category: 'chemical' },
  { id: 'i5', name: 'Sodium Bicarbonate', quantity: 10, unit: 'kg', lowThreshold: 3, category: 'chemical' },
  { id: 'i6', name: 'Pool Shock (Calcium Hypochlorite)', quantity: 3, unit: 'kg', lowThreshold: 1, category: 'chemical' },
  { id: 'i7', name: 'Stabilizer / CYA', quantity: 4, unit: 'kg', lowThreshold: 2, category: 'chemical' },
  { id: 'i8', name: 'Test Strips', quantity: 15, unit: 'pcs', lowThreshold: 20, category: 'supplies' },
  { id: 'i9', name: 'Filter Sand', quantity: 25, unit: 'kg', lowThreshold: 10, category: 'supplies' },
  { id: 'i10', name: 'O-Ring Lubricant', quantity: 1, unit: 'tube', lowThreshold: 1, category: 'supplies' },
  { id: 'i11', name: 'Vacuum Hose', quantity: 1, unit: 'pcs', lowThreshold: 1, category: 'equipment' },
  { id: 'i12', name: 'Skimmer Nets', quantity: 2, unit: 'pcs', lowThreshold: 1, category: 'equipment' },
];

const INITIAL_EQUIPMENT: Equipment[] = [
  { id: 'e1', name: 'Main Circulation Pump', type: 'Pump', status: 'operational', lastChecked: new Date().toISOString().split('T')[0] },
  { id: 'e2', name: 'Sand Filter System', type: 'Filtration', status: 'operational', lastChecked: new Date().toISOString().split('T')[0] },
  { id: 'e3', name: 'Pool Heater', type: 'Heating', status: 'operational', lastChecked: new Date().toISOString().split('T')[0] },
  { id: 'e4', name: 'Skimmer System', type: 'Skimming', status: 'operational', lastChecked: new Date().toISOString().split('T')[0] },
  { id: 'e5', name: 'Chemical Dosing Pump', type: 'Chemical', status: 'needs-attention', lastChecked: new Date().toISOString().split('T')[0], notes: 'Calibration required' },
  { id: 'e6', name: 'Pool Vacuum', type: 'Cleaning', status: 'operational', lastChecked: new Date().toISOString().split('T')[0] },
  { id: 'e7', name: 'UV Sanitiser', type: 'Sanitation', status: 'operational', lastChecked: new Date().toISOString().split('T')[0] },
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

  const [monthlyTasks, setMonthlyTasks] = useState<MaintenanceTask[]>(() => {
    const saved = localStorage.getItem('pool_monthly_tasks');
    return saved ? JSON.parse(saved) : INITIAL_MONTHLY_TASKS;
  });

  const [inventory, setInventory] = useState<InventoryItem[]>(() => {
    const saved = localStorage.getItem('pool_inventory');
    return saved ? JSON.parse(saved) : INITIAL_INVENTORY;
  });

  const [equipment, setEquipment] = useState<Equipment[]>(() => {
    const saved = localStorage.getItem('pool_equipment');
    return saved ? JSON.parse(saved) : INITIAL_EQUIPMENT;
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
    localStorage.setItem('pool_monthly_tasks', JSON.stringify(monthlyTasks));
    localStorage.setItem('pool_inventory', JSON.stringify(inventory));
    localStorage.setItem('pool_equipment', JSON.stringify(equipment));
    setLastSaved(new Date());
  }, [readings, tasks, monthlyTasks, inventory, equipment]);

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

  const toggleMonthlyTask = (id: string) => {
    setMonthlyTasks(monthlyTasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  const updateInventoryQuantity = (id: string, quantity: number) => {
    setInventory(inventory.map(item => item.id === id ? { ...item, quantity: Math.max(0, quantity) } : item));
  };

  const updateEquipmentStatus = (id: string, status: Equipment['status']) => {
    setEquipment(equipment.map(e => e.id === id ? { ...e, status, lastChecked: new Date().toISOString().split('T')[0] } : e));
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
          monthlyTasks={monthlyTasks}
          inventory={inventory}
          equipment={equipment}
          onLogReading={() => setIsLogging(true)}
          onOpenCheatSheet={() => setIsCheatSheetOpen(true)}
          onOpenGlossary={() => setIsGlossaryOpen(true)}
          onViewHistory={() => setIsHistoryOpen(true)}
          onExport={exportToCSV}
          onPrint={() => window.print()}
          toggleTask={toggleTask}
          toggleMonthlyTask={toggleMonthlyTask}
          onUpdateInventoryQuantity={updateInventoryQuantity}
          onUpdateEquipmentStatus={updateEquipmentStatus}
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
