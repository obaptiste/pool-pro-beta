import React from 'react';
import {
  Droplets,
  Thermometer,
  Activity,
  AlertCircle,
  Plus,
  BookOpen,
  Book,
  Download,
  CheckCircle2,
  Circle,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Printer,
  LayoutDashboard,
  LineChart as LineChartIcon,
  X,
  Sparkles,
  CalendarDays,
  Package,
  RotateCcw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Reading, MaintenanceTask, InventoryItem, Equipment, DEFAULT_RANGES, Status } from '../types';
import TrendCharts from './TrendCharts';
import Inventory from './Inventory';

interface Props {
  readings: Reading[];
  tasks: MaintenanceTask[];
  monthlyTasks: MaintenanceTask[];
  inventory: InventoryItem[];
  equipment: Equipment[];
  onLogReading: () => void;
  onOpenCheatSheet: () => void;
  onOpenGlossary: () => void;
  onViewHistory: () => void;
  onExport: () => void;
  onPrint: () => void;
  toggleTask: (id: string) => void;
  toggleMonthlyTask: (id: string) => void;
  onUpdateInventoryQuantity: (id: string, quantity: number) => void;
  onUpdateEquipmentStatus: (id: string, status: Equipment['status']) => void;
}

type Tab = 'overview' | 'monthly' | 'trends' | 'inventory';

