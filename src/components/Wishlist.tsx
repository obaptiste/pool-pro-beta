import React, { useEffect, useState } from 'react';
import {
  ListChecks,
  Plus,
  Trash2,
  X,
  ChevronDown,
  ChevronUp,
  Star,
  ExternalLink,
  Copy,
  Mail,
  MessageCircle,
  Check,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Priority, PurchaseOption, WishlistItem } from '../types';

interface WishlistProps {
  isOpen: boolean;
  onClose: () => void;
  items: WishlistItem[];
  onUpdateItem: (item: WishlistItem) => void;
  onDeleteItem: (id: string) => void;
}

const PRIORITY_COLORS: Record<Priority, string> = {
  low: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  medium: 'text-accent bg-accent/10 border-accent/30',
  high: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  critical: 'text-red-500 bg-red-500/10 border-red-500/30',
};

const emptyItem = (): Omit<WishlistItem, 'id' | 'uid' | 'createdAt'> => ({
  name: '',
  description: '',
  priority: 'medium',
  quantity: 1,
  estimatedCost: undefined,
  currency: 'USD',
  purchaseOptions: [],
});

function safeHttpUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(candidate);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const emptyOption = (): PurchaseOption => ({
  id: crypto.randomUUID(),
  vendor: '',
  url: '',
  price: undefined,
  currency: 'USD',
  qualityRating: 3,
  availability: '',
  notes: '',
});

function formatPlainText(items: WishlistItem[]): string {
  if (items.length === 0) return 'Equipment wishlist is empty.';
  const lines: string[] = ['Pool Equipment Wishlist', '========================', ''];
  items.forEach((item, idx) => {
    lines.push(`${idx + 1}. ${item.name} (x${item.quantity}) — priority: ${item.priority}`);
    if (item.description) lines.push(`   ${item.description}`);
    if (item.estimatedCost != null) {
      lines.push(`   Est. cost: ${item.estimatedCost} ${item.currency || ''}`.trim());
    }
    if (item.purchaseOptions.length > 0) {
      lines.push('   Where to buy:');
      item.purchaseOptions.forEach((opt) => {
        const bits: string[] = [`     - ${opt.vendor}`];
        if (opt.price != null) bits.push(`${opt.price} ${opt.currency || ''}`.trim());
        if (opt.qualityRating != null) bits.push(`quality ${opt.qualityRating}/5`);
        if (opt.availability) bits.push(opt.availability);
        lines.push(bits.join(' | '));
        const exportedUrl = safeHttpUrl(opt.url);
        if (exportedUrl) lines.push(`       ${exportedUrl}`);
        if (opt.notes) lines.push(`       Notes: ${opt.notes}`);
      });
    }
    lines.push('');
  });
  return lines.join('\n');
}

