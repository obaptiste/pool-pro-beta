import React, { useState } from 'react';
import { Wrench, Plus, Trash2, Calendar, Save, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { EquipmentItem } from '../types';

interface EquipmentProps {
  isOpen: boolean;
  onClose: () => void;
  items: EquipmentItem[];
  onUpdateItem: (item: EquipmentItem) => void;
  onDeleteItem: (id: string) => void;
}

export default function Equipment({ isOpen, onClose, items, onUpdateItem, onDeleteItem }: EquipmentProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newItem, setNewItem] = useState<Omit<EquipmentItem, 'id'>>({
    name: '',
    installDate: new Date(),
    serviceIntervalMonths: 6,
    uid: '',
  });

  const handleSave = () => {
    if (!newItem.name) return;
    onUpdateItem({
      ...newItem,
      id: Date.now().toString(),
    });
    setIsAdding(false);
    setNewItem({ name: '', installDate: new Date(), serviceIntervalMonths: 6, uid: '' });
  };

  const handleService = (item: EquipmentItem) => {
    onUpdateItem({
      ...item,
      lastServiceDate: new Date(),
    });
  };

  const getNextServiceDate = (item: EquipmentItem) => {
    if (!item.lastServiceDate || !item.serviceIntervalMonths) return null;
    const next = new Date(item.lastServiceDate);
    next.setMonth(next.getMonth() + item.serviceIntervalMonths);
    return next;
  };

  const isServiceDue = (item: EquipmentItem) => {
    const next = getNextServiceDate(item);
    if (!next) return false;
    return new Date() >= next;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[#060e1a]/90 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-2xl bg-[#0d1f38] rounded-3xl border border-border-dim overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-6 border-b border-border-dim flex items-center justify-between bg-[#0d1f38]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent">
              <Wrench size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white uppercase tracking-wider" style={{ fontFamily: "'Exo 2', sans-serif" }}>
                Equipment Registry
              </h2>
              <p className="text-[10px] text-ink-dim uppercase tracking-widest">Track pool hardware and maintenance</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface rounded-lg transition-colors text-ink-dim">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="flex justify-end">
            <button 
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-primary text-[10px] font-bold uppercase tracking-widest hover:brightness-110 transition-all"
            >
              <Plus size={16} />
              Add Equipment
            </button>
          </div>

          <AnimatePresence>
            {isAdding && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="p-4 rounded-2xl bg-surface border border-accent/20 space-y-4"
              >
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 col-span-2">
                    <label className="text-[10px] font-bold text-ink-dim uppercase tracking-widest">Equipment Name</label>
                    <input 
                      type="text"
                      value={newItem.name}
                      onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                      className="w-full bg-[#060e1a] border border-border-dim rounded-xl px-4 py-2 text-sm focus:border-accent outline-none transition-all"
                      placeholder="e.g. Hayward Variable Speed Pump"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-ink-dim uppercase tracking-widest">Install Date</label>
                    <input 
                      type="date"
                      onChange={e => setNewItem({ ...newItem, installDate: new Date(e.target.value) })}
                      className="w-full bg-[#060e1a] border border-border-dim rounded-xl px-4 py-2 text-sm focus:border-accent outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-ink-dim uppercase tracking-widest">Service Interval (Months)</label>
                    <input 
                      type="number"
                      value={newItem.serviceIntervalMonths}
                      onChange={e => setNewItem({ ...newItem, serviceIntervalMonths: Number(e.target.value) })}
                      className="w-full bg-[#060e1a] border border-border-dim rounded-xl px-4 py-2 text-sm focus:border-accent outline-none transition-all"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-3">
                  <button onClick={() => setIsAdding(false)} className="px-4 py-2 text-[10px] font-bold text-ink-dim uppercase tracking-widest hover:text-white">Cancel</button>
                  <button onClick={handleSave} className="px-6 py-2 rounded-xl bg-accent text-primary text-[10px] font-bold uppercase tracking-widest hover:brightness-110 transition-all">Save Equipment</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid gap-3">
            {items.map(item => {
              const nextService = getNextServiceDate(item);
              const due = isServiceDue(item);
              
              return (
                <div key={item.id} className="p-4 rounded-2xl bg-surface border border-border-dim flex flex-col gap-4 group">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${due ? 'bg-red-500/10 text-red-500' : 'bg-accent/10 text-accent'}`}>
                        {due ? <AlertTriangle size={20} /> : <Wrench size={20} />}
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white uppercase tracking-wide">{item.name}</h3>
                        <p className="text-[10px] text-ink-dim uppercase tracking-widest">
                          Installed: {item.installDate.toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <button 
                      onClick={() => onDeleteItem(item.id)}
                      className="p-2 text-ink-dim hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-[#060e1a] border border-border-dim">
                      <p className="text-[9px] text-ink-dim uppercase tracking-widest mb-1">Last Service</p>
                      <p className="text-xs font-bold text-white">
                        {item.lastServiceDate ? item.lastServiceDate.toLocaleDateString() : 'Never'}
                      </p>
                    </div>
                    <div className={`p-3 rounded-xl bg-[#060e1a] border ${due ? 'border-red-500/30' : 'border-border-dim'}`}>
                      <p className="text-[9px] text-ink-dim uppercase tracking-widest mb-1">Next Service</p>
                      <p className={`text-xs font-bold ${due ? 'text-red-500' : 'text-accent'}`}>
                        {nextService ? nextService.toLocaleDateString() : 'Set interval'}
                      </p>
                    </div>
                  </div>

                  <button 
                    onClick={() => handleService(item)}
                    className="w-full py-2 rounded-xl bg-surface-dim border border-border-dim text-[10px] font-bold uppercase tracking-widest text-ink hover:text-white hover:border-accent transition-all flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 size={14} />
                    Mark as Serviced
                  </button>
                </div>
              );
            })}
            {items.length === 0 && !isAdding && (
              <div className="text-center py-12 border-2 border-dashed border-border-dim rounded-3xl">
                <Wrench size={40} className="mx-auto text-ink-dim mb-4 opacity-20" />
                <p className="text-ink-dim text-sm">No equipment registered yet.</p>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
