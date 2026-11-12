import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageDataSkeleton } from '@/components/ui/AppLoadingSkeleton';
import { CalendarDays, ChevronDown, ChevronUp, RefreshCw, Search, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getSessionStaff } from '@/services/authService';
import { shiftService } from '@/services/shiftService';
import DocumentExportMenu from '@/components/shared/DocumentExportMenu';
import { buildShiftReportDefinition } from '@/services/reportDefinitions';

const money = (value) => Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const businessDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-KE', { dateStyle: 'medium', timeZone: 'Africa/Nairobi' }) : '—';
const dateTime = (value) => value ? new Date(value).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }) : '—';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());

function Metric({ label, value, detail }) {
  return <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
    <div className="text-xs font-semibold text-[var(--text-muted)]">{label}</div>
    <div className="mt-2 text-xl font-black tabular-nums text-[var(--text)]">{value}</div>
    {detail && <div className="mt-1 text-[11px] text-[var(--text-muted)]">{detail}</div>}
  </div>;
}

export default function ShiftReport() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const staff = getSessionStaff();
  const propertyName = user?.property?.business_name || user?.property?.name || 'OliTechs';
  const generatedBy = user?.full_name || staff?.full_name || user?.email || 'Authorized staff';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedShift, setSelectedShift] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');

  const loadShifts = useCallback(async () => {
    if (!propertyId) {
      setShifts([]);
      setLoadError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const rows = await shiftService.listShifts(propertyId, { from: from || null, to: to || null, status });
      setShifts(Array.isArray(rows) ? rows : []);
    } catch (error) {
      setLoadError(error.message || 'Could not load shift history.');
    } finally {
      setLoading(false);
    }
  }, [propertyId, from, to, status]);

  useEffect(() => { loadShifts(); }, [loadShifts]);

  const visibleShifts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return shifts;
    return shifts.filter((shift) => String(shift.shift_no || '').toLowerCase().includes(term)
      || String(shift.status || '').toLowerCase().includes(term));
  }, [shifts, search]);

  const totals = useMemo(() => {
    const closed = shifts.filter((shift) => String(shift.status).toLowerCase() === 'closed');
    const open = shifts.length - closed.length;
    return {
      closed: closed.length,
      open,
      netSales: closed.reduce((sum, shift) => sum + Number(shift.total_sales || 0), 0),
      variance: closed.reduce((sum, shift) => sum + Number(shift.cash_variance || 0), 0),
    };
  }, [shifts]);

  const openReport = async (shift) => {
    if (selectedShift?.id === shift.id) {
      setSelectedShift(null);
      setSelectedReport(null);
      setReportError('');
      return;
    }
    setSelectedShift(shift);
    setSelectedReport(null);
    setReportError('');
    setReportLoading(true);
    try {
      const report = await shiftService.getShiftReport(shift.id);
      setSelectedReport(report);
    } catch (error) {
      setReportError(error.message || 'Could not load the shift report.');
    } finally {
      setReportLoading(false);
    }
  };

  const reportDefinition = useMemo(() => selectedReport
    ? buildShiftReportDefinition(selectedReport, { propertyName, generatedBy })
    : null, [selectedReport, propertyName, generatedBy]);

  const clearFilters = () => {
    setFrom('');
    setTo(today());
    setStatus('all');
    setSearch('');
  };

  return <div className="min-h-full bg-[var(--canvas)] p-4 text-[var(--text)] sm:p-5 lg:p-6">
    <div className="mx-auto max-w-7xl">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]"><CalendarDays size={18}/></span>
            <div>
              <h1 className="text-xl font-black">POS Shift History</h1>
              <p className="text-sm text-[var(--text-muted)]">Review closed and currently open POS shifts, reconciliation and receipt details.</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">Read-only management view. Shift opening and closing remain in POS.</p>
        </div>
        <button type="button" onClick={loadShifts} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--text)] disabled:opacity-50">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''}/> Refresh
        </button>
      </header>

      <section className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="Shifts in period" value={shifts.length} detail="Matching selected filters"/>
        <Metric label="Closed shifts" value={totals.closed} detail={`${totals.open} currently open`}/>
        <Metric label="Recorded net sales" value={`KES ${money(totals.netSales)}`} detail="Closed shifts only"/>
        <Metric label="Net cash variance" value={`KES ${money(totals.variance)}`} detail="Sum of closed shift variances"/>
      </section>

      <section className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Filter shift history</h2>
          <button type="button" onClick={clearFilters} className="text-xs font-semibold text-[var(--primary)] hover:underline">Reset filters</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_0.8fr_1.3fr]">
          <label className="text-xs font-semibold text-[var(--text-muted)]">From date
            <input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--text)]"/>
          </label>
          <label className="text-xs font-semibold text-[var(--text-muted)]">To date
            <input type="date" value={to} min={from || undefined} max={today()} onChange={(event) => setTo(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--text)]"/>
          </label>
          <label className="text-xs font-semibold text-[var(--text-muted)]">Shift status
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--text)]">
              <option value="all">All statuses</option><option value="closed">Closed</option><option value="open">Open</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--text-muted)]">Search shift number
            <span className="relative mt-1.5 block"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search SHIFT-…" className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-sm font-medium text-[var(--text)]"/></span>
          </label>
        </div>
      </section>

      {loadError && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm font-semibold text-[var(--danger-text)]"><span>{loadError}</span><button type="button" onClick={loadShifts} className="underline">Retry</button></div>}

      <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
          <div><h2 className="text-sm font-bold">Shift records</h2><p className="text-xs text-[var(--text-muted)]">{visibleShifts.length} record(s) shown</p></div>
        </div>
        {loading ? <PageDataSkeleton variant="table" rows={6}/>
          : loadError ? null
          : visibleShifts.length === 0 ? <div className="p-10 text-center text-sm text-[var(--text-muted)]">No shift records match the selected filters.</div>
          : <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="bg-[var(--surface-2)] text-[var(--text-muted)]"><tr>
                <th className="px-4 py-3 font-semibold">Shift / Date</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 text-right font-semibold">Opening float</th><th className="px-4 py-3 text-right font-semibold">Net sales</th><th className="px-4 py-3 text-right font-semibold">Counted cash</th><th className="px-4 py-3 text-right font-semibold">Variance</th><th className="px-4 py-3 text-right font-semibold">Details</th>
              </tr></thead>
              <tbody>{visibleShifts.map((shift) => {
                const closed = String(shift.status).toLowerCase() === 'closed';
                const expanded = selectedShift?.id === shift.id;
                return <React.Fragment key={shift.id}>
                  <tr className="border-t border-[var(--border)] hover:bg-[var(--surface-2)]">
                    <td className="px-4 py-3"><div className="font-bold text-[var(--text)]">{shift.shift_no || 'POS shift'}</div><div className="mt-1 text-[11px] text-[var(--text-muted)]">{businessDate(shift.date)} · Opened {dateTime(shift.opened_at)}</div></td>
                    <td className="px-4 py-3"><span className={closed ? 'rounded-full bg-[var(--success-soft)] px-2.5 py-1 font-bold text-[var(--success-text)]' : 'rounded-full bg-[var(--warning-soft)] px-2.5 py-1 font-bold text-[var(--warning-text)]'}>{closed ? 'Closed' : 'Open'}</span></td>
                    <td className="px-4 py-3 text-right tabular-nums">KES {money(shift.opening_cash)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{closed ? `KES ${money(shift.total_sales)}` : '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{shift.counted_cash == null ? '—' : `KES ${money(shift.counted_cash)}`}</td>
                    <td className={`px-4 py-3 text-right font-semibold tabular-nums ${Number(shift.cash_variance || 0) < 0 ? 'text-[var(--danger-text)]' : 'text-[var(--text)]'}`}>{shift.cash_variance == null ? '—' : `KES ${money(shift.cash_variance)}`}</td>
                    <td className="px-4 py-3 text-right"><button type="button" onClick={() => openReport(shift)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border)] px-3 font-semibold text-[var(--text)] hover:bg-[var(--primary-soft)]">{expanded ? 'Hide' : 'View'} {expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}</button></td>
                  </tr>
                  {expanded && <tr className="border-t border-[var(--border)]"><td colSpan={7} className="bg-[var(--canvas)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div><h3 className="font-bold">{shift.shift_no} · Financial report</h3><p className="mt-1 text-xs text-[var(--text-muted)]">Opened {dateTime(shift.opened_at)} · Closed {dateTime(shift.closed_at)}</p></div>
                      <div className="flex items-center gap-2"><DocumentExportMenu definition={reportDefinition} label="Export shift report" disabled={!reportDefinition}/><button type="button" onClick={() => { setSelectedShift(null); setSelectedReport(null); }} aria-label="Close shift details" className="rounded-lg border border-[var(--border)] p-2 text-[var(--text-muted)]"><X size={15}/></button></div>
                    </div>
                    {reportLoading && <div className="mt-4"><PageDataSkeleton variant="report" rows={3}/></div>}
                    {reportError && <div role="alert" className="mt-3 rounded-lg bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]">{reportError}<button type="button" onClick={() => openReport(shift)} className="ml-2 font-bold underline">Retry</button></div>}
                    {selectedReport && <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {[
                        ['Gross sales', selectedReport.grossSales], ['Refunds', selectedReport.refundsTotal], ['Voided value', selectedReport.voidedValue], ['Net sales', selectedReport.totalSales],
                        ['Expected drawer cash', selectedReport.expectedCash], ['Counted cash', selectedReport.countedCash], ['Cash variance', selectedReport.variance], ['Posted receipts', selectedReport.totalTransactions],
                      ].map(([label, value]) => <div key={label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"><div className="text-[10px] font-semibold text-[var(--text-muted)]">{label}</div><div className="mt-1 text-sm font-bold tabular-nums">{value == null ? '—' : label === 'Posted receipts' ? Number(value).toLocaleString('en-KE') : `KES ${money(value)}`}</div></div>)}
                    </div>}
                    {selectedReport && <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                      <div className="border-b border-[var(--border)] px-3 py-2 text-xs font-bold">Posted receipts</div>
                      <table className="w-full min-w-[650px] text-left text-xs"><thead className="bg-[var(--surface-2)] text-[var(--text-muted)]"><tr><th className="p-3">Receipt</th><th className="p-3">Time</th><th className="p-3">Table</th><th className="p-3">Waiter</th><th className="p-3">Payment</th><th className="p-3 text-right">Total</th></tr></thead><tbody>{(selectedReport.orders || []).map((receipt) => <tr key={receipt.id} className="border-t border-[var(--border)]"><td className="p-3 font-semibold">{receipt.order_number || '—'}</td><td className="p-3">{dateTime(receipt.created_at)}</td><td className="p-3">{receipt.table_number || '—'}</td><td className="p-3">{receipt.waiter || '—'}</td><td className="p-3 capitalize">{String(receipt.payment_method || '—').replaceAll('_', ' ')}</td><td className="p-3 text-right font-semibold">KES {money(receipt.total)}</td></tr>)}{!selectedReport.orders?.length && <tr><td colSpan={6} className="p-5 text-center text-[var(--text-muted)]">No posted receipts are linked to this shift.</td></tr>}</tbody></table>
                    </div>}
                  </td></tr>}
                </React.Fragment>;
              })}</tbody>
            </table>
          </div>}
      </section>
    </div>
  </div>;
}
