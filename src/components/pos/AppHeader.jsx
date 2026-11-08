import React from 'react';
import ThemeToggle from '@/components/ui/ThemeToggle';
import { Settings, LockKeyhole, Clock3 } from 'lucide-react';
import { SURFACE, TEAL, TEAL_LIGHT } from '@/data/themePalette';
import BrandLogo from '@/components/ui/BrandLogo';

const TABS = [
  { id: 'floor', label: 'Floor Plan', icon: '⬛' },
  { id: 'order', label: 'Order Taking', icon: '📋' },
  { id: 'bill', label: 'Bill & Payment', icon: '🧾' },
];

const money = (value) => Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AppHeader({ activeTab, onTabChange, activeTable, onCloseShift, shift, onManageMenu, onOpenSettings, propertyName }) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' });
  const openedAt = shift?.opened_at ? new Date(shift.opened_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div className="shrink-0" style={{ background: SURFACE, borderBottom: '1px solid var(--border)' }}>
      <header className="flex min-h-14 items-center justify-between gap-3 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <BrandLogo className="h-9 w-auto max-w-[138px] object-contain object-left" />
          <div className="flex min-w-0 flex-col leading-tight"><span className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--primary)]">Point of Sale</span><span className="max-w-[180px] truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>{propertyName || 'Restaurant POS'}</span></div>
        </div>

        <nav className="flex min-w-0 gap-1 overflow-x-auto" aria-label="POS sections">
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            const isDisabled = (tab.id === 'order' || tab.id === 'bill') && !activeTable;
            return (
              <button key={tab.id} type="button" onClick={() => !isDisabled && onTabChange(tab.id)} disabled={isDisabled}
                className="whitespace-nowrap rounded-t px-2 py-2 text-xs font-medium transition-all sm:px-4 sm:text-sm"
                style={{ background: isActive ? TEAL : 'transparent', color: isActive ? 'var(--primary-foreground)' : isDisabled ? 'var(--text-muted)' : 'var(--primary)', cursor: isDisabled ? 'not-allowed' : 'pointer', marginBottom: isActive ? '-1px' : '0', fontFamily: 'system-ui, sans-serif' }}>
                {tab.label}{tab.id === 'order' && activeTable && <span className="ml-1 text-xs opacity-70">· T{activeTable.number}</span>}
              </button>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          {onManageMenu && <button type="button" onClick={onManageMenu} className="hidden min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--primary-soft)] px-3 py-2 text-xs font-bold text-[var(--primary)] hover:bg-[var(--sidebar)] sm:inline-flex">Menu</button>}
          {onOpenSettings && <button type="button" onClick={onOpenSettings} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-xs font-bold text-[var(--text)] hover:bg-[var(--sidebar)] sm:px-3" aria-label="Open POS settings"><Settings size={16} /><span className="hidden sm:inline">Settings</span></button>}
          <div className="text-right">
            <div className="font-mono text-sm font-bold text-[var(--primary)] sm:text-base">{timeStr}</div>
            <div className="text-[10px] sm:text-xs" style={{ color: TEAL_LIGHT }}>{dateStr}</div>
          </div>
          <ThemeToggle compact />
        </div>
      </header>

      {shift?.status === 'open' && (
        <section aria-label="Current POS shift status" className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--primary-soft)] px-3 py-2.5 sm:px-4">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 font-black uppercase tracking-wide text-emerald-800"><span className="h-2 w-2 rounded-full bg-emerald-600" /> Shift Open</span>
            <span className="font-semibold text-[var(--text)]">{shift.shift_no || 'Active shift'}</span>
            {openedAt && <span className="inline-flex items-center gap-1 text-[var(--text-muted)]"><Clock3 size={13} /> Started {openedAt}</span>}
            <span className="text-[var(--text-muted)]">Opening float: <b className="text-[var(--text)]">KES {money(shift.opening_cash)}</b></span>
          </div>
          {onCloseShift && <button type="button" onClick={onCloseShift} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-xs font-black text-primary-foreground shadow-sm transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"><LockKeyhole size={15} /> Close Shift</button>}
        </section>
      )}
    </div>
  );
}
