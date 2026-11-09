import React from 'react';
import { Settings } from 'lucide-react';
import { SURFACE, TEAL, TEAL_LIGHT } from '@/data/themePalette';
import BrandLogo from '@/components/ui/BrandLogo';

const TABS = [
  { id: 'floor', label: 'Floor Plan', icon: '▦' },
  { id: 'order', label: 'Order Taking', icon: '▤' },
  { id: 'bill', label: 'Bill & Payment', icon: '▧' },
  { id: 'shifts', label: 'Shifts', icon: '◷' },
];

export default function AppHeader({ activeTab, onTabChange, activeTable, onCloseShift, shift, hasOpenShift = false, onOpenShifts, onManageMenu, onOpenSettings, propertyName }) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <>
    <header
      className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2 md:flex-nowrap md:px-4"
      style={{ background: SURFACE, minHeight: '60px', borderBottom: '1px solid var(--border)' }}
    >
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
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => { if (tab.id === 'shifts') onOpenShifts?.(); else if (!isDisabled) onTabChange(tab.id); }}
              disabled={isDisabled}
              aria-current={isActive ? 'page' : undefined}
              className="min-h-11 shrink-0 rounded-t px-3 py-2 text-xs font-semibold transition-colors sm:px-4 sm:text-sm"
              style={{
                background: isActive ? TEAL : 'transparent',
                color: isActive ? 'var(--on-primary)' : isDisabled ? 'var(--text-muted)' : 'var(--primary)',
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                marginBottom: isActive ? '-1px' : '0',
                fontFamily: 'system-ui, sans-serif',
              }}
            >
              {tab.label}
              {tab.id === 'order' && activeTable && <span className="ml-1 text-xs opacity-90">· T{activeTable.number}</span>}
            </button>
          );
        })}
      </nav>

      <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
        {onManageMenu && <button type="button" onClick={onManageMenu} className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--primary-soft)] px-2.5 text-xs font-bold text-[var(--primary)] hover:bg-[var(--sidebar)] sm:px-3">Menu</button>}
        {onOpenSettings && <button type="button" onClick={onOpenSettings} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs font-bold text-[var(--text)] hover:bg-[var(--sidebar)] sm:px-3" aria-label="Open POS settings"><Settings size={16} /> <span className="hidden sm:inline">Settings</span></button>}
        {shift?.status === 'open' && onCloseShift && <button type="button" onClick={onCloseShift} className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--primary-soft)] px-2.5 text-xs font-bold text-[var(--primary)] hover:bg-[var(--sidebar)] sm:px-3">Close Shift</button>}
        <div className="hidden text-right md:block">
          <div className="font-mono text-sm font-bold text-[var(--primary)]">{timeStr}</div>
          <div className="text-xs" style={{ color: TEAL_LIGHT }}>{dateStr}</div>
        </div>
      </div>
    </header>
    {!hasOpenShift && (
      <button
        type="button"
        onClick={() => onOpenShifts?.()}
        className="flex min-h-11 w-full items-center justify-center gap-2 border-b border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-2 text-sm font-bold text-[var(--danger-text)] transition-colors hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--danger)]"
        aria-label="No open shift. Open shift management."
      >
        <span aria-hidden="true">●</span>
        No open shift — open a shift before taking orders
        <span aria-hidden="true">→</span>
      </button>
    )}
    </>
  );
}
