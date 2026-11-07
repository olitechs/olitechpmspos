import React, { useEffect, useState } from 'react';
import { Search, ChevronDown } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { tableLabel } from '@/data/mockData';

export default function TopBar({ moduleLabel, activeTable }) {
  const { user } = useAuth();
  const business = { name: user?.property?.name || user?.property?.business_name || 'Property' };
  const branch = { name: user?.property?.branch_name || user?.property?.city || '' };
  const [activeStaff, setActiveStaff] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('olitech_active_staff_v2') || 'null'); } catch { return null; }
  });

  useEffect(() => {
    const handleStaffChange = (event) => setActiveStaff(event.detail || null);
    window.addEventListener('olitech:staff-changed', handleStaffChange);
    return () => window.removeEventListener('olitech:staff-changed', handleStaffChange);
  }, []);

  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const displayName = activeStaff?.full_name || user?.name || user?.email?.split('@')[0] || 'Staff';
  const displayRole = activeStaff?.role || user?.staff?.role || user?.propertyRole || user?.role || 'Staff';
  const avatar = activeStaff?.avatar || displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

  return (
    <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 text-[var(--text)] sm:px-5 lg:flex-nowrap lg:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
        <div className="min-w-0 shrink-0">
          <div className="truncate text-sm font-medium leading-tight">{moduleLabel}</div>
          {activeTable && <div className="mt-0.5 truncate text-xs text-[var(--text-muted)]">Table {tableLabel(activeTable)} · {activeTable.seats} seats</div>}
        </div>
        <div className="hidden w-64 shrink-0 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 md:flex lg:w-80">
          <Search size={15} className="shrink-0 text-[var(--text-muted)]" />
          <input type="text" placeholder="Search tables, guests, orders…" className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]" />
        </div>
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
        <button type="button" className="flex min-h-11 max-w-[180px] items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--canvas)] px-3 text-sm text-[var(--text)] sm:max-w-[220px] sm:px-4">
          <span className="truncate font-medium">{business.name}</span>
          {branch.name && <><span className="text-[var(--text-muted)]">·</span><span className="hidden truncate text-[var(--text-muted)] lg:inline">{branch.name}</span></>}
          <ChevronDown size={14} className="shrink-0 text-[var(--text-muted)]" />
        </button>
        <div className="hidden text-right leading-tight lg:block">
          <div className="font-mono text-sm font-medium">{timeStr}</div>
          <div className="text-xs text-[var(--text-muted)]">{dateStr}</div>
        </div>
        <div className="flex min-w-0 items-center gap-2 border-l border-[var(--border)] pl-2 sm:pl-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-xs font-bold text-[var(--on-primary)]">{avatar}</div>
          <div className="hidden min-w-0 sm:block">
            <div className="max-w-[130px] truncate text-xs font-medium leading-tight">{displayName}</div>
            <div className="max-w-[130px] truncate text-xs text-[var(--text-muted)]">{displayRole}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
