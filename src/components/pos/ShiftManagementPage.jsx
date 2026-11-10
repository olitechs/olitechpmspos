import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, BarChart3, CheckCircle2, Clock3, Printer, RefreshCw, Wallet } from 'lucide-react';
import { shiftService } from '@/services/shiftService';
import { getPrinters, getAssignments, printShiftPreview } from '@/services/printService';
import { toast } from 'sonner';

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
  const [submitError, setSubmitError] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summaryTables, setSummaryTables] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [printingSummary, setPrintingSummary] = useState(false);

  const loadSummary = async () => {
    if (!currentShift?.id) return;
    setSummaryLoading(true);
    setSummaryError('');
    try {
      const [report, tables] = await Promise.all([
        shiftService.getShiftReport(currentShift.id),
        shiftService.getOpenTables(propertyId),
      ]);
      setSummary(report);
      setSummaryTables(Array.isArray(tables) ? tables : []);
    } catch (error) {
      setSummaryError(error?.message || 'Unable to load the current shift summary.');
    } finally {
      setSummaryLoading(false);
    }
  };

  const printLiveSummary = async () => {
    if (!summary || !currentShift?.id) return;
    setPrintingSummary(true);
    try {
      const [printers, assignments] = await Promise.all([getPrinters(propertyId), getAssignments(propertyId)]);
      const assigned = assignments
        .filter((assignment) => ['shift_reports', 'reports'].includes(assignment.assignment_type))
        .map((assignment) => printers.find((printer) => printer.id === assignment.printer_id))
        .filter(Boolean);
      if (!assigned.length) {
        toast.warning('No printer is assigned to Shift Closing Reports.');
        return;
      }
      const result = await printShiftPreview({ ...summary, propertyId }, assigned[0]);
      if (!result.ok) toast.error(result.friendlyError || 'The live shift summary could not be printed.');
      else toast.success('Live shift summary sent to the assigned printer.');
    } catch (error) {
      toast.error(error?.message || 'Unable to print the live shift summary.');
    } finally {
      setPrintingSummary(false);
    }
  };

  const toggleSummary = async () => {
    const next = !summaryOpen;
    setSummaryOpen(next);
    if (next) await loadSummary();
  };
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
    setSubmitError('');
    try {
      const shift = await shiftService.openShift({
        propertyId,
        openingCash: values.openingCash,
        notes: values.notes,
      });
      reset();
      onOpened?.(shift);
    } catch (error) {
      setSubmitError(error?.message || 'Unable to open the POS shift. Please try again.');
    }
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
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--status-paid)] px-3 py-1.5 text-xs font-bold text-[var(--pay-paid-fg)]">
            <CheckCircle2 size={15} /> Shift open
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--danger-soft)] px-3 py-1.5 text-xs font-bold text-[var(--danger-text)]">
            <AlertCircle size={15} /> No open shift
          </span>
        )}
      </div>

      {currentShift && summaryOpen && (
        <section className="mt-5 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
            <div>
              <h2 className="font-bold text-[var(--text)]">Current shift summary</h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Live totals from posted receipts, refunds and active table sessions.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={printLiveSummary} disabled={!summary || summaryLoading || printingSummary} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-xs font-bold text-[var(--text)] disabled:opacity-50">
                <Printer size={14} /> {printingSummary ? 'Printing…' : 'Print live summary'}
              </button>
              <button type="button" onClick={loadSummary} disabled={summaryLoading} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-xs font-bold text-[var(--text)] disabled:opacity-50">
                <RefreshCw size={14} className={summaryLoading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
          </div>
          <div className="p-5">
            {summaryLoading && <p role="status" className="text-sm text-[var(--text-muted)]">Loading shift totals…</p>}
            {summaryError && <p role="alert" className="mb-3 rounded-xl bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]">{summaryError}</p>}
            {summary && (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ['Gross sales', summary.grossSales],
                    ['Refunds', summary.refundsTotal],
                    ['Voided value', summary.voidedValue],
                    ['Net sales', summary.totalSales],
                    ['Cash', summary.payments?.cash?.amount],
                    ['M-Pesa', summary.payments?.mpesa?.amount],
                    ['Card', summary.payments?.card?.amount],
                    ['Bank', summary.payments?.bank?.amount],
                    ['Room charge', summary.payments?.room_charge?.amount],
                    ['Other', summary.payments?.other?.amount],
                    ['Expected drawer cash', summary.expectedCash],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3">
                      <p className="text-xs font-semibold text-[var(--text-muted)]">{label}</p>
                      <p className="mt-1 text-base font-bold tabular-nums text-[var(--text)]">KES {money(value)}</p>
                    </div>
                  ))}
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3">
                    <p className="text-xs font-semibold text-[var(--text-muted)]">Posted receipts</p>
                    <p className="mt-1 text-base font-bold tabular-nums text-[var(--text)]">{Number(summary.totalTransactions || 0).toLocaleString('en-KE')}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3">
                    <p className="text-xs font-semibold text-[var(--text-muted)]">Active tables</p>
                    <p className="mt-1 text-base font-bold tabular-nums text-[var(--text)]">{summaryTables.length}</p>
                  </div>
                </div>
                {summaryTables.length > 0 && (
                  <div className="mt-4 rounded-xl border border-[var(--warning)] bg-[var(--warning-soft)] p-3">
                    <p className="text-sm font-bold text-[var(--warning-text)]">Tables still open</p>
                    <p className="mt-1 text-sm text-[var(--warning-text)]">{summaryTables.map((table) => 'Table ' + (table.table_number || table.table_key || '—')).join(', ')}</p>
                    <p className="mt-1 text-xs text-[var(--warning-text)]">These sessions must be settled or cleared before the shift can be closed.</p>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}

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
            <span className="rounded-full bg-[var(--status-paid)] px-3 py-1 text-xs font-bold text-[var(--pay-paid-fg)]">OPEN</span>
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
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-4">
            <p className="text-xs text-[var(--text-muted)]">This shift is shared by the property’s POS team. Waiter sales are recorded against this open shift.</p>
            <button type="button" onClick={toggleSummary} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-bold text-[var(--primary)] hover:bg-[var(--primary-soft)]">
              <BarChart3 size={16} /> {summaryOpen ? 'Hide shift summary' : 'View shift summary'}
            </button>
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
            {submitError && <div role="alert" className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm font-semibold text-[var(--danger-text)]">{submitError}</div>}
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