export default function Dashboard({
  readings, tasks, monthlyTasks, inventory, equipment,
  onLogReading, onOpenCheatSheet, onOpenGlossary, onViewHistory,
  onExport, onPrint, toggleTask, toggleMonthlyTask,
  onUpdateInventoryQuantity, onUpdateEquipmentStatus,
}: Props) {
  const [activeTab, setActiveTab] = React.useState<Tab>('overview');
  const [dismissedAlerts, setDismissedAlerts] = React.useState<string[]>([]);
  const latest = readings[0];

  React.useEffect(() => {
    if (latest?.id) {
      setDismissedAlerts([]);
    }
  }, [latest?.id]);

  const getStatus = (value: number, min: number, max: number): Status => {
    if (value < min || value > max) return 'critical';
    const range = max - min;
    const buffer = range * 0.1;
    if (value < min + buffer || value > max - buffer) return 'warning';
    return 'good';
  };

  const allAlerts = latest ? [
    {
      id: 'cl_low',
      type: 'chlorine',
      condition: latest.chlorine < DEFAULT_RANGES.chlorine.min,
      msg: 'Free chlorine critically low — pool unsafe. Dose now.',
      action: 'Add chlorine or shock treatment immediately.',
      severity: 'critical'
    },
    {
      id: 'cl_high',
      type: 'chlorine',
      condition: latest.chlorine > DEFAULT_RANGES.chlorine.max,
      msg: 'Chlorine elevated — likely post-shock.',
      action: 'Stop chlorination and wait for levels to drop.',
      severity: 'warning'
    },
    {
      id: 'ph_low',
      type: 'ph',
      condition: latest.ph < DEFAULT_RANGES.ph.min,
      msg: 'pH too low — corrosive water.',
      action: 'Add sodium carbonate (Soda Ash).',
      severity: 'critical'
    },
    {
      id: 'ph_high',
      type: 'ph',
      condition: latest.ph > DEFAULT_RANGES.ph.max,
      msg: 'pH too high — chlorine less effective.',
      action: 'Add muriatic acid.',
      severity: 'warning'
    },
    {
      id: 'alk_low',
      type: 'alkalinity',
      condition: latest.alkalinity < DEFAULT_RANGES.alkalinity.min,
      msg: 'Low alkalinity — pH will be unstable.',
      action: 'Add sodium bicarbonate.',
      severity: 'warning'
    },
    {
      id: 'alk_high',
      type: 'alkalinity',
      condition: latest.alkalinity > DEFAULT_RANGES.alkalinity.max,
      msg: 'Alkalinity is too high.',
      action: 'Add pH decreaser or partially drain.',
      severity: 'warning'
    },
    {
      id: 'dp_high',
      type: 'pressure',
      condition: latest.differentialPressure > DEFAULT_RANGES.differentialPressure.max,
      msg: 'Filter pressure elevated — flow restricted.',
      action: 'Backwash filter or clean cartridges immediately.',
      severity: 'critical'
    }
  ].filter(a => a.condition && !dismissedAlerts.includes(a.id)) : [];

  const dismissAlert = (id: string) => {
    setDismissedAlerts(prev => [...prev, id]);
  };

  const getTrendData = (key: keyof Reading) => {
    return readings.slice(0, 7).map(r => r[key] as number).reverse();
  };

  const lowInventoryCount = inventory.filter(item => item.quantity <= item.lowThreshold).length;
  const monthlyCompleted = monthlyTasks.filter(t => t.completed).length;

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={13} /> },
    { id: 'monthly', label: 'Monthly', icon: <CalendarDays size={13} />, badge: monthlyCompleted > 0 ? monthlyCompleted : undefined },
    { id: 'trends', label: 'Trends', icon: <LineChartIcon size={13} /> },
    { id: 'inventory', label: 'Inventory', icon: <Package size={13} />, badge: lowInventoryCount > 0 ? lowInventoryCount : undefined },
  ];

  return (
    <div className="space-y-6 pb-24">
      {/* Header Section */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wider uppercase" style={{ fontFamily: "'Exo 2', sans-serif" }}>
            Pool<span className="text-accent">Status</span>
          </h1>
          <p className="text-[10px] font-mono text-ink-dim uppercase tracking-widest">
            Last reading: {latest ? latest.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'No data'}
          </p>
        </div>
        <div className="flex gap-2 no-print">
          <button onClick={onPrint} className="p-2 rounded-lg bg-surface border border-border-dim text-ink-muted hover:text-white transition-colors">
            <Printer size={18} />
          </button>
          <button onClick={onExport} className="p-2 rounded-lg bg-surface border border-border-dim text-ink-muted hover:text-white transition-colors">
            <Download size={18} />
          </button>
          <button onClick={onOpenCheatSheet} className="p-2 rounded-lg bg-surface border border-border-dim text-ink-muted hover:text-white transition-colors" title="Technical Reference">
            <BookOpen size={18} />
          </button>
          <button onClick={onOpenGlossary} className="p-2 rounded-lg bg-surface border border-border-dim text-ink-muted hover:text-white transition-colors" title="Glossary">
            <Book size={18} />
          </button>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="flex p-1 bg-[#0a1628] border border-border-dim rounded-xl no-print gap-0.5">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`relative flex-1 flex items-center justify-center gap-1.5 py-2 text-[9px] font-bold uppercase tracking-widest rounded-lg transition-all ${
              activeTab === tab.id ? 'bg-accent text-primary shadow-lg' : 'text-ink-dim hover:text-ink-muted'
            }`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
            {tab.badge !== undefined && (
              <span className={`absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center rounded-full text-[8px] font-bold px-0.5 ${
                activeTab === tab.id ? 'bg-primary text-accent' : 'bg-amber-500 text-primary'
              }`}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {/* Alert Panel */}
            <AnimatePresence>
              {allAlerts.length > 0 && (
                <div className="space-y-2 no-print">
                  {allAlerts.map((alert: any) => (
                    <motion.div
                      key={alert.id}
                      initial={{ opacity: 0, height: 0, scale: 0.95 }}
                      animate={{ opacity: 1, height: 'auto', scale: 1 }}
                      exit={{ opacity: 0, height: 0, scale: 0.95 }}
                      className={`p-3 rounded-xl border flex gap-3 relative overflow-hidden ${
                        alert.severity === 'critical'
                          ? 'bg-critical/10 border-critical/30 text-red-300'
                          : 'bg-warning/10 border-warning/30 text-amber-300'
                      }`}
                    >
                      <div className="mt-0.5">
                        <AlertCircle size={16} />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-bold uppercase tracking-wider mb-1">
                          {alert.msg}
                        </p>
                        <p className="text-[10px] opacity-80 leading-relaxed">
                          <span className="font-bold">ACTION:</span> {alert.action}
                        </p>
                      </div>
                      <button
                        onClick={() => dismissAlert(alert.id)}
                        className="p-1 h-fit text-current opacity-50 hover:opacity-100 transition-opacity"
                      >
                        <X size={14} />
                      </button>
                    </motion.div>
                  ))}
                </div>
              )}
            </AnimatePresence>

            {/* Status Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <StatusCard
                label="Free Chlorine"
                value={latest?.chlorine}
                unit="ppm"
                status={latest ? getStatus(latest.chlorine, DEFAULT_RANGES.chlorine.min, DEFAULT_RANGES.chlorine.max) : 'good'}
                trend={getTrendData('chlorine')}
                ideal="1–3"
              />
              <StatusCard
                label="pH Level"
                value={latest?.ph}
                unit=""
                status={latest ? getStatus(latest.ph, DEFAULT_RANGES.ph.min, DEFAULT_RANGES.ph.max) : 'good'}
                trend={getTrendData('ph')}
                ideal="7.2–7.6"
              />
              <StatusCard
                label="Alkalinity"
                value={latest?.alkalinity}
                unit="ppm"
                status={latest ? getStatus(latest.alkalinity, DEFAULT_RANGES.alkalinity.min, DEFAULT_RANGES.alkalinity.max) : 'good'}
                trend={getTrendData('alkalinity')}
                ideal="80–120"
              />
              <StatusCard
                label="Diff Pressure"
                value={latest?.differentialPressure}
                unit="PSI"
                status={latest ? getStatus(latest.differentialPressure, DEFAULT_RANGES.differentialPressure.min, DEFAULT_RANGES.differentialPressure.max) : 'good'}
                trend={getTrendData('differentialPressure')}
                ideal="8–15"
              />
              <div className="card bg-[#0a1628] border-border-dim flex flex-col justify-between p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">Temperature</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-accent font-mono">{latest?.temperature ?? '--'}</span>
                  <span className="text-xs text-ink-dim">°C</span>
                </div>
              </div>
            </div>

            {/* Maintenance Checklist */}
            <section className="card space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">Maintenance Checklist</h2>
                <span className="text-[9px] font-mono text-ink-dim">
                  {tasks.filter(t => t.completed).length}/{tasks.length} done
                </span>
              </div>
              <div className="space-y-3">
                {tasks.map(task => (
                  <button
                    key={task.id}
                    onClick={() => toggleTask(task.id)}
                    className="flex items-center gap-3 w-full text-left group"
                  >
                    {task.completed ? (
                      <CheckCircle2 size={18} className="text-success shrink-0" />
                    ) : (
                      <Circle size={18} className="text-border-dim group-hover:text-accent shrink-0" />
                    )}
                    <span className={`text-sm font-medium tracking-wide ${task.completed ? 'text-ink-dim line-through' : 'text-ink'}`}>
                      {task.title}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {/* Recent Readings */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">Recent Logs</h2>
                <button
                  onClick={onViewHistory}
                  className="text-[10px] font-bold text-accent uppercase tracking-widest flex items-center gap-1 hover:underline"
                >
                  History <ChevronRight size={12} />
                </button>
              </div>
              <div className="space-y-2">
                {readings.slice(0, 3).map(reading => (
                  <div key={reading.id} className="card py-3 flex items-center justify-between bg-[#0a1628]/50 border-border-dim/50">
                    <div>
                      <p className="text-xs font-bold text-white">{reading.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                      <p className="text-[9px] text-ink-dim uppercase tracking-widest font-mono">{reading.timestamp.toLocaleDateString()}</p>
                    </div>
                    <div className="flex gap-4 text-[10px] font-mono">
                      <div className="text-center">
                        <p className="text-ink-dim mb-0.5">CL</p>
                        <p className="font-bold text-accent">{reading.chlorine}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-ink-dim mb-0.5">PH</p>
                        <p className="font-bold text-accent">{reading.ph}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-ink-dim mb-0.5">PSI</p>
                        <p className="font-bold text-accent">{reading.differentialPressure}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-ink-dim mb-0.5">TEMP</p>
                        <p className="font-bold text-accent">{reading.temperature}°</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </motion.div>
        )}

        {activeTab === 'monthly' && (
          <motion.div
            key="monthly"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            <section className="card space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">Monthly Checklist</h2>
                  <p className="text-[9px] text-ink-dim font-mono mt-0.5">
                    {monthlyTasks.filter(t => t.completed).length} of {monthlyTasks.length} completed
                  </p>
                </div>
                {monthlyTasks.some(t => t.completed) && (
                  <button
                    onClick={() => {
                      // Reset all monthly tasks — handled via toggleMonthlyTask looping
                      monthlyTasks.filter(t => t.completed).forEach(t => toggleMonthlyTask(t.id));
                    }}
                    className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-ink-dim hover:text-accent transition-colors"
                    title="Reset all monthly tasks"
                  >
                    <RotateCcw size={11} />
                    Reset
                  </button>
                )}
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-[#0a1628] rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-500"
                  style={{ width: `${(monthlyTasks.filter(t => t.completed).length / monthlyTasks.length) * 100}%` }}
                />
              </div>

              <div className="space-y-3">
                {monthlyTasks.map(task => (
                  <button
                    key={task.id}
                    onClick={() => toggleMonthlyTask(task.id)}
                    className="flex items-center gap-3 w-full text-left group"
                  >
                    {task.completed ? (
                      <CheckCircle2 size={18} className="text-success shrink-0" />
                    ) : (
                      <Circle size={18} className="text-border-dim group-hover:text-accent shrink-0" />
                    )}
                    <span className={`text-sm font-medium tracking-wide ${task.completed ? 'text-ink-dim line-through' : 'text-ink'}`}>
                      {task.title}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </motion.div>
        )}

        {activeTab === 'trends' && (
          <motion.div
            key="trends"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <TrendCharts readings={readings} />
          </motion.div>
        )}

        {activeTab === 'inventory' && (
          <motion.div
            key="inventory"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <Inventory
              inventory={inventory}
              equipment={equipment}
              onUpdateQuantity={onUpdateInventoryQuantity}
              onUpdateEquipmentStatus={onUpdateEquipmentStatus}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quick Action FAB */}
      <button
        onClick={onLogReading}
        className="fixed bottom-6 right-6 w-14 h-14 bg-accent text-primary rounded-full shadow-xl shadow-accent/20 flex items-center justify-center hover:scale-110 active:scale-90 transition-all z-40 no-print"
      >
        <Plus size={28} />
      </button>
    </div>
  );
}

function Sparkline({ values, color }: { values: number[], color: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values) - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 60;
    const y = 20 - ((v - min) / max) * 20;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width="60" height="20" className="opacity-50">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle
        cx="60"
        cy={20 - ((values[values.length - 1] - min) / max) * 20}
        r="2"
        fill={color}
      />
    </svg>
  );
}

function StatusCard({ label, value, unit, status, trend, ideal }: { label: string, value?: number, unit: string, status: Status, trend: number[], ideal: string }) {
  const statusColors = {
    good: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5',
    warning: 'text-amber-400 border-amber-500/30 bg-amber-500/5',
    critical: 'text-red-400 border-red-500/30 bg-red-500/5',
  };

  const sparklineColors = {
    good: '#10b981',
    warning: '#f59e0b',
    critical: '#ef4444',
  };

  return (
    <div className={`card border ${statusColors[status]} flex flex-col gap-2 p-4`}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">{label}</p>
        <Sparkline values={trend} color={sparklineColors[status]} />
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold font-mono">{value?.toFixed(label === 'pH Level' ? 1 : 0) ?? '--'}</span>
        <span className="text-[10px] text-ink-dim font-medium">{unit}</span>
      </div>
      <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-widest">
        <span className="text-ink-dim">Ideal: {ideal}</span>
        <span className="opacity-80">{status === 'good' ? '✓ OK' : status === 'warning' ? '⚠ Watch' : '✕ Action'}</span>
      </div>
    </div>
  );
}
