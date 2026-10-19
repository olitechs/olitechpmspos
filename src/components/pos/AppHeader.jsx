import React from 'react';
import ThemeToggle from '@/components/ui/ThemeToggle';
import { SURFACE, TEAL, TEAL_LIGHT } from '@/data/themePalette';

const TABS = [
  { id: 'floor', label: 'Floor Plan', icon: '⬛' },
  { id: 'order', label: 'Order Taking', icon: '📋' },
  { id: 'bill', label: 'Bill & Payment', icon: '🧾' },
];

export default function AppHeader({ activeTab, onTabChange, activeTable, onCloseShift, shift, onManageMenu }) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <header className="flex items-center justify-between px-4 py-0 shrink-0" style={{ background: SURFACE, height: '56px', borderBottom: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2">
        <div className="flex flex-col leading-none">
          <span className="font-bold text-[var(--primary)] tracking-wide text-base font-mono tracking-[0.05em]">
            OliTechs POS
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Visiwa Beach Resort</span>
        </div>
      </div>

      <nav className="flex gap-1">
        {TABS.map(tab => {
          const isActive = activeTab === tab.id;
          const isDisabled = (tab.id === 'order' || tab.id === 'bill') && !activeTable;
          return (
            <button
              key={tab.id}
              onClick={() => !isDisabled && onTabChange(tab.id)}
              disabled={isDisabled}
              className="px-4 py-2 rounded-t text-sm font-medium transition-all"
              style={{
                background: isActive ? TEAL : 'transparent',
                color: isActive ? '#FFFFFF' : isDisabled ? 'var(--text-muted)' : 'var(--primary)',
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                marginBottom: isActive ? '-1px' : '0',
                fontFamily: 'system-ui, sans-serif',
              }}
            >
              {tab.label}
              {tab.id === 'order' && activeTable && (
                <span className="ml-1 text-xs opacity-70">· T{activeTable.number}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center gap-3">
        {onManageMenu && <button onClick={onManageMenu} className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--primary-soft)] px-3 py-2 text-xs font-black text-[var(--primary)] hover:bg-[var(--sidebar)]">Menu</button>}
        {shift?.status === 'open' && onCloseShift && (
          <button onClick={onCloseShift} className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--primary-soft)] px-3 py-2 text-xs font-black text-[var(--primary)] hover:bg-[var(--sidebar)]">
            Close Shift
          </button>
        )}
        <div className="text-right">
          <div className="text-[var(--primary)] font-mono text-base font-bold">{timeStr}</div>
          <div className="text-xs" style={{ color: TEAL_LIGHT }}>{dateStr}</div>
        </div>
      </div>
      <ThemeToggle compact />
    </header>
  );
}
