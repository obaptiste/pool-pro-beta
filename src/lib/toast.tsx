import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  show: (message: string, variant?: ToastVariant) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let idCounter = 0;
function makeId(): string {
  const cryptoRef = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  idCounter += 1;
  return `toast-${Date.now()}-${idCounter}`;
}

const VARIANT_STYLES: Record<ToastVariant, { border: string; iconColor: string; Icon: typeof CheckCircle2 }> = {
  success: { border: 'border-success/60', iconColor: 'text-success', Icon: CheckCircle2 },
  error: { border: 'border-critical/60', iconColor: 'text-critical', Icon: XCircle },
  warning: { border: 'border-warning/60', iconColor: 'text-warning', Icon: AlertTriangle },
  info: { border: 'border-accent/60', iconColor: 'text-accent', Icon: Info },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback((message: string, variant: ToastVariant = 'success') => {
    const id = makeId();
    setToasts((prev) => [...prev, { id, message, variant }]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timers.current.delete(id);
    }, variant === 'error' ? 6000 : 3000);
    timers.current.set(id, timer);
  }, []);

  useEffect(() => {
    const currentTimers = timers.current;
    return () => {
      currentTimers.forEach(clearTimeout);
      currentTimers.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({
    show,
    success: (m) => show(m, 'success'),
    error: (m) => show(m, 'error'),
    info: (m) => show(m, 'info'),
    warning: (m) => show(m, 'warning'),
  }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none max-w-[calc(100vw-3rem)]"
        role="region"
        aria-label="Notifications"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const { border, iconColor, Icon } = VARIANT_STYLES[toast.variant];
            return (
              <motion.div
                key={toast.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className={`pointer-events-auto panel ${border} px-4 py-3 flex items-center gap-3 min-w-[260px] shadow-2xl`}
                role={toast.variant === 'error' ? 'alert' : 'status'}
                aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
              >
                <Icon size={18} className={`${iconColor} flex-shrink-0`} />
                <span className="text-sm text-white flex-1">{toast.message}</span>
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  className="text-ink-dim hover:text-white transition-colors flex-shrink-0"
                  aria-label="Dismiss notification"
                >
                  <X size={14} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
