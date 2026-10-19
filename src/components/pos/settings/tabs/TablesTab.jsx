import React from 'react';
import { useStore } from '@/data/AppStore';
import { LayoutGrid } from 'lucide-react';

export default function TablesTab() {
  const store = useStore();
  return <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
    <div className="flex items-start gap-3"><LayoutGrid size={22} className="mt-1 text-[var(--primary)]"/><div><h3 className="font-bold">Tables and zones</h3><p className="mt-1 text-sm text-[var(--text-muted)]">Current floor zones and tables are loaded from the existing POS store.</p></div></div>
    <div className="mt-5 space-y-3">{store.zones.map(zone => <div key={zone.id} className="rounded-xl border border-[var(--border)] p-4"><div className="font-semibold">{zone.name}</div><div className="mt-2 flex flex-wrap gap-2">{zone.tables.map(table => <span key={table.id} className="rounded-lg bg-[var(--canvas)] px-3 py-2 text-sm">{table.label || `T${table.number}`} · {table.seats} seats</span>)}</div></div>)}</div>
    <p className="mt-4 rounded-xl bg-[var(--primary-soft)] p-3 text-sm text-[var(--text)]">Database-backed table editing and waiter assignment are being added in the Tables implementation phase. Existing floor layout and sessions are preserved.</p>
  </section>;
}
