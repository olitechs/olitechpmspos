import React, { useState } from 'react';
import { AlertCircle, BarChart3, CheckCircle2, Clock3, LockKeyhole, Printer, RefreshCw, Wallet } from 'lucide-react';
import { shiftService } from '@/services/shiftService';
import { getPrinters, getAssignments, printShiftPreview } from '@/services/printService';
import { toast } from 'sonner';
import { OpenShiftModal } from '@/components/pos/CloseShiftModal';
import ShiftReceiptHistory from '@/components/pos/ShiftReceiptHistory';

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

export default function ShiftManagementPage({ propertyId, currentShift, loadError, onOpened, onCloseShift }) {
  const [openShiftModal, setOpenShiftModal] = useState(false);
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
            <div className="flex items-center gap-2"><span className="rounded-full bg-[var(--status-paid)] px-3 py-1 text-xs font-bold text-[var(--pay-paid-fg)]">OPEN</span>{onCloseShift && <button type="button" onClick={onCloseShift} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-bold text-primary-foreground hover:brightness-95"><LockKeyhole size={14} /> Close shift</button>}</div>
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
        <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm sm:p-8">
          <div className="mx-auto max-w-xl text-center">
            <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--primary-soft)] text-[var(--primary)]">
              <Wallet size={22} />
            </span>
            <h2 className="mt-4 text-xl font-bold text-[var(--text)]">No active POS shift</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              Open the property shift before taking orders or payments. The opening float and handover notes are recorded through the standard shift-opening workflow.
            </p>
            <button
              type="button"
              onClick={() => setOpenShiftModal(true)}
              disabled={Boolean(loadError)}
              className="mt-6 inline-flex min-h-12 w-full max-w-sm items-center justify-center rounded-xl bg-[var(--primary)] px-5 py-3 text-sm font-bold text-primary-foreground transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Open shift
            </button>
            <p className="mt-3 text-xs text-[var(--text-muted)]">Only one property-wide POS shift can be open at a time.</p>
          </div>
        </section>
      )}
      <ShiftReceiptHistory propertyId={propertyId} currentShift={currentShift} />
      {openShiftModal && <OpenShiftModal propertyId={propertyId} onOpened={(shift) => { setOpenShiftModal(false); onOpened?.(shift); }} />}
    </main>
  );
}
