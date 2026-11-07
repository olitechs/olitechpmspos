import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)] p-4" role="presentation">
      <div className="overlay-surface max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]" role="dialog" aria-modal="true" aria-labelledby="open-table-title" aria-describedby="open-table-guidance">
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--sidebar)] px-5 py-3">
          <div id="open-table-title" className="text-base font-bold text-[var(--text)]">Open Table</div>
          <button type="button" onClick={onCancel} aria-label="Close open table dialog" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--primary-soft)]"><X size={18} /></button>
        </div>

        <div className="p-5">
          <div id="open-table-guidance" className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--primary-soft)] p-3 text-sm text-[var(--text)]">
            <div className="font-bold">Before you start</div>
            <div className="mt-1 text-[var(--text-muted)]">Enter the number of guests and assign a waiter. Both fields are required.</div>
          </div>

          <div className="mb-4 text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
            {table.zoneName} · Table {tableLabel(table)} · {table.seats} seats
          </div>

          <label className="mb-1 block text-sm font-bold text-[var(--text)]" htmlFor="open-table-guests">Number of guests <span aria-hidden="true">*</span><span className="sr-only">required</span></label>
          <input
            id="open-table-guests"
            type="number"
            min="1"
            value={guests}
            placeholder="e.g. 4"
            onChange={(e) => setGuests(e.target.value)}
            aria-required="true"
            aria-invalid={Boolean(guests) && Number(guests) <= 0}
            aria-describedby="guest-guidance"
            className="mb-1 min-h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-base font-bold text-[var(--text)] outline-none focus:border-[var(--primary)]"
          />
          <div id="guest-guidance" className="mb-4 text-xs text-[var(--text-muted)]">Use a whole number of at least 1.</div>

          <label className="mb-1 block text-sm font-bold text-[var(--text)]" htmlFor="open-table-waiter">Waiter <span aria-hidden="true">*</span><span className="sr-only">required</span></label>
          <select
            id="open-table-waiter"
            value={waiter}
            onChange={(e) => setWaiter(e.target.value)}
            aria-required="true"
            aria-invalid={!waiter}
            aria-describedby="waiter-guidance"
            className="min-h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-base text-[var(--text)] outline-none focus:border-[var(--primary)]"
          >
            <option value="">Select waiter…</option>
            {staff.map((s) => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
          </select>
          <div id="waiter-guidance" className="mt-1 text-xs text-[var(--text-muted)]">Choose the staff member responsible for this table.</div>
          {staff.length === 0 && (
            <div className="mt-2 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-2 text-sm font-semibold text-[var(--danger-text)]">No waiters configured — add staff in the Staff screen first.</div>
          )}

          {error && <div role="alert" className="mt-3 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm font-semibold text-[var(--danger-text)]">{error}</div>}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-12 flex-1 rounded-xl border-2 border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--text)] hover:bg-[var(--primary-soft)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!valid}
              className="min-h-12 flex-1 rounded-xl bg-[var(--primary)] px-3 text-sm font-bold text-[var(--on-primary)] hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:bg-[var(--sidebar)] disabled:text-[var(--text-muted)]"
            >
              Start Order
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
