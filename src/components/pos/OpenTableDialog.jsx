import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { NAVY, TEAL, SAND, SURFACE, SURFACE2, BORDER, MUTED, ERR } from '@/data/themePalette';
import { tableLabel } from '@/data/mockData';

export default function OpenTableDialog({ open, table, staff, onCancel, onStart }) {
  const [guests, setGuests] = useState('');
  const [waiter, setWaiter] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setGuests('');
      setWaiter('');
      setError('');
    }
  }, [open, table?.id]);

  if (!open || !table) return null;

  const valid = Number(guests) > 0 && waiter;

  const submit = () => {
    if (!valid) {
      setError('Guest count and waiter are both required before opening the table.');
      return;
    }
    onStart({ guests: Number(guests), waiter });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(14,39,64,0.6)' }}>
      <div className="w-full max-w-sm rounded-2xl overflow-hidden" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between px-5 py-3" style={{ background: NAVY }}>
          <div className="text-sm font-semibold" style={{ color: SAND }}>Open Table</div>
          <button onClick={onCancel} aria-label="Close"><X size={16} style={{ color: 'rgba(234,227,210,0.7)' }} /></button>
        </div>

        <div className="p-5">
          <div className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: MUTED }}>
            {table.zoneName} · Table {tableLabel(table)} · {table.seats} seats
          </div>

          <label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Number of guests *</label>
          <input
            type="number" min="1" value={guests} placeholder="e.g. 4"
            onChange={(e) => setGuests(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg mb-4 text-base font-mono font-bold outline-none"
            style={{ background: SURFACE2, border: `1.5px solid ${BORDER}`, color: NAVY }}
          />

          <label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Waiter *</label>
          <select
            value={waiter} onChange={(e) => setWaiter(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg mb-2 text-base outline-none"
            style={{ background: SURFACE2, border: `1.5px solid ${BORDER}`, color: NAVY }}
          >
            <option value="">Select waiter…</option>
            {staff.map((s) => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
          </select>
          {staff.length === 0 && (
            <div className="text-xs mb-1" style={{ color: ERR }}>No waiters configured — add staff in the Staff screen first.</div>
          )}

          {error && <div className="text-xs mt-2" style={{ color: ERR }}>{error}</div>}

          <div className="flex gap-2 mt-4">
            <button
              onClick={onCancel}
              className="flex-1 py-3 rounded-xl text-sm font-semibold"
              style={{ background: SURFACE, border: `1.5px solid ${BORDER}`, color: NAVY }}
            >
              Cancel
            </button>
            <button
              onClick={submit} disabled={!valid}
              className="flex-1 py-3 rounded-xl text-sm font-bold"
              style={{ background: valid ? TEAL : 'var(--border)', color: 'var(--primary-foreground)', cursor: valid ? 'pointer' : 'not-allowed' }}
            >
              Start Order
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}