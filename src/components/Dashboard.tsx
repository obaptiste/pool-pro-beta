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
  Bell,
  Calendar
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Reading, MaintenanceTask, DEFAULT_RANGES, Status, MaintenanceSchedule, InventoryItem, EquipmentItem } from '../types';
import TrendCharts from './TrendCharts';
import { calculateLSI } from '../lib/lsi';
import { generateContentWithRetry } from '../lib/gemini';

interface Props {
  readings: Reading[];
  tasks: MaintenanceTask[];
  schedule: MaintenanceSchedule;
  inventory: InventoryItem[];
  equipment: EquipmentItem[];
  onLogReading: () => void;
  onOpenCheatSheet: () => void;
  onOpenGlossary: () => void;
  onViewHistory: () => void;
  onOpenReminderSettings: () => void;
  onExport: () => void;
  onPrint: () => void;
  toggleTask: (id: string) => void;
  onAddTask: (task: Omit<MaintenanceTask, 'id' | 'uid' | 'createdAt'>) => void;
}

export default function Dashboard({ readings, tasks, schedule, inventory, equipment, onLogReading, onOpenCheatSheet, onOpenGlossary, onViewHistory, onOpenReminderSettings, onExport, onPrint, toggleTask, onAddTask }: Props) {
  const [activeTab, setActiveTab] = React.useState<'overview' | 'trends'>('overview');
  const [taskFilter, setTaskFilter] = React.useState<'all' | 'daily' | 'weekly' | 'monthly'>('all');
  const [isAddingTask, setIsAddingTask] = React.useState(false);
  const [newTask, setNewTask] = React.useState<Omit<MaintenanceTask, 'id' | 'uid' | 'createdAt'>>({
    title: '',
    completed: false,
    priority: 'medium',
    frequency: 'once'
  });
  const [dismissedAlerts, setDismissedAlerts] = React.useState<string[]>([]);
  const [lsiAnalysis, setLsiAnalysis] = React.useState<string | null>(null);
  const [isLsiLoading, setIsLsiLoading] = React.useState(false);
  const latest = readings[0];

  const lsiScore: number | null = latest ? calculateLSI(latest) : null;

  const getLsiStatus = (score: number): Status => {
    if (score < -0.3 || score > 0.3) return 'critical';
    if (score < -0.1 || score > 0.1) return 'warning';
    return 'good';
  };

  const fmtField = (v: number | null | undefined) => v == null ? 'not measured' : String(v);

  const runLsiAnalysis = async () => {
    if (!latest || isLsiLoading || lsiScore == null) return;
    setIsLsiLoading(true);
    try {
      const response = await generateContentWithRetry({
        model: "gemini-2.0-flash",
        contents: `Analyze this LSI score of ${lsiScore} for a pool.
        Context: pH ${fmtField(latest.ph)}, Temp ${fmtField(latest.temperature)}°C, CH ${fmtField(latest.calciumHardness)}, TA ${fmtField(latest.alkalinity)}.
        Provide a 1-sentence technical recommendation.`,
      }, process.env.GEMINI_API_KEY!);
      setLsiAnalysis(response.text || "Analysis unavailable.");
    } catch (e) {
      console.error(e);
      setLsiAnalysis("Failed to load AI analysis.");
    } finally {
      setIsLsiLoading(false);
    }
  };

  React.useEffect(() => {
    if (latest) {
      runLsiAnalysis();
    }
  }, [latest?.id]);

  // Reset dismissed alerts when a new reading is added
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
      condition: latest.chlorine != null && latest.chlorine < DEFAULT_RANGES.chlorine.min,
      msg: 'Free chlorine critically low — pool unsafe. Dose now.',
      action: 'Add chlorine or shock treatment immediately.',
      severity: 'critical'
    },
    {
      id: 'cl_high',
      type: 'chlorine',
      condition: latest.chlorine != null && latest.chlorine > DEFAULT_RANGES.chlorine.max,
      msg: 'Chlorine elevated — likely post-shock.',
      action: 'Stop chlorination and wait for levels to drop.',
      severity: 'warning'
    },
    {
      id: 'ph_low',
      type: 'ph',
      condition: latest.ph != null && latest.ph < DEFAULT_RANGES.ph.min,
      msg: 'pH too low — corrosive water.',
      action: 'Add sodium carbonate (Soda Ash).',
      severity: 'critical'
    },
    {
      id: 'ph_high',
      type: 'ph',
      condition: latest.ph != null && latest.ph > DEFAULT_RANGES.ph.max,
      msg: 'pH too high — chlorine less effective.',
      action: 'Add muriatic acid.',
      severity: 'warning'
    },
    {
      id: 'alk_low',
      type: 'alkalinity',
      condition: latest.alkalinity != null && latest.alkalinity < DEFAULT_RANGES.alkalinity.min,
      msg: 'Low alkalinity — pH will be unstable.',
      action: 'Add sodium bicarbonate.',
      severity: 'warning'
    },
    {
      id: 'alk_high',
      type: 'alkalinity',
      condition: latest.alkalinity != null && latest.alkalinity > DEFAULT_RANGES.alkalinity.max,
      msg: 'Alkalinity is too high.',
      action: 'Add pH decreaser or partially drain.',
      severity: 'warning'
    },
    {
      id: 'dp_high',
      type: 'pressure',
      condition: latest.differentialPressure != null && latest.differentialPressure > DEFAULT_RANGES.differentialPressure.max,
      msg: 'Filter pressure elevated — flow restricted.',
      action: 'Backwash filter or clean cartridges immediately.',
      severity: 'critical'
    },
    {
      id: 'test_due',
      type: 'schedule',
      condition: schedule.nextTestDate ? new Date() >= new Date(schedule.nextTestDate) : false,
      msg: 'Water test due — maintenance schedule.',
      action: 'Log a new reading to maintain water balance.',
      severity: 'warning'
    }
  ].filter(a => a.condition && !dismissedAlerts.includes(a.id)) : [];

  const dismissAlert = (id: string) => {
    setDismissedAlerts(prev => [...prev, id]);
  };

  const isTestDue = schedule.nextTestDate ? new Date() >= new Date(schedule.nextTestDate) : false;

  const lowInventory = inventory.filter(item => item.quantity <= item.minThreshold);
  const equipmentNeedingService = equipment.filter(item => {
    if (!item.lastServiceDate || !item.serviceIntervalMonths) return false;
    const nextService = new Date(item.lastServiceDate);
    nextService.setMonth(nextService.getMonth() + item.serviceIntervalMonths);
    return new Date() >= nextService;
  });

  const getPriorityColor = (priority: MaintenanceTask['priority']) => {
    switch (priority) {
      case 'critical': return 'text-red-400 bg-red-400/10 border-red-400/20';
      case 'high': return 'text-orange-400 bg-orange-400/10 border-orange-400/20';
      case 'medium': return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
      case 'low': return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
      default: return 'text-ink-dim bg-surface border-border-dim';
    }
  };

  const getTrendData = (key: keyof Reading) => {
    return readings.slice(0, 7)
      .map(r => r[key])
      .filter((v): v is number => typeof v === 'number' && !isNaN(v))
      .reverse();
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.title.trim()) return;
    onAddTask(newTask);
    setNewTask({ title: '', completed: false, priority: 'medium', frequency: 'once' });
    setIsAddingTask(false);
  };

  return (
    <div className="space-y-6 pb-24 anim-fade-up">
      {/* Header Section */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="wordmark text-2xl text-white">
            Pool<span className="text-accent">Status</span>
          </h1>
          <p className="text-[10px] font-mono text-ink-dim uppercase tracking-[0.2em]">
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
          <button onClick={onOpenReminderSettings} className="p-2 rounded-lg bg-surface border border-border-dim text-ink-muted hover:text-white transition-colors" title="Reminders">
            <Bell size={18} />
          </button>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="flex p-1 bg-[#0a1628] border border-border-dim rounded-xl no-print">
        <button 
          onClick={() => setActiveTab('overview')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all ${activeTab === 'overview' ? 'bg-accent text-primary shadow-lg' : 'text-ink-dim hover:text-ink-muted'}`}
        >
          <LayoutDashboard size={14} />
          Overview
        </button>
        <button 
          onClick={() => setActiveTab('trends')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all ${activeTab === 'trends' ? 'bg-accent text-primary shadow-lg' : 'text-ink-dim hover:text-ink-muted'}`}
        >
          <LineChartIcon size={14} />
          Trends
        </button>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'overview' ? (
          <motion.div 
            key="overview"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
      {/* Alerts Section */}
      <div className="space-y-3 no-print">
        {allAlerts.length > 0 && (
          <div className="space-y-2">
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

        {lowInventory.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center gap-4"
          >
            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center text-red-500 shrink-0">
              <Plus size={20} />
            </div>
            <div className="flex-1">
              <h3 className="text-red-500 font-bold text-xs uppercase tracking-widest">Low Inventory</h3>
              <p className="text-ink-dim text-[11px]">{lowInventory.length} items are below minimum threshold.</p>
            </div>
          </motion.div>
        )}

        {equipmentNeedingService.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="p-4 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 flex items-center gap-4"
          >
            <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center text-yellow-500 shrink-0">
              <Activity size={20} />
            </div>
            <div className="flex-1">
              <h3 className="text-yellow-500 font-bold text-xs uppercase tracking-widest">Equipment Service Due</h3>
              <p className="text-ink-dim text-[11px]">{equipmentNeedingService.length} items require maintenance.</p>
            </div>
          </motion.div>
        )}
      </div>

            {/* Status Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className={`card anim-scan border col-span-2 md:col-span-1 flex flex-col justify-between p-4 ${
                lsiScore == null ? 'text-ink-dim border-border-dim bg-surface' :
                lsiScore < -0.3 ? 'text-red-400 border-red-500/30 bg-red-500/5' :
                lsiScore > 0.3 ? 'text-amber-400 border-amber-500/30 bg-amber-500/5' :
                'text-emerald-400 border-emerald-500/30 bg-emerald-500/5'
              }`}>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">Saturation Index (LSI)</p>
                  <Sparkles size={14} className={isLsiLoading ? 'animate-spin' : ''} />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold font-mono">{lsiScore ?? '—'}</span>
                  <span className="text-[10px] uppercase tracking-widest opacity-70">
                    {lsiScore == null ? 'Insufficient data' : lsiScore < -0.3 ? 'Corrosive' : lsiScore > 0.3 ? 'Scale Forming' : 'Balanced'}
                  </span>
                </div>
                <p className="text-[9px] mt-2 italic opacity-80 line-clamp-2">
                  {lsiScore == null ? 'Log pH, temperature, calcium hardness, and alkalinity to compute LSI.' : isLsiLoading ? 'AI analyzing saturation...' : lsiAnalysis}
                </p>
              </div>
              <StatusCard
                label="Free Chlorine"
                value={latest?.chlorine ?? null}
                unit="ppm"
                status={latest?.chlorine != null ? getStatus(latest.chlorine, DEFAULT_RANGES.chlorine.min, DEFAULT_RANGES.chlorine.max) : 'good'}
                trend={getTrendData('chlorine')}
                ideal="1–3"
              />
              <StatusCard
                label="pH Level"
                value={latest?.ph ?? null}
                unit=""
                status={latest?.ph != null ? getStatus(latest.ph, DEFAULT_RANGES.ph.min, DEFAULT_RANGES.ph.max) : 'good'}
                trend={getTrendData('ph')}
                ideal="7.2–7.6"
              />
              <StatusCard
                label="Alkalinity"
                value={latest?.alkalinity ?? null}
                unit="ppm"
                status={latest?.alkalinity != null ? getStatus(latest.alkalinity, DEFAULT_RANGES.alkalinity.min, DEFAULT_RANGES.alkalinity.max) : 'good'}
                trend={getTrendData('alkalinity')}
                ideal="80–120"
              />
              <StatusCard
                label="Diff Pressure"
                value={latest?.differentialPressure ?? null}
                unit="kPa"
                status={latest?.differentialPressure != null ? getStatus(latest.differentialPressure, DEFAULT_RANGES.differentialPressure.min, DEFAULT_RANGES.differentialPressure.max) : 'good'}
                trend={getTrendData('differentialPressure')}
                ideal="55–140"
              />
              <div className="card bg-[#0a1628] border-border-dim flex flex-col justify-between p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">Temperature</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-accent font-mono">{latest?.temperature ?? '—'}</span>
                  <span className="text-xs text-ink-dim">°C</span>
                </div>
              </div>
            </div>

            {/* Maintenance Checklist */}
            <section className="card space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">Maintenance Checklist</h2>
                  <div className="flex bg-[#060e1a] rounded-lg border border-border-dim p-0.5">
                    {(['all', 'daily', 'weekly', 'monthly'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setTaskFilter(f)}
                        className={`px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest rounded-md transition-all ${taskFilter === f ? 'bg-accent text-primary' : 'text-ink-dim hover:text-ink-muted'}`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                  <button 
                    onClick={() => setIsAddingTask(!isAddingTask)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20 transition-colors"
                  >
                    <Plus size={10} />
                    <span className="text-[8px] font-bold uppercase tracking-widest">Add Task</span>
                  </button>
                </div>
                {tasks.some(t => t.isAI && !t.completed) && (
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20">
                    <Sparkles size={10} className="text-accent" />
                    <span className="text-[8px] font-bold uppercase tracking-widest text-accent">Active AI Protocol</span>
                  </div>
                )}
              </div>

              <AnimatePresence>
                {isAddingTask && (
                  <motion.form 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    onSubmit={handleAddTask}
                    className="overflow-hidden space-y-3 bg-[#060e1a] p-3 rounded-lg border border-border-dim"
                  >
                    <div className="space-y-1">
                      <label className="text-[8px] font-bold uppercase tracking-widest text-ink-dim">Task Title</label>
                      <input 
                        type="text"
                        value={newTask.title}
                        onChange={e => setNewTask(prev => ({ ...prev, title: e.target.value }))}
                        placeholder="e.g. Clean filter cartridges"
                        className="w-full bg-[#0a1628] border border-border-dim rounded-md px-3 py-2 text-xs text-ink focus:outline-none focus:border-accent"
                        autoFocus
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[8px] font-bold uppercase tracking-widest text-ink-dim">Priority</label>
                        <select 
                          value={newTask.priority}
                          onChange={e => setNewTask(prev => ({ ...prev, priority: e.target.value as any }))}
                          className="w-full bg-[#0a1628] border border-border-dim rounded-md px-3 py-2 text-xs text-ink focus:outline-none focus:border-accent"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] font-bold uppercase tracking-widest text-ink-dim">Frequency</label>
                        <select 
                          value={newTask.frequency}
                          onChange={e => setNewTask(prev => ({ ...prev, frequency: e.target.value as any }))}
                          className="w-full bg-[#0a1628] border border-border-dim rounded-md px-3 py-2 text-xs text-ink focus:outline-none focus:border-accent"
                        >
                          <option value="once">Once</option>
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button 
                        type="submit"
                        className="flex-1 bg-accent text-primary font-bold text-[10px] uppercase tracking-widest py-2 rounded-md hover:bg-accent/90 transition-colors"
                      >
                        Create Task
                      </button>
                      <button 
                        type="button"
                        onClick={() => setIsAddingTask(false)}
                        className="px-4 bg-border-dim text-ink-dim font-bold text-[10px] uppercase tracking-widest py-2 rounded-md hover:bg-border transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>

              <div className="space-y-2">
                {/* Active AI Tasks First */}
                {tasks
                  .filter(t => t.isAI && !t.completed && (taskFilter === 'all' || t.frequency === taskFilter))
                  .map(task => (
                  <button 
                    key={task.id} 
                    onClick={() => toggleTask(task.id)}
                    className="flex items-center gap-3 w-full text-left group p-2 rounded-lg transition-all bg-accent/5 border border-accent/20 shadow-sm shadow-accent/5"
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-3">
                        <Circle size={18} className="text-accent" />
                        <span className="text-sm font-medium tracking-wide text-ink">
                          {task.title}
                        </span>
                      </div>
                      <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-tighter ${getPriorityColor(task.priority)}`}>
                        {task.priority}
                      </span>
                    </div>
                    <Sparkles size={12} className="text-accent opacity-50" />
                  </button>
                ))}

                {/* Manual and Completed Tasks */}
                {tasks
                  .filter(t => (!t.isAI || t.completed) && (taskFilter === 'all' || t.frequency === taskFilter))
                  .map(task => (
                  <button 
                    key={task.id} 
                    onClick={() => toggleTask(task.id)}
                    className="flex items-center gap-3 w-full text-left group p-2 rounded-lg transition-all hover:bg-surface/50"
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-3">
                        {task.completed ? (
                          <CheckCircle2 size={18} className="text-success" />
                        ) : (
                          <Circle size={18} className="text-border-dim group-hover:text-accent" />
                        )}
                        <span className={`text-sm font-medium tracking-wide ${task.completed ? 'text-ink-dim line-through' : 'text-ink'}`}>
                          {task.title}
                        </span>
                      </div>
                      <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-tighter ${getPriorityColor(task.priority)}`}>
                        {task.priority}
                      </span>
                    </div>
                    {task.isAI && task.completed && (
                      <span className="text-[8px] font-bold uppercase tracking-widest text-ink-dim/50">AI</span>
                    )}
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
                        <p className="font-bold text-accent">{reading.chlorine ?? '—'}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-ink-dim mb-0.5">PH</p>
                        <p className="font-bold text-accent">{reading.ph ?? '—'}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-ink-dim mb-0.5">kPa</p>
                        <p className="font-bold text-accent">{reading.differentialPressure ?? '—'}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-ink-dim mb-0.5">TEMP</p>
                        <p className="font-bold text-accent">{reading.temperature == null ? '—' : `${reading.temperature}°`}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </motion.div>
        ) : (
          <motion.div 
            key="trends"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <TrendCharts readings={readings} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quick Action FAB */}
      <button 
        onClick={onLogReading}
        className="fixed bottom-6 right-6 w-14 h-14 bg-accent text-primary rounded-full shadow-xl shadow-accent/20 flex items-center justify-center hover:scale-110 active:scale-90 transition-all z-40 no-print anim-fab-pulse"
      >
        <Plus size={28} />
      </button>
    </div>
  );
}

function Sparkline({ values, color }: { values: number[], color: string }) {
  const safeValues = values.map(v => isNaN(v) ? 0 : v);
  if (safeValues.length < 2) return null;
  
  const min = Math.min(...safeValues);
  const max = Math.max(...safeValues) - min || 1;
  const points = safeValues.map((v, i) => {
    const x = (i / (safeValues.length - 1)) * 60;
    const y = 20 - ((v - min) / max) * 20;
    return `${x},${y}`;
  }).join(' ');

  const lastValue = safeValues[safeValues.length - 1];
  const lastY = 20 - ((lastValue - min) / max) * 20;

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
        cy={isNaN(lastY) ? 10 : lastY} 
        r="2" 
        fill={color} 
      />
    </svg>
  );
}

function StatusCard({ label, value, unit, status, trend, ideal }: { label: string, value: number | null, unit: string, status: Status, trend: number[], ideal: string }) {
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

  const isMissing = value == null;

  return (
    <div className={`card anim-scan border ${isMissing ? 'text-ink-dim border-border-dim bg-surface' : statusColors[status]} flex flex-col gap-2 p-4`}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">{label}</p>
        <Sparkline values={trend} color={sparklineColors[status]} />
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold font-mono">{isMissing ? '—' : value.toFixed(label === 'pH Level' ? 1 : 0)}</span>
        <span className="text-[10px] text-ink-dim font-medium">{unit}</span>
      </div>
      <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-widest">
        <span className="text-ink-dim">Ideal: {ideal}</span>
        <span className="opacity-80">{isMissing ? 'Not measured' : status === 'good' ? '✓ OK' : status === 'warning' ? '⚠ Watch' : '✕ Action'}</span>
      </div>
    </div>
  );
}
