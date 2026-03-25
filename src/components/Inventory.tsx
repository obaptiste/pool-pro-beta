import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Package, Wrench, ChevronDown, ChevronUp, Minus, Plus } from 'lucide-react';
import { InventoryItem, Equipment } from '../types';

interface Props {
  inventory: InventoryItem[];
  equipment: Equipment[];
  onUpdateQuantity: (id: string, quantity: number) => void;
  onUpdateEquipmentStatus: (id: string, status: Equipment['status']) => void;
}

const CATEGORY_LABELS: Record<InventoryItem['category'], string> = {
  chemical: 'Chemicals',
  equipment: 'Equipment & Tools',
  supplies: 'Supplies',
};

const STATUS_STYLES: Record<Equipment['status'], { label: string; classes: string; dot: string }> = {
  operational: {
    label: 'Operational',
    classes: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    dot: 'bg-emerald-400',
  },
  'needs-attention': {
    label: 'Needs Attention',
    classes: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    dot: 'bg-amber-400',
  },
  offline: {
    label: 'Offline',
    classes: 'text-red-400 bg-red-500/10 border-red-500/30',
    dot: 'bg-red-400',
  },
};

export default function Inventory({ inventory, equipment, onUpdateQuantity, onUpdateEquipmentStatus }: Props) {
  const [expandedEquipment, setExpandedEquipment] = useState<string | null>(null);

  const lowItems = inventory.filter(item => item.quantity <= item.lowThreshold);

  const groupedInventory = (Object.keys(CATEGORY_LABELS) as InventoryItem['category'][]).map(cat => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    items: inventory.filter(item => item.category === cat),
  })).filter(g => g.items.length > 0);

  return (
    <div className="space-y-6">
      {/* Low Stock Alert Banner */}
      {lowItems.length > 0 && (
        <div className="p-3 rounded-xl border bg-amber-500/10 border-amber-500/30">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={15} className="text-amber-400 shrink-0" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400">
              {lowItems.length} Item{lowItems.length > 1 ? 's' : ''} Low or Out of Stock
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {lowItems.map(item => (
              <span
                key={item.id}
                className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30"
              >
                {item.name} — {item.quantity} {item.unit}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Inventory by Category */}
      {groupedInventory.map(group => (
        <section key={group.category} className="card space-y-3">
          <div className="flex items-center gap-2">
            <Package size={13} className="text-ink-dim" />
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">{group.label}</h2>
          </div>
          <div className="space-y-2">
            {group.items.map(item => {
              const isLow = item.quantity <= item.lowThreshold;
              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                    isLow
                      ? 'bg-amber-500/5 border-amber-500/20'
                      : 'bg-[#0a1628]/50 border-border-dim/40'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {isLow ? (
                        <AlertTriangle size={11} className="text-amber-400 shrink-0" />
                      ) : (
                        <CheckCircle2 size={11} className="text-emerald-400/60 shrink-0" />
                      )}
                      <p className={`text-xs font-medium truncate ${isLow ? 'text-amber-200' : 'text-ink'}`}>
                        {item.name}
                      </p>
                    </div>
                    {isLow && (
                      <p className="text-[9px] text-amber-400/70 ml-[19px] mt-0.5 uppercase tracking-wider font-bold">
                        Low — reorder soon
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                      className="w-6 h-6 flex items-center justify-center rounded bg-surface border border-border-dim text-ink-dim hover:text-white hover:border-accent transition-colors"
                      aria-label="Decrease quantity"
                    >
                      <Minus size={10} />
                    </button>
                    <span className={`text-xs font-bold font-mono w-14 text-center ${isLow ? 'text-amber-300' : 'text-accent'}`}>
                      {item.quantity} {item.unit}
                    </span>
                    <button
                      onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                      className="w-6 h-6 flex items-center justify-center rounded bg-surface border border-border-dim text-ink-dim hover:text-white hover:border-accent transition-colors"
                      aria-label="Increase quantity"
                    >
                      <Plus size={10} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {/* Equipment List */}
      <section className="card space-y-3">
        <div className="flex items-center gap-2">
          <Wrench size={13} className="text-ink-dim" />
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">Equipment Status</h2>
        </div>
        <div className="space-y-2">
          {equipment.map(item => {
            const style = STATUS_STYLES[item.status];
            const isExpanded = expandedEquipment === item.id;
            return (
              <div key={item.id} className="rounded-lg border border-border-dim/40 overflow-hidden">
                <button
                  onClick={() => setExpandedEquipment(isExpanded ? null : item.id)}
                  className="flex items-center gap-3 w-full p-2.5 bg-[#0a1628]/50 hover:bg-[#0a1628] transition-colors text-left"
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-ink truncate">{item.name}</p>
                    <p className="text-[9px] text-ink-dim uppercase tracking-wider font-mono">{item.type}</p>
                  </div>
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${style.classes}`}>
                    {style.label}
                  </span>
                  {isExpanded ? (
                    <ChevronUp size={12} className="text-ink-dim shrink-0" />
                  ) : (
                    <ChevronDown size={12} className="text-ink-dim shrink-0" />
                  )}
                </button>
                {isExpanded && (
                  <div className="px-3 py-2.5 bg-[#060e1a]/60 border-t border-border-dim/40 space-y-2.5">
                    {item.lastChecked && (
                      <p className="text-[9px] text-ink-dim font-mono uppercase tracking-wider">
                        Last checked: {item.lastChecked}
                      </p>
                    )}
                    {item.notes && (
                      <p className="text-[10px] text-amber-300 italic">{item.notes}</p>
                    )}
                    <div className="flex gap-1.5 flex-wrap">
                      {(['operational', 'needs-attention', 'offline'] as Equipment['status'][]).map(s => (
                        <button
                          key={s}
                          onClick={() => onUpdateEquipmentStatus(item.id, s)}
                          className={`text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded border transition-all ${
                            item.status === s
                              ? STATUS_STYLES[s].classes + ' opacity-100'
                              : 'border-border-dim text-ink-dim hover:text-ink bg-transparent'
                          }`}
                        >
                          {STATUS_STYLES[s].label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
