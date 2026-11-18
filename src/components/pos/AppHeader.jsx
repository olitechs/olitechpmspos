import React, { useEffect, useState } from 'react';
import { LogOut, Settings, UtensilsCrossed } from 'lucide-react';
import BrandLogo from '@/components/ui/BrandLogo';

const TABS = [
  { id: 'floor', label: 'Floor Plan' },
  { id: 'order', label: 'Order Taking' },
  { id: 'bill', label: 'Bill & Payment' },
  { id: 'shifts', label: 'Shifts' },
];

// One shape for every header action: same height, radius and border. Emphasis
// is carried by colour only, so the row reads as a group instead of three
// competing buttons.
const ACTION_BASE = 'inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]';
const ACTION_NEUTRAL = `${ACTION_BASE} border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--sidebar)]`;
const ACTION_PRIMARY = `${ACTION_BASE} border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)] hover:bg-[var(--sidebar)]`;

export default function AppHeader({ activeTab, onTabChange, activeTable, onCloseShift, shift, hasOpenShift = false, onOpenShifts, onManageMenu, onOpenSettings, propertyName }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Keep the header clock live: re-render on a short interval so the POS never shows a frozen time.
    const timer = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);
  const timeStr = now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <>
    <header className="flex min-h-[60px] shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 md:flex-nowrap md:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <BrandLogo className="h-9 w-auto max-w-[120px] shrink-0 object-contain object-left sm:max-w-[138px]" />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--primary)]">Point of Sale</span>
          <span className="max-w-[150px] truncate text-[11px] text-[var(--text-muted)] sm:max-w-[180px]">{propertyName || 'Restaurant POS'}</span>
        </div>
      </div>

      <nav className="order-3 flex max-w-full gap-1 overflow-x-auto md:order-none" aria-label="POS workflow">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const isDisabled = (!hasOpenShift && tab.id !== 'shifts') || ((tab.id === 'order' || tab.id === 'bill') && !activeTable);
          const stateClass = isActive
            ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-sm'
            : isDisabled
              ? 'cursor-not-allowed text-[var(--text-muted)] opacity-60'
              : 'text-[var(--text)] hover:bg-[var(--primary-soft)] hover:text-[var(--primary)]';
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => { if (tab.id === 'shifts') onOpenShifts?.(); else if (!isDisabled) onTabChange(tab.id); }}
              disabled={isDisabled}
              aria-current={isActive ? 'page' : undefined}
              className={`min-h-11 shrink-0 rounded-xl px-3 py-2 text-xs font-semibold transition-colors sm:px-4 sm:text-sm ${stateClass}`}
            >
              {tab.label}
              {tab.id === 'order' && activeTable && <span className="ml-1 text-xs opacity-90">· T{activeTable.number}</span>}
            </button>
          );
        })}
      </nav>

      <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
        {onManageMenu && (
          <button type="button" onClick={onManageMenu} className={ACTION_NEUTRAL} aria-label="Manage the POS menu">
            <UtensilsCrossed size={16} aria-hidden="true" /> <span className="hidden sm:inline">Menu</span>
          </button>
        )}
        {onOpenSettings && (
          <button type="button" onClick={onOpenSettings} className={ACTION_NEUTRAL} aria-label="Open POS settings">
            <Settings size={16} aria-hidden="true" /> <span className="hidden sm:inline">Settings</span>
          </button>
        )}
        {shift?.status === 'open' && onCloseShift && (
          <button type="button" onClick={onCloseShift} className={ACTION_PRIMARY} aria-label="Close the current POS shift">
            <LogOut size={16} aria-hidden="true" /> <span className="hidden sm:inline">Close Shift</span>
          </button>
        )}
        <div className="hidden text-right md:block">
          <div className="font-mono text-sm font-bold tabular-nums text-[var(--primary)]">{timeStr}</div>
          <div className="text-xs text-[var(--text-muted)]">{dateStr}</div>
        </div>
      </div>
    </header>
    {!hasOpenShift && (
      <div
        role="status"
        className="flex min-h-11 w-full items-center justify-center gap-2 border-b border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-2 text-sm font-bold text-[var(--danger-text)]"
        aria-label="No shift is open. Sales are blocked until a shift is opened."
      >
        <span aria-hidden="true">●</span>
        No shift is open. Sales are blocked until you open one.
        <span aria-hidden="true">→</span>
      </div>
    )}
    </>
  );
}