export default function Wishlist({ isOpen, onClose, items, onUpdateItem, onDeleteItem }: WishlistProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newItem, setNewItem] = useState<Omit<WishlistItem, 'id' | 'uid' | 'createdAt'>>(emptyItem());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exportedFlash, setExportedFlash] = useState<string | null>(null);

  const handleSaveNew = () => {
    if (!newItem.name.trim()) return;
    onUpdateItem({
      ...newItem,
      id: crypto.randomUUID(),
      uid: '',
      createdAt: new Date(),
    });
    setNewItem(emptyItem());
    setIsAdding(false);
  };

  const updateOption = (item: WishlistItem, option: PurchaseOption) => {
    const next = item.purchaseOptions.some((o) => o.id === option.id)
      ? item.purchaseOptions.map((o) => (o.id === option.id ? option : o))
      : [...item.purchaseOptions, option];
    onUpdateItem({ ...item, purchaseOptions: next });
  };

  const removeOption = (item: WishlistItem, optionId: string) => {
    onUpdateItem({ ...item, purchaseOptions: item.purchaseOptions.filter((o) => o.id !== optionId) });
  };

  const flashCopied = (label: string) => {
    setExportedFlash(label);
    window.setTimeout(() => setExportedFlash(null), 1800);
  };

  const handleCopy = async () => {
    const text = formatPlainText(items);
    try {
      await navigator.clipboard.writeText(text);
      flashCopied('Copied to clipboard');
    } catch {
      flashCopied('Copy failed');
    }
  };

  const handleEmail = () => {
    const subject = encodeURIComponent('Pool Equipment Wishlist');
    const body = encodeURIComponent(formatPlainText(items));
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
  };

  const handleWhatsApp = () => {
    const text = encodeURIComponent(formatPlainText(items));
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  if (!isOpen) return null;

  return (
    <div className="overlay z-[60] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-3xl panel rounded-3xl overflow-hidden flex flex-col max-h-[90vh] anim-fade-up"
      >
        <div className="panel-header p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent">
              <ListChecks size={24} />
            </div>
            <div>
              <h2
                className="text-xl font-bold text-white uppercase tracking-wider"
                style={{ fontFamily: "'Exo 2', sans-serif" }}
              >
                Equipment Wishlist
              </h2>
              <p className="text-[10px] text-ink-dim uppercase tracking-widest">
                Plan future equipment purchases &amp; compare suppliers
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface rounded-lg transition-colors text-ink-dim">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleCopy}
                disabled={items.length === 0}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-border-dim text-[10px] font-bold uppercase tracking-widest text-ink-dim hover:text-white hover:border-accent transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Copy size={14} />
                Copy
              </button>
              <button
                onClick={handleEmail}
                disabled={items.length === 0}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-border-dim text-[10px] font-bold uppercase tracking-widest text-ink-dim hover:text-white hover:border-accent transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Mail size={14} />
                Email
              </button>
              <button
                onClick={handleWhatsApp}
                disabled={items.length === 0}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-border-dim text-[10px] font-bold uppercase tracking-widest text-ink-dim hover:text-white hover:border-accent transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <MessageCircle size={14} />
                WhatsApp
              </button>
              <AnimatePresence>
                {exportedFlash && (
                  <motion.span
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-[10px] font-bold uppercase tracking-widest text-accent flex items-center gap-1"
                  >
                    <Check size={12} /> {exportedFlash}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <button
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-primary text-[10px] font-bold uppercase tracking-widest hover:brightness-110 transition-all"
            >
              <Plus size={16} />
              Add Wish
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
                    <label className="text-[10px] font-bold text-ink-dim uppercase tracking-widest">
                      Equipment Name
                    </label>
                    <input
                      type="text"
                      value={newItem.name}
                      onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                      className="w-full bg-[#060e1a] border border-border-dim rounded-xl px-4 py-2 text-sm focus:border-accent outline-none transition-all"
                      placeholder="e.g. Robotic Pool Cleaner"
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <label className="text-[10px] font-bold text-ink-dim uppercase tracking-widest">
                      Description / Specs
                    </label>
                    <textarea
                      value={newItem.description}
                      onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                      rows={2}
                      className="w-full bg-[#060e1a] border border-border-dim rounded-xl px-4 py-2 text-sm focus:border-accent outline-none transition-all resize-none"
                      placeholder="Why it's needed, model preferences, etc."
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-ink-dim uppercase tracking-widest">Priority</label>
                    <select
                      value={newItem.priority}
                      onChange={(e) => setNewItem({ ...newItem, priority: e.target.value as Priority })}
                      className="w-full bg-[#060e1a] border border-border-dim rounded-xl px-4 py-2 text-sm focus:border-accent outline-none transition-all"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-ink-dim uppercase tracking-widest">Quantity</label>
                    <input
                      type="number"
                      min={1}
                      value={newItem.quantity}
                      onChange={(e) => setNewItem({ ...newItem, quantity: Math.max(1, Number(e.target.value)) })}
                      className="w-full bg-[#060e1a] border border-border-dim rounded-xl px-4 py-2 text-sm focus:border-accent outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-ink-dim uppercase tracking-widest">
                      Est. Cost
                    </label>
                    <input
                      type="number"
                      value={newItem.estimatedCost ?? ''}
                      onChange={(e) =>
                        setNewItem({
                          ...newItem,
                          estimatedCost: e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      }
                      className="w-full bg-[#060e1a] border border-border-dim rounded-xl px-4 py-2 text-sm focus:border-accent outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-ink-dim uppercase tracking-widest">Currency</label>
                    <input
                      type="text"
                      value={newItem.currency || ''}
                      onChange={(e) => setNewItem({ ...newItem, currency: e.target.value })}
                      className="w-full bg-[#060e1a] border border-border-dim rounded-xl px-4 py-2 text-sm focus:border-accent outline-none transition-all"
                      placeholder="USD"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => {
                      setIsAdding(false);
                      setNewItem(emptyItem());
                    }}
                    className="px-4 py-2 text-[10px] font-bold text-ink-dim uppercase tracking-widest hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveNew}
                    className="px-6 py-2 rounded-xl bg-accent text-primary text-[10px] font-bold uppercase tracking-widest hover:brightness-110 transition-all"
                  >
                    Save Wish
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid gap-3">
            {items.map((item) => {
              const isExpanded = expandedId === item.id;
              return (
                <div
                  key={item.id}
                  className="rounded-2xl bg-surface border border-border-dim overflow-hidden anim-scan"
                >
                  <div className="p-4 flex items-start justify-between gap-3 group">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className="flex-1 text-left flex items-start gap-4"
                    >
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
                          PRIORITY_COLORS[item.priority]
                        }`}
                      >
                        <ListChecks size={20} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-bold text-white uppercase tracking-wide">{item.name}</h3>
                          <span
                            className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md border ${
                              PRIORITY_COLORS[item.priority]
                            }`}
                          >
                            {item.priority}
                          </span>
                          {item.quantity > 1 && (
                            <span className="text-[9px] font-bold uppercase tracking-widest text-ink-dim">
                              ×{item.quantity}
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <p className="text-xs text-ink-dim mt-1 line-clamp-2">{item.description}</p>
                        )}
                        <p className="text-[10px] text-ink-dim uppercase tracking-widest mt-1">
                          {item.purchaseOptions.length} purchase option
                          {item.purchaseOptions.length === 1 ? '' : 's'}
                          {item.estimatedCost != null
                            ? ` · est. ${item.estimatedCost} ${item.currency || ''}`.trim()
                            : ''}
                        </p>
                      </div>
                      <div className="text-ink-dim self-center">
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </div>
                    </button>
                    <button
                      onClick={() => onDeleteItem(item.id)}
                      className="p-2 text-ink-dim hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                      aria-label="Delete wish"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="border-t border-border-dim bg-[#060e1a]/40"
                      >
                        <div className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">
                              Where to Buy
                            </h4>
                            <button
                              onClick={() => updateOption(item, emptyOption())}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface border border-border-dim text-[10px] font-bold uppercase tracking-widest text-ink-dim hover:text-white hover:border-accent transition-all"
                            >
                              <Plus size={12} />
                              Option
                            </button>
                          </div>

                          {item.purchaseOptions.length === 0 && (
                            <p className="text-xs text-ink-dim italic">
                              No purchase options yet. Add a vendor to compare price, quality &amp; availability.
                            </p>
                          )}

                          {item.purchaseOptions.map((opt) => (
                            <PurchaseOptionRow
                              key={opt.id}
                              option={opt}
                              onChange={(next) => updateOption(item, next)}
                              onRemove={() => removeOption(item, opt.id)}
                            />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}

            {items.length === 0 && !isAdding && (
              <div className="text-center py-12 border-2 border-dashed border-border-dim rounded-3xl">
                <ListChecks size={40} className="mx-auto text-ink-dim mb-4 opacity-20" />
                <p className="text-ink-dim text-sm">No wishlist items yet.</p>
                <p className="text-ink-dim text-xs mt-1">
                  Add equipment you plan to acquire and track suppliers side-by-side.
                </p>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

interface PurchaseOptionRowProps {
  option: PurchaseOption;
  onChange: (option: PurchaseOption) => void;
  onRemove: () => void;
}

function PurchaseOptionRow({ option, onChange, onRemove }: PurchaseOptionRowProps) {
  const [draft, setDraft] = useState<PurchaseOption>(option);

  useEffect(() => {
    setDraft(option);
  }, [option.id]);

  const setLocal = <K extends keyof PurchaseOption>(field: K, value: PurchaseOption[K]) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  const commit = () => {
    if (
      draft.vendor !== option.vendor ||
      draft.url !== option.url ||
      draft.price !== option.price ||
      draft.currency !== option.currency ||
      draft.qualityRating !== option.qualityRating ||
      draft.availability !== option.availability ||
      draft.notes !== option.notes
    ) {
      onChange(draft);
    }
  };

  const setAndCommit = (next: PurchaseOption) => {
    setDraft(next);
    onChange(next);
  };

  const safeUrl = safeHttpUrl(draft.url);
  const urlIsInvalid = (draft.url || '').trim().length > 0 && !safeUrl;

  return (
    <div className="p-3 rounded-xl bg-surface border border-border-dim space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <div className="space-y-1 col-span-2 md:col-span-1">
          <label className="text-[9px] font-bold text-ink-dim uppercase tracking-widest">Vendor</label>
          <input
            type="text"
            value={draft.vendor}
            onChange={(e) => setLocal('vendor', e.target.value)}
            onBlur={commit}
            className="w-full bg-[#060e1a] border border-border-dim rounded-lg px-3 py-1.5 text-xs focus:border-accent outline-none transition-all"
            placeholder="e.g. Pool Warehouse"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[9px] font-bold text-ink-dim uppercase tracking-widest">Price</label>
          <input
            type="number"
            value={draft.price ?? ''}
            onChange={(e) =>
              setLocal('price', e.target.value === '' ? undefined : Number(e.target.value))
            }
            onBlur={commit}
            className="w-full bg-[#060e1a] border border-border-dim rounded-lg px-3 py-1.5 text-xs focus:border-accent outline-none transition-all"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[9px] font-bold text-ink-dim uppercase tracking-widest">Currency</label>
          <input
            type="text"
            value={draft.currency || ''}
            onChange={(e) => setLocal('currency', e.target.value)}
            onBlur={commit}
            className="w-full bg-[#060e1a] border border-border-dim rounded-lg px-3 py-1.5 text-xs focus:border-accent outline-none transition-all"
            placeholder="USD"
          />
        </div>
        <div className="space-y-1 col-span-2 md:col-span-3">
          <label className="text-[9px] font-bold text-ink-dim uppercase tracking-widest">Link</label>
          <div className="flex gap-2">
            <input
              type="url"
              value={draft.url || ''}
              onChange={(e) => setLocal('url', e.target.value)}
              onBlur={commit}
              className={`flex-1 bg-[#060e1a] border rounded-lg px-3 py-1.5 text-xs focus:border-accent outline-none transition-all ${
                urlIsInvalid ? 'border-red-500/50' : 'border-border-dim'
              }`}
              placeholder="https://"
            />
            {safeUrl && (
              <a
                href={safeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-lg bg-surface border border-border-dim text-ink-dim hover:text-accent transition-colors"
                aria-label="Open link"
              >
                <ExternalLink size={14} />
              </a>
            )}
          </div>
          {urlIsInvalid && (
            <p className="text-[9px] text-red-400 uppercase tracking-widest">
              Only http:// or https:// links are allowed
            </p>
          )}
        </div>
        <div className="space-y-1">
          <label className="text-[9px] font-bold text-ink-dim uppercase tracking-widest">Availability</label>
          <input
            type="text"
            value={draft.availability || ''}
            onChange={(e) => setLocal('availability', e.target.value)}
            onBlur={commit}
            className="w-full bg-[#060e1a] border border-border-dim rounded-lg px-3 py-1.5 text-xs focus:border-accent outline-none transition-all"
            placeholder="In stock / 2 wks"
          />
        </div>
        <div className="space-y-1 col-span-1 md:col-span-2">
          <label className="text-[9px] font-bold text-ink-dim uppercase tracking-widest">Quality</label>
          <div className="flex items-center gap-1 h-[30px]">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setAndCommit({ ...draft, qualityRating: n })}
                className="p-0.5"
                aria-label={`Rate quality ${n}`}
              >
                <Star
                  size={16}
                  className={
                    (draft.qualityRating ?? 0) >= n ? 'text-accent fill-accent' : 'text-ink-dim'
                  }
                />
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-[9px] font-bold text-ink-dim uppercase tracking-widest">Notes</label>
        <input
          type="text"
          value={draft.notes || ''}
          onChange={(e) => setLocal('notes', e.target.value)}
          onBlur={commit}
          className="w-full bg-[#060e1a] border border-border-dim rounded-lg px-3 py-1.5 text-xs focus:border-accent outline-none transition-all"
          placeholder="Warranty, shipping, contact, etc."
        />
      </div>
      <div className="flex justify-end">
        <button
          onClick={onRemove}
          className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-ink-dim hover:text-red-500 transition-colors"
        >
          <Trash2 size={12} />
          Remove option
        </button>
      </div>
    </div>
  );
}
