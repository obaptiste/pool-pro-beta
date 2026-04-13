import React, { useState } from 'react';
import { Package, Plus, Trash2, AlertTriangle, Save, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { InventoryItem } from '../types';

interface InventoryProps {
  isOpen: boolean;
  onClose: () => void;
  items: InventoryItem[];
  onUpdateItem: (item: InventoryItem) => void;
  onDeleteItem: (id: string) => void;
}

export default function Inventory({ isOpen, onClose, items, onUpdateItem, onDeleteItem }: InventoryProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newItem, setNewItem] = useState<Omit<InventoryItem, 'id'>>({
    name: '',
    quantity: 0,
    unit: 'kg',
    minThreshold: 1,
    uid: '',
  });

  const handleSave = () => {
    if (!newItem.name) return;
    onUpdateItem({
      ...newItem,
      id: crypto.randomUUID(),
    });
    setIsAdding(false);
    setNewItem({ name: '', quantity: 0, unit: 'kg', minThreshold: 1, uid: '' });
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
              <Package size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white uppercase tracking-wider" style={{ fontFamily: "'Exo 2', sans-serif" }}>
                Chemical Inventory
              </h2>
              <p className="text-[10px] text-ink-dim uppercase tracking-widest">Track supplies and stock levels</p>
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
              Add Item
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
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-ink-dim uppercase tracking-widest">Item Name</label>
                    <input 
                      type="text"
                      value={newItem.name}
                      onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                      className="w-full bg-[#060e1a] border border-border-dim rounded-xl px-4 py-2 text-sm focus:border-accent outline-none transition-all"
                      placeholder="e.g. Chlorine Tablets"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-ink-dim uppercase tracking-widest">Unit</label>
                    <input 
                      type="text"
                      value={newItem.unit}
                      onChange={e => setNewItem({ ...newItem, unit: e.target.value })}
                      className="w-full bg-[#060e1a] border border-border-dim rounded-xl px-4 py-2 text-sm focus:border-accent outline-none transition-all"
                      placeholder="e.g. kg, L, bags"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-ink-dim uppercase tracking-widest">Quantity</label>
                    <input 
                      type="number"
                      value={newItem.quantity}
                      onChange={e => setNewItem({ ...newItem, quantity: Number(e.target.value) })}
                      className="w-full bg-[#060e1a] border border-border-dim rounded-xl px-4 py-2 text-sm focus:border-accent outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-ink-dim uppercase tracking-widest">Min Threshold</label>
                    <input 
                      type="number"
                      value={newItem.minThreshold}
                      onChange={e => setNewItem({ ...newItem, minThreshold: Number(e.target.value) })}
                      className="w-full bg-[#060e1a] border border-border-dim rounded-xl px-4 py-2 text-sm focus:border-accent outline-none transition-all"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-3">
                  <button onClick={() => setIsAdding(false)} className="px-4 py-2 text-[10px] font-bold text-ink-dim uppercase tracking-widest hover:text-white">Cancel</button>
                  <button onClick={handleSave} className="px-6 py-2 rounded-xl bg-accent text-primary text-[10px] font-bold uppercase tracking-widest hover:brightness-110 transition-all">Save Item</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid gap-3">
            {items.map(item => (
              <div key={item.id} className="p-4 rounded-2xl bg-surface border border-border-dim flex items-center justify-between group">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${item.quantity <= item.minThreshold ? 'bg-red-500/10 text-red-500' : 'bg-accent/10 text-accent'}`}>
                    {item.quantity <= item.minThreshold ? <AlertTriangle size={20} /> : <Package size={20} />}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wide">{item.name}</h3>
                    <p className="text-[10px] text-ink-dim uppercase tracking-widest">
                      {item.quantity} {item.unit} in stock
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 bg-[#060e1a] rounded-xl border border-border-dim p-1">
                    <button 
                      onClick={() => onUpdateItem({ ...item, quantity: Math.max(0, item.quantity - 1) })}
                      className="w-8 h-8 rounded-lg hover:bg-surface flex items-center justify-center text-ink-dim hover:text-white transition-all"
                    >
                      -
                    </button>
                    <span className="w-8 text-center text-xs font-mono font-bold text-accent">{item.quantity}</span>
                    <button 
                      onClick={() => onUpdateItem({ ...item, quantity: item.quantity + 1 })}
                      className="w-8 h-8 rounded-lg hover:bg-surface flex items-center justify-center text-ink-dim hover:text-white transition-all"
                    >
                      +
                    </button>
                  </div>
                  <button 
                    onClick={() => onDeleteItem(item.id)}
                    className="p-2 text-ink-dim hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))}
            {items.length === 0 && !isAdding && (
              <div className="text-center py-12 border-2 border-dashed border-border-dim rounded-3xl">
                <Package size={40} className="mx-auto text-ink-dim mb-4 opacity-20" />
                <p className="text-ink-dim text-sm">No inventory items tracked yet.</p>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
