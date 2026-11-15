import React, { useState } from 'react';
import { useStore } from '@/data/AppStore';
import { LayoutGrid, Plus, Pencil, Trash2, Check, X, Users } from 'lucide-react';

export default function TablesTab() {
  const store = useStore();
  const [zoneName, setZoneName] = useState('');
  const [zoneEdits, setZoneEdits] = useState({});
  const [newTables, setNewTables] = useState({});
  const [editingTable, setEditingTable] = useState(null);
  const [message, setMessage] = useState('');

  const addZone = (event) => {
    event.preventDefault();
    if (!zoneName.trim()) return;
    if (store.addZone(zoneName)) { setZoneName(''); setMessage('Floor zone added.'); }
  };
  const removeZone = (zone) => {
    if (!window.confirm(`Remove “${zone.name}” and its floor tables? Active table sessions must be closed first.`)) return;
    if (!store.removeZone(zone.id)) setMessage('This zone contains an active or unsettled table session. Close or settle it before removing the zone.');
    else setMessage('Floor zone removed.');
  };
  const addTable = (event, zone) => {
    event.preventDefault();
    const draft = newTables[zone.id] || {};
    const result = store.addTable(zone.id, { number: draft.number || undefined, seats: draft.seats || 4 });
    if (!result) { setMessage('Table number must be unique within this zone.'); return; }
    setNewTables((prev) => ({ ...prev, [zone.id]: { number: '', seats: 4 } }));
    setMessage('Table added.');
  };
  const saveTable = (event) => {
    event.preventDefault();
    if (!editingTable) return;
    const ok = store.updateTable(editingTable.zoneId, editingTable.id, {
      number: editingTable.number,
      seats: Number(editingTable.seats),
    });
    if (!ok) { setMessage('Could not save: table number must be unique and seating capacity must be valid.'); return; }
    setEditingTable(null);
    setMessage('Table updated.');
  };
  const deleteTable = (zone, table) => {
    if (!window.confirm(`Remove table ${table.number} from ${zone.name}?`)) return;
    if (!store.removeTable(zone.id, table.id)) setMessage('This table has an active or unsettled session. Settle or close it before removing the table.');
    else setMessage('Table removed.');
  };

  return <section className="space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
    <div className="flex items-start gap-3">
      <LayoutGrid size={22} className="mt-1 shrink-0 text-[var(--primary)]" />
      <div><h3 className="font-bold">Table Setup</h3><p className="mt-1 text-sm text-[var(--text-muted)]">Manage shared floor zones, table numbers and seating capacity. Changes are synchronized across authorized POS terminals.</p></div>
    </div>

    {store.floorLoading ? <div role="status" aria-live="polite" className="space-y-3">
      <div className="h-10 animate-pulse rounded-xl bg-[var(--canvas)]" />
      {[1, 2].map((n) => <div key={n} className="space-y-3 rounded-xl border border-[var(--border)] p-4"><div className="h-5 w-1/3 animate-pulse rounded bg-[var(--canvas)]" /><div className="h-16 animate-pulse rounded-lg bg-[var(--canvas)]" /></div>)}
      <p className="text-sm text-[var(--text-muted)]">Loading this property's floor configuration…</p>
    </div> : store.floorError ? <div role="alert" className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger-text)]">Could not load or synchronize the floor configuration: {store.floorError}. Existing POS sessions and orders have not been changed.</div> : <>
      <form onSubmit={addZone} className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3 sm:flex-row">
        <input aria-label="New floor zone name" value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder="New zone name (e.g. Main Restaurant)" maxLength={60} className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" />
        <button type="submit" disabled={!zoneName.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 text-sm font-bold text-[var(--on-primary)] disabled:opacity-50"><Plus size={16} /> Add zone</button>
      </form>

      {message && <p role="status" aria-live="polite" className="rounded-lg bg-[var(--primary-soft)] px-3 py-2 text-sm text-[var(--text)]">{message}</p>}

      {store.zones.length === 0 ? <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center"><LayoutGrid size={28} className="mx-auto text-[var(--text-muted)]" /><h4 className="mt-2 font-semibold">No floor zones yet</h4><p className="mt-1 text-sm text-[var(--text-muted)]">Add your first zone above, then create its tables.</p></div> :
        <div className="space-y-4">{store.zones.map((zone) => <article key={zone.id} className="rounded-xl border border-[var(--border)] p-3 sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <form onSubmit={(e) => { e.preventDefault(); const ok = store.renameZone(zone.id, zoneEdits[zone.id] ?? zone.name); if (ok) { setZoneEdits((prev) => { const next = { ...prev }; delete next[zone.id]; return next; }); setMessage('Zone renamed.'); } }} className="flex min-w-0 flex-1 gap-2">
              <input aria-label={`Zone name for ${zone.name}`} value={zoneEdits[zone.id] ?? zone.name} onChange={(e) => setZoneEdits((prev) => ({ ...prev, [zone.id]: e.target.value }))} maxLength={60} className="min-h-10 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-3 text-sm font-semibold text-[var(--text)]" />
              <button type="submit" title="Save zone name" aria-label="Save zone name" className="flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--primary)]"><Check size={16} /></button>
            </form>
            <button type="button" onClick={() => removeZone(zone)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 text-sm text-[var(--danger-text)]"><Trash2 size={15} /> Remove zone</button>
          </div>

          <form onSubmit={(e) => addTable(e, zone)} className="mt-3 grid grid-cols-1 gap-2 rounded-lg bg-[var(--canvas)] p-3 sm:grid-cols-[1fr_130px_auto] sm:items-end">
            <label className="text-xs font-semibold text-[var(--text-muted)]">Table number
              <input value={newTables[zone.id]?.number ?? ''} onChange={(e) => setNewTables((prev) => ({ ...prev, [zone.id]: { number: e.target.value, seats: prev[zone.id]?.seats ?? 4 } }))} placeholder={`Auto (${zone.tables.length + 1})`} maxLength={20} className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" />
            </label>
            <label className="text-xs font-semibold text-[var(--text-muted)]">Seating capacity
              <input type="number" min="1" max="50" value={newTables[zone.id]?.seats ?? 4} onChange={(e) => setNewTables((prev) => ({ ...prev, [zone.id]: { number: prev[zone.id]?.number ?? '', seats: e.target.value } }))} className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" />
            </label>
            <button type="submit" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-3 text-sm font-bold text-[var(--on-primary)]"><Plus size={15} /> Add table</button>
          </form>

          <div className="mt-3 space-y-2">
            {zone.tables.map((table) => editingTable?.id === table.id ? <form key={table.id} onSubmit={saveTable} className="grid grid-cols-1 gap-2 rounded-lg border border-[var(--primary)] bg-[var(--canvas)] p-3 sm:grid-cols-[1fr_130px_auto_auto] sm:items-end">
              <label className="text-xs font-semibold text-[var(--text-muted)]">Table number<input autoFocus value={editingTable.number} onChange={(e) => setEditingTable((prev) => ({ ...prev, number: e.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" /></label>
              <label className="text-xs font-semibold text-[var(--text-muted)]">Seats<input type="number" min="1" max="50" value={editingTable.seats} onChange={(e) => setEditingTable((prev) => ({ ...prev, seats: e.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]" /></label>
              <button type="submit" className="min-h-10 rounded-lg bg-[var(--primary)] px-3 text-sm font-bold text-[var(--on-primary)]"><Check size={15} className="inline" /> Save</button>
              <button type="button" onClick={() => setEditingTable(null)} className="min-h-10 rounded-lg border border-[var(--border)] px-3 text-sm"><X size={15} className="inline" /> Cancel</button>
            </form> : <div key={table.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--primary-soft)] text-sm font-bold text-[var(--primary)]">{table.number}</span>
              <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-[var(--text)]">Table {table.number}</div><div className="flex items-center gap-1 text-xs text-[var(--text-muted)]"><Users size={13} /> {table.seats} seats</div></div>
              <button type="button" onClick={() => setEditingTable({ ...table, zoneId: zone.id })} aria-label={`Edit table ${table.number}`} title="Edit table" className="flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text)]"><Pencil size={15} /></button>
              <button type="button" onClick={() => deleteTable(zone, table)} aria-label={`Remove table ${table.number}`} title="Remove table" className="flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--danger-text)]"><Trash2 size={15} /></button>
            </div>)}
            {zone.tables.length === 0 && <p className="py-3 text-center text-sm text-[var(--text-muted)]">No tables in this zone yet.</p>}
          </div>
        </article>)}</div>}
    </>}
  </section>;
}
