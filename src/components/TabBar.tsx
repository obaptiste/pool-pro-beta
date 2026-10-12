import React from 'react';
import { Droplets, LayoutDashboard, ListChecks, MoreHorizontal, Package } from 'lucide-react';

export type Tab = 'home' | 'readings' | 'tasks' | 'supplies' | 'more';

interface Props {
  active: Tab;
  onSelect: (tab: Tab) => void;
}

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' }> }[] = [
  { id: 'home', label: 'Home', icon: LayoutDashboard },
  { id: 'readings', label: 'Readings', icon: Droplets },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'supplies', label: 'Supplies', icon: Package },
  { id: 'more', label: 'More', icon: MoreHorizontal },
];

/** Persistent bottom navigation. Sits above full-screen tab views (z-50) but below modals (z-60+). */
export default function TabBar({ active, onSelect }: Props) {
  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 left-0 right-0 z-[55] bg-bg/90 backdrop-blur-[12px] border-t border-border-dim no-print"
      style={{ paddingBottom: 'calc(8px + env(safe-area-inset-bottom))' }}
    >
      <div className="max-w-4xl mx-auto grid grid-cols-5 px-2 pt-2">
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              aria-current={isActive ? 'page' : undefined}
              className={`h-[52px] flex flex-col items-center justify-center gap-[5px] rounded-[10px] transition-colors active:scale-95 ${isActive ? 'text-accent' : 'text-ink-dim'}`}
            >
              <Icon size={22} aria-hidden="true" />
              <span className="text-[9px] font-bold tracking-[0.12em] uppercase">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
