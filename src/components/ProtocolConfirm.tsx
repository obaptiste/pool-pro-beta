import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useModalFocus } from '../lib/useModalFocus';
import { isProtocolConfirmReady } from '../lib/protocolConfirm';

interface Props {
  open: boolean;
  /** Titles of the checklist steps about to be saved. */
  steps: string[];
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Shown before a protocol is executed. Saving the checklist is blocked until
 * the operator confirms the pool is unoccupied, circulation is running, and
 * names the products they have. Those answers gate the chemical steps that
 * follow, so they are asked each time rather than assumed.
 */
export default function ProtocolConfirm({ open, steps, onCancel, onConfirm }: Props) {
  const [unoccupied, setUnoccupied] = useState(false);
  const [circulating, setCirculating] = useState(false);
  const [products, setProducts] = useState('');
  const dialogRef = useModalFocus<HTMLDivElement>(open, onCancel);

  // Each opening starts from nothing confirmed.
  useEffect(() => {
    if (!open) return;
    setUnoccupied(false);
    setCirculating(false);
    setProducts('');
  }, [open]);

  const ready = isProtocolConfirmReady({ unoccupied, circulating, products });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="protocol-confirm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
        >
          <div className="absolute inset-0 bg-bg/70" onClick={onCancel} aria-hidden="true" />
          <div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="protocol-confirm-title"
            className="relative w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-surface border border-accent/30 shadow-[0_20px_40px_rgba(0,0,0,0.5)] p-5 flex flex-col gap-4"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="text-warning-text shrink-0 mt-px" aria-hidden="true" />
              <div className="flex flex-col gap-1">
                <h2 id="protocol-confirm-title" className="text-sm font-bold text-white">Confirm before executing</h2>
                <p className="text-xs text-ink-muted leading-relaxed">
                  These steps will be added to your checklist. Confirm the pool state and the products first.
                </p>
              </div>
            </div>

            <ol className="flex flex-col gap-2">
              {steps.map((step, idx) => (
                <li key={`${idx}-${step}`} className="flex items-start gap-2.5 text-xs text-ink">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-accent/10 text-accent text-[10px] font-bold flex items-center justify-center border border-accent/20">{idx + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <fieldset className="flex flex-col gap-3">
              <legend className="sr-only">Pool state</legend>
              <label className="flex items-center gap-3 min-h-11 text-sm text-ink cursor-pointer">
                <input type="checkbox" checked={unoccupied} onChange={(e) => setUnoccupied(e.target.checked)} className="w-5 h-5 accent-accent" />
                The pool is unoccupied or closed.
              </label>
              <label className="flex items-center gap-3 min-h-11 text-sm text-ink cursor-pointer">
                <input type="checkbox" checked={circulating} onChange={(e) => setCirculating(e.target.checked)} className="w-5 h-5 accent-accent" />
                Circulation and filtration are running.
              </label>
            </fieldset>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="protocol-confirm-products" className="text-[10px] font-bold uppercase tracking-widest text-ink-dim">
                Products and strengths for any chemical step
              </label>
              <input
                id="protocol-confirm-products"
                type="text"
                value={products}
                onChange={(e) => setProducts(e.target.value)}
                placeholder="e.g. 10% liquid chlorine, 31% muriatic acid"
                className="w-full min-h-11 px-3 rounded-lg bg-surface-2 border border-border-dim text-sm text-white placeholder:text-ink-dim focus:border-accent focus:outline-none"
              />
              <p className="text-[10px] text-ink-dim">Doses are for 68,000 litres. Follow each product label and your pool contractor's guidance.</p>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 min-h-11 px-4 rounded-xl bg-surface-2 border border-border-dim text-[10px] font-bold uppercase tracking-widest text-ink-muted hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={!ready}
                className="flex-1 min-h-11 px-4 rounded-xl bg-accent text-primary text-[10px] font-bold uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition-all"
              >
                Confirm and execute
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
