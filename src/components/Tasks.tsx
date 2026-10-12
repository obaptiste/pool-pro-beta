import React from 'react';
import { ChevronLeft, CheckCircle2, Circle, Plus, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MaintenanceTask } from '../types';

interface Props {
  tasks: MaintenanceTask[];
  toggleTask: (id: string) => void;
  onAddTask: (task: Omit<MaintenanceTask, 'id' | 'uid' | 'createdAt'>) => void;
  onBack: () => void;
}

type TaskFilter = 'all' | 'daily' | 'weekly' | 'monthly';

const getPriorityColor = (priority: MaintenanceTask['priority']) => {
  switch (priority) {
    case 'critical': return 'text-red-400 bg-red-400/10 border-red-400/20';
    case 'high': return 'text-orange-400 bg-orange-400/10 border-orange-400/20';
    case 'medium': return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
    case 'low': return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
    default: return 'text-ink-dim bg-surface border-border-dim';
  }
};

/**
 * The maintenance checklist as its own screen (the "Tasks" tab). This is
 * the checklist section that used to live inside Dashboard.tsx, moved
 * verbatim in behaviour: filter by frequency, add a task, AI-protocol
 * tasks pinned to the top until completed.
 */
export default function Tasks({ tasks, toggleTask, onAddTask, onBack }: Props) {
  const [taskFilter, setTaskFilter] = React.useState<TaskFilter>('all');
  const [isAddingTask, setIsAddingTask] = React.useState(false);
  const [newTask, setNewTask] = React.useState<Omit<MaintenanceTask, 'id' | 'uid' | 'createdAt'>>({
    title: '',
    completed: false,
    priority: 'medium',
    frequency: 'once',
  });

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.title.trim()) return;
    onAddTask(newTask);
    setNewTask({ title: '', completed: false, priority: 'medium', frequency: 'once' });
    setIsAddingTask(false);
  };

  const matchesFilter = (t: MaintenanceTask) => taskFilter === 'all' || t.frequency === taskFilter;
  const aiTasks = tasks.filter((t) => t.isAI && !t.completed && matchesFilter(t));
  const otherTasks = tasks.filter((t) => (!t.isAI || t.completed) && matchesFilter(t));
  const done = tasks.filter((t) => t.completed).length;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="fixed inset-0 z-50 bg-bg overflow-y-auto"
    >
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6" style={{ paddingBottom: 'calc(120px + env(safe-area-inset-bottom))' }}>
        <header className="flex items-center justify-between border-b border-border-dim pb-6">
          <button onClick={onBack} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-ink-dim hover:text-accent transition-colors min-h-11">
            <ChevronLeft size={16} /> Back to Dashboard
          </button>
          <div className="text-right">
            <h1 className="text-lg font-bold text-ink tracking-tight">Shift Checklist</h1>
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink-dim">{done}/{tasks.length} done</p>
          </div>
        </header>

        <section className="card space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex bg-[#060e1a] rounded-lg border border-border-dim p-0.5">
                {(['all', 'daily', 'weekly', 'monthly'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setTaskFilter(f)}
                    className={`px-3 py-2 text-[9px] font-bold uppercase tracking-widest rounded-md transition-all ${taskFilter === f ? 'bg-accent text-primary' : 'text-ink-dim hover:text-ink-muted'}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setIsAddingTask(!isAddingTask)}
                className="flex items-center gap-1 px-3 py-2 rounded-md bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20 transition-colors"
              >
                <Plus size={12} />
                <span className="text-[9px] font-bold uppercase tracking-widest">Add Task</span>
              </button>
            </div>
            {tasks.some((t) => t.isAI && !t.completed) && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-accent/10 border border-accent/20">
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
                    onChange={(e) => setNewTask((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="e.g. Clean filter cartridges"
                    className="w-full bg-[#0a1628] border border-border-dim rounded-md px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
                    autoFocus
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[8px] font-bold uppercase tracking-widest text-ink-dim">Priority</label>
                    <select
                      value={newTask.priority}
                      onChange={(e) => setNewTask((prev) => ({ ...prev, priority: e.target.value as MaintenanceTask['priority'] }))}
                      className="w-full bg-[#0a1628] border border-border-dim rounded-md px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
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
                      onChange={(e) => setNewTask((prev) => ({ ...prev, frequency: e.target.value as MaintenanceTask['frequency'] }))}
                      className="w-full bg-[#0a1628] border border-border-dim rounded-md px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
                    >
                      <option value="once">Once</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="submit" className="flex-1 bg-accent text-primary font-bold text-[10px] uppercase tracking-widest py-3 rounded-md hover:bg-accent/90 transition-colors">
                    Create Task
                  </button>
                  <button type="button" onClick={() => setIsAddingTask(false)} className="px-4 bg-border-dim text-ink-dim font-bold text-[10px] uppercase tracking-widest py-3 rounded-md transition-colors">
                    Cancel
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>

          <div className="space-y-2">
            {aiTasks.map((task) => (
              <button
                key={task.id}
                onClick={() => toggleTask(task.id)}
                className="flex items-center gap-3 w-full text-left group p-3 min-h-11 rounded-lg transition-all bg-accent/5 border border-accent/20 shadow-sm shadow-accent/5"
              >
                <div className="flex items-center justify-between w-full gap-3">
                  <div className="flex items-center gap-3">
                    <Circle size={18} className="text-accent shrink-0" />
                    <span className="text-sm font-medium tracking-wide text-ink">{task.title}</span>
                  </div>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-tighter shrink-0 ${getPriorityColor(task.priority)}`}>
                    {task.priority}
                  </span>
                </div>
                <Sparkles size={12} className="text-accent opacity-50 shrink-0" />
              </button>
            ))}

            {otherTasks.map((task) => (
              <button
                key={task.id}
                onClick={() => toggleTask(task.id)}
                className="flex items-center gap-3 w-full text-left group p-3 min-h-11 rounded-lg transition-all hover:bg-surface/50"
              >
                <div className="flex items-center justify-between w-full gap-3">
                  <div className="flex items-center gap-3">
                    {task.completed ? (
                      <CheckCircle2 size={18} className="text-success shrink-0" />
                    ) : (
                      <Circle size={18} className="text-border-dim group-hover:text-accent shrink-0" />
                    )}
                    <span className={`text-sm font-medium tracking-wide ${task.completed ? 'text-ink-dim line-through' : 'text-ink'}`}>{task.title}</span>
                  </div>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-tighter shrink-0 ${getPriorityColor(task.priority)}`}>
                    {task.priority}
                  </span>
                </div>
                {task.isAI && task.completed && <span className="text-[8px] font-bold uppercase tracking-widest text-ink-dim/50">AI</span>}
              </button>
            ))}

            {aiTasks.length === 0 && otherTasks.length === 0 && (
              <p className="text-xs text-ink-dim py-6 text-center">No tasks match this filter.</p>
            )}
          </div>
        </section>
      </div>
    </motion.div>
  );
}
