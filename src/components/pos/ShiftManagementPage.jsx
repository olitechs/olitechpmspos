import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, CheckCircle2, Clock3, Wallet } from 'lucide-react';
import { shiftService } from '@/services/shiftService';

const openingShiftSchema = z.object({
  openingCash: z.coerce.number().finite().positive('Enter an opening cash float greater than zero.'),
  notes: z.string().trim().max(500, 'Opening notes must be 500 characters or fewer.'),
});

const money = (value) => Number(value || 0).toLocaleString('en-KE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
};

export default function ShiftManagementPage({ propertyId, currentShift, loadError, onOpened }) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm({
    resolver: zodResolver(openingShiftSchema),
    defaultValues: { openingCash: '', notes: '' },
  });

  const submit = async (values) => {
    const shift = await shiftService.openShift({
      propertyId,
      openingCash: values.openingCash,
      notes: values.notes,
    });
    reset();
    onOpened?.(shift);
  };

  return (
    <main className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-8" aria-labelledby="pos-shifts-title">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)]">Point of Sale</p>
          <h1 id="pos-shifts-title" className="mt-1 text-2xl font-bold text-[var(--text)]">Shift Management</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
            Manage the active POS shift for this property. All POS staff and waiter sales share the same open shift.
          </p>
        </div>
        {currentShift ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--status-paid)] px-3 py-1.5 text-xs font-bold text-white">
            <CheckCircle2 size={15} /> Shift open
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--danger-soft)] px-3 py-1.5 text-xs font-bold text-[var(--danger-text)]">
            <AlertCircle size={15} /> No open shift
          </span>
        )}
      </div>

      {loadError && (
        <div role="alert" className="mb-5 flex items-start gap-3 rounded-2xl border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger-text)]">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-bold">Unable to verify the current shift</p>
            <p className="mt-1">{loadError}</p>
            <p className="mt-1 text-xs">Opening is disabled until the shift status can be verified. Refresh the POS and try again.</p>
          </div>
        </div>
      )}

      {currentShift ? (
        <section className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--canvas)] px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Active property shift</p>
              <h2 className="mt-1 text-lg font-bold text-[var(--text)]">{currentShift.shift_no || 'Current shift'}</h2>
            </div>
            <span className="rounded-full bg-[var(--status-paid)] px-3 py-1 text-xs font-bold text-white">OPEN</span>
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-2xl border border-[var(--border)] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]"><Clock3 size={15} /> Opened</div>
              <p className="mt-2 text-sm font-bold text-[var(--text)]">{formatDateTime(currentShift.opened_at)}</p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]"><Wallet size={15} /> Opening cash float</div>
              <p className="mt-2 text-sm font-bold text-[var(--text)]">KES {money(currentShift.opening_cash)}</p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] p-4">
              <div className="text-xs font-semibold text-[var(--text-muted)]">Business date</div>
              <p className="mt-2 text-sm font-bold text-[var(--text)]">{currentShift.date || '—'}</p>
            </div>
          </div>
          {currentShift.notes && <p className="border-t border-[var(--border)] px-5 py-3 text-sm text-[var(--text-muted)]">{currentShift.notes}</p>}
          <div className="border-t border-[var(--border)] px-5 py-4 text-xs text-[var(--text-muted)]">
            This shift is shared by the property’s POS team. Waiter sales are recorded against this open shift.
          </div>
        </section>
      ) : (
        <section className="grid gap-6 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)] lg:p-7">
          <div>
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--danger-soft)] text-[var(--danger-text)]">
              <AlertCircle size={21} />
            </span>
            <h2 className="mt-4 text-xl font-bold text-[var(--text)]">Open the property POS shift</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              Enter the cash float placed in the POS drawer. Only one POS shift can be open for this property at a time.
              The shift must be open before staff can start taking orders or payments.
            </p>
            <div className="mt-5 rounded-2xl bg-[var(--canvas)] p-4 text-xs leading-5 text-[var(--text-muted)]">
              <p className="font-bold text-[var(--text)]">Before you continue</p>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>Count and confirm the opening cash float.</li>
                <li>Record any handover notes for the next shift review.</li>
                <li>All POS staff and waiters will use this property shift.</li>
              </ul>
            </div>
          </div>

          <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
            <div>
              <label htmlFor="pos-shift-opening-cash" className="mb-1.5 block text-sm font-semibold text-[var(--text)]">Opening cash float (KES)</label>
              <input
                id="pos-shift-opening-cash"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                placeholder="e.g. 5000.00"
                disabled={Boolean(loadError) || isSubmitting}
                aria-invalid={Boolean(errors.openingCash)}
                aria-describedby={errors.openingCash ? 'pos-shift-opening-cash-error' : undefined}
                className="min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-base font-semibold text-[var(--text)] outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15 disabled:opacity-50"
                {...register('openingCash')}
              />
              {errors.openingCash && <p id="pos-shift-opening-cash-error" role="alert" className="mt-1.5 text-xs font-semibold text-[var(--danger-text)]">{errors.openingCash.message}</p>}
            </div>

            <div>
              <label htmlFor="pos-shift-opening-notes" className="mb-1.5 block text-sm font-semibold text-[var(--text)]">Opening notes <span className="font-normal text-[var(--text-muted)]">(optional)</span></label>
              <textarea
                id="pos-shift-opening-notes"
                rows={4}
                placeholder="Record float handover or opening observations…"
                disabled={Boolean(loadError) || isSubmitting}
                aria-invalid={Boolean(errors.notes)}
                className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15 disabled:opacity-50"
                {...register('notes')}
              />
              {errors.notes && <p role="alert" className="mt-1.5 text-xs font-semibold text-[var(--danger-text)]">{errors.notes.message}</p>}
            </div>

            <button
              type="submit"
              disabled={Boolean(loadError) || isSubmitting}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[var(--primary)] px-5 py-3 text-sm font-bold text-primary-foreground transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? 'Opening shift…' : 'Open POS Shift'}
            </button>
            <p className="text-center text-xs text-[var(--text-muted)]">The shift opens only after the database confirms the request.</p>
          </form>
        </section>
      )}
    </main>
  );
}
