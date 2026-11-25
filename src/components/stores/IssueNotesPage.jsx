import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Search, ReceiptText, PackageCheck, Ban, AlertCircle, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import storesService from '@/services/storesService';
import StoresStatusBadge from './StoresStatusBadge';
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const STATUS_OPTIONS = [
  ['', 'All statuses'],
  ['issued', 'Issued'],
  ['received', 'Received'],
  ['discrepancy', 'Discrepancy'],
  ['voided', 'Voided'],
];

const FIELD = 'min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]';
const PANEL = 'rounded-xl border border-[var(--border)] bg-[var(--surface)]';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function qty(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function money(value) {
  return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function IssueNotesPage() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;

  const [status, setStatus] = useState('');
  const [costCentreId, setCostCentreId] = useState('');
  const [search, setSearch] = useState('');
  const [costCentres, setCostCentres] = useState([]);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [mode, setMode] = useState('view');
  const [receiptLines, setReceiptLines] = useState([]);
  const [notes, setNotes] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError('');
    try {
      const data = await storesService.listIssueNotes(propertyId, {
        status: status || null,
        costCentreId: costCentreId || null,
        search: search.trim() || null,
        limit: 100,
      });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setMeta(data || {});
    } catch (err) {
      setError(err?.message || 'Unable to load issue notes.');
    } finally {
      setLoading(false);
    }
  }, [propertyId, status, costCentreId, search]);

  useEffect(() => {
    if (!propertyId) return;
    storesService.listCostCentres(propertyId)
      .then((data) => setCostCentres(Array.isArray(data?.rows) ? data.rows : []))
      .catch(() => setCostCentres([]));
  }, [propertyId]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const openDetail = async (id) => {
    setSelectedId(id);
    setDetail(null);
    setMode('view');
    setNotes('');
    setVoidReason('');
    setDetailLoading(true);
    try {
      const data = await storesService.issueNoteDetail(propertyId, id);
      setDetail(data);
    } catch (err) {
      toast.error(err?.message || 'Unable to open this issue note.');
      setSelectedId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedId(null);
    setDetail(null);
    setMode('view');
    setNotes('');
    setVoidReason('');
    setReceiptLines([]);
  };

  const refreshDetail = async (id) => {
    const data = await storesService.issueNoteDetail(propertyId, id);
    setDetail(data);
  };

  const startReceipt = () => {
    setMode('receive');
    setNotes('');
    setReceiptLines((detail?.lines || []).map((line) => ({
      id: line.id,
      name: line.product_name,
      unit: line.unit_code || line.base_unit,
      issued: Number(line.qty || 0),
      received: Number(line.qty || 0),
      reason: '',
    })));
  };

  const updateReceipt = (lineId, patch) => {
    setReceiptLines((current) => current.map((line) => (
      line.id === lineId ? { ...line, ...patch } : line
    )));
  };

  const runAction = async (action, successMessage) => {
    setBusy(true);
    setError('');
    try {
      await action();
      toast.success(successMessage);
      setMode('view');
      await Promise.all([load(), selectedId ? refreshDetail(selectedId) : Promise.resolve()]);
    } catch (err) {
      const message = err?.message || 'The action could not be completed.';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const confirmReceipt = () => {
    for (const line of receiptLines) {
      if (Number(line.received) < Number(line.issued) && !line.reason.trim()) {
        toast.error(`Add a discrepancy reason for ${line.name}.`);
        return;
      }
      if (Number(line.received) > Number(line.issued)) {
        toast.error(`Received quantity cannot exceed issued for ${line.name}.`);
        return;
      }
    }

    return runAction(
      () => storesService.confirmIssueReceipt(propertyId, selectedId, {
        lines: receiptLines.map((line) => ({
          issue_note_line_id: line.id,
          received_qty: Number(line.received),
          discrepancy_reason: line.reason.trim() || null,
        })),
        notes: notes.trim() || null,
      }),
      'Receipt confirmed.',
    );
  };

  const voidIssue = () => {
    if (!voidReason.trim()) {
      toast.error('A void reason is required.');
      return;
    }
    return runAction(
      () => storesService.voidIssue(propertyId, selectedId, voidReason.trim()),
      'Issue note voided and stock reversed.',
    );
  };

  const summary = detail ? [
    ['Requisition', detail.requisition_no || 'Direct issue'],
    ['Cost centre', detail.cost_centre_name],
    ['From', detail.from_location_name || '—'],
    ['To', detail.to_location_name || 'Consumed by department'],
    ['Issued by', detail.issued_by_name || '—'],
    ['Issued at', formatDate(detail.issued_at)],
    ['Received by', detail.received_by_name || '—'],
    ['Received at', formatDate(detail.received_at)],
  ] : [];

  return (
    <div className="min-h-full bg-[var(--canvas)] px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-normal text-[var(--text)]">Issue notes</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Every posted issue and its receipt. Issue posting and voiding are the only actions that move stock.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 text-sm text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {error ? (
          <div className="flex items-start gap-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger-text)]" role="alert">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className={`${PANEL} p-3 sm:p-4`}>
          <div className="grid gap-2 sm:grid-cols-[180px_200px_minmax(0,1fr)]">
            <select className={FIELD} value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
              {STATUS_OPTIONS.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}
            </select>
            <select className={FIELD} value={costCentreId} onChange={(event) => setCostCentreId(event.target.value)} aria-label="Filter by cost centre">
              <option value="">All cost centres</option>
              {costCentres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name}</option>)}
            </select>
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="search"
                className={`${FIELD} pl-9`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search issue number, requisition or cost centre"
                aria-label="Search issue notes"
              />
            </div>
          </div>
        </div>

        <div className={`${PANEL} overflow-hidden`}>
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-14 animate-pulse rounded bg-[var(--border)]/40" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <ReceiptText size={30} className="mx-auto mb-2 text-[var(--text-muted)]" />
              <p className="text-sm font-medium text-[var(--text)]">No issue notes found</p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">Issues appear here once the store posts them.</p>
            </div>
          ) : (
            <>
              <div className="hidden border-b border-[var(--border)] bg-[var(--canvas)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] md:grid md:grid-cols-[110px_minmax(0,1fr)_140px_120px_140px]">
                <span>Number</span><span>Cost centre</span><span>Requisition</span><span>Status</span><span>Issued at</span>
              </div>
              <ul className="divide-y divide-[var(--border)]">
                {rows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => openDetail(row.id)}
                      className="grid w-full gap-1 px-4 py-3 text-left hover:bg-[var(--primary-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)] md:grid-cols-[110px_minmax(0,1fr)_140px_120px_140px] md:items-center md:gap-3"
                    >
                      <span className="text-sm font-semibold text-[var(--text)]">{row.issue_no}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-[var(--text)]">{row.cost_centre_name}</span>
                        <span className="block truncate text-xs text-[var(--text-muted)] md:hidden">
                          {row.requisition_no || 'Direct'} · {formatDate(row.issued_at)}
                        </span>
                      </span>
                      <span className="hidden text-sm text-[var(--text-muted)] md:block">{row.requisition_no || 'Direct'}</span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StoresStatusBadge status={row.status} />
                        {row.has_discrepancy ? <span className="text-xs font-semibold text-[var(--danger-text)]">!</span> : null}
                      </span>
                      <span className="hidden text-xs text-[var(--text-muted)] md:block">{formatDate(row.issued_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--text-muted)]">
                Showing {rows.length} of {meta.total ?? rows.length} issue notes
              </div>
            </>
          )}
        </div>
      </div>

      <Dialog open={Boolean(selectedId)} onOpenChange={(open) => { if (!open) closeDetail(); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {detail?.issue_no || 'Issue note'}
              {detail ? <StoresStatusBadge status={detail.status} /> : null}
            </DialogTitle>
            <DialogDescription>
              {mode === 'view' && 'Review the posted issue, receipt and history.'}
              {mode === 'receive' && 'Confirm what was physically received. A short receipt needs a reason.'}
              {mode === 'void' && 'Voiding posts compensating stock movements. This cannot be undone.'}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            {detailLoading || !detail ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded bg-[var(--border)]/40" />)}
              </div>
            ) : (
              <>
                {error ? (
                  <div className="rounded-md border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger-text)]" role="alert">
                    {error}
                  </div>
                ) : null}

                <dl className="grid gap-3 rounded-lg bg-[var(--canvas)] p-3 text-sm sm:grid-cols-2">
                  {summary.map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <dt className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{label}</dt>
                      <dd className="truncate font-medium text-[var(--text)]">{value ?? '—'}</dd>
                    </div>
                  ))}
                  {detail.can_view_costs ? (
                    <div className="min-w-0">
                      <dt className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Total cost</dt>
                      <dd className="font-semibold text-[var(--text)]">{money(detail.total_cost)}</dd>
                    </div>
                  ) : null}
                </dl>

                {detail.void_reason ? (
                  <p className="rounded-md border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm text-[var(--text-muted)]">
                    Voided: {detail.void_reason}
                  </p>
                ) : null}

                <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead className="bg-[var(--canvas)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Item</th>
                        <th className="px-3 py-2 text-right font-semibold">Issued</th>
                        <th className="px-3 py-2 text-right font-semibold">Received</th>
                        <th className="px-3 py-2 text-right font-semibold">Discrepancy</th>
                        {detail.can_view_costs ? <th className="px-3 py-2 text-right font-semibold">Unit cost</th> : null}
                        {detail.can_view_costs ? <th className="px-3 py-2 text-right font-semibold">Total</th> : null}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {(detail.lines || []).map((line) => {
                        const draft = receiptLines.find((item) => item.id === line.id);
                        return (
                          <tr key={line.id}>
                            <td className="px-3 py-2">
                              <span className="block font-medium text-[var(--text)]">{line.product_name}</span>
                              <span className="block text-xs text-[var(--text-muted)]">{line.sku || 'No SKU'} · {line.unit_code || line.base_unit}</span>
                              {mode === 'receive' && Number(draft?.received) < Number(line.qty) ? (
                                <input
                                  type="text"
                                  value={draft?.reason || ''}
                                  onChange={(event) => updateReceipt(line.id, { reason: event.target.value })}
                                  placeholder="Reason for shortage"
                                  aria-label={`Discrepancy reason for ${line.product_name}`}
                                  className="mt-1 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs"
                                />
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-right text-[var(--text)]">{qty(line.qty)}</td>
                            <td className="px-3 py-2 text-right">
                              {mode === 'receive' ? (
                                <input
                                  type="number"
                                  min="0"
                                  max={line.qty}
                                  step="0.01"
                                  value={draft?.received ?? ''}
                                  aria-label={`Received quantity for ${line.product_name}`}
                                  onChange={(event) => updateReceipt(line.id, { received: event.target.value })}
                                  className="h-10 w-24 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-right text-sm"
                                />
                              ) : qty(line.received_qty)}
                            </td>
                            <td className={`px-3 py-2 text-right ${Number(line.discrepancy_qty) > 0 ? 'font-semibold text-[var(--danger-text)]' : 'text-[var(--text-muted)]'}`}>
                              {qty(line.discrepancy_qty)}
                            </td>
                            {detail.can_view_costs ? <td className="px-3 py-2 text-right text-[var(--text-muted)]">{money(line.unit_cost)}</td> : null}
                            {detail.can_view_costs ? <td className="px-3 py-2 text-right text-[var(--text)]">{money(line.total_cost)}</td> : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {mode === 'receive' ? (
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-[var(--text)]">Receipt notes</span>
                    <textarea
                      className="min-h-20 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-sm focus:border-[var(--primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder="Optional note about this receipt"
                    />
                  </label>
                ) : null}

                {mode === 'void' ? (
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-[var(--text)]">Void reason</span>
                    <textarea
                      className="min-h-20 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-sm focus:border-[var(--primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                      value={voidReason}
                      onChange={(event) => setVoidReason(event.target.value)}
                      placeholder="Explain why this issue is being reversed"
                    />
                  </label>
                ) : null}

                {mode === 'view' && Array.isArray(detail.audit) && detail.audit.length > 0 ? (
                  <details className="rounded-lg border border-[var(--border)] px-3 py-2">
                    <summary className="cursor-pointer text-sm font-medium text-[var(--text)]">History ({detail.audit.length})</summary>
                    <ul className="mt-2 space-y-2">
                      {detail.audit.map((entry, index) => (
                        <li key={`${entry.action}-${entry.created_at}-${index}`} className="text-xs text-[var(--text-muted)]">
                          <span className="font-semibold text-[var(--text)]">{String(entry.action).replaceAll('_', ' ')}</span>
                          {' · '}{entry.actor_name || 'System'}{' · '}{formatDate(entry.created_at)}
                          {entry.reason ? ` · ${entry.reason}` : ''}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </>
            )}
          </DialogBody>

          <DialogFooter>
            {mode === 'view' ? (
              <>
                {detail?.can_void ? (
                  <button type="button" onClick={() => { setMode('void'); setVoidReason(''); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--danger)] px-4 text-sm font-semibold text-[var(--danger-text)] hover:bg-[var(--danger-soft)]">
                    <Ban size={16} /> Void issue
                  </button>
                ) : null}
                {detail?.can_confirm ? (
                  <button type="button" onClick={startReceipt} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-95">
                    <PackageCheck size={16} /> Confirm receipt
                  </button>
                ) : null}
                {detail?.requisition_id ? (
                  <Link to={`/stores/requisitions?focus=${detail.requisition_id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--border)] px-4 text-sm text-[var(--text)] hover:bg-[var(--surface-2)]">
                    Requisition <ArrowRight size={16} />
                  </Link>
                ) : null}
                <button type="button" onClick={closeDetail} className="inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--border)] px-4 text-sm text-[var(--text)] hover:bg-[var(--surface-2)]">
                  Close
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => { setMode('view'); setError(''); }} disabled={busy} className="inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--border)] px-4 text-sm text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-50">
                  Back
                </button>
                {mode === 'receive' ? (
                  <button type="button" onClick={confirmReceipt} disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-95 disabled:opacity-50">
                    <PackageCheck size={16} /> {busy ? 'Confirming…' : 'Confirm receipt'}
                  </button>
                ) : null}
                {mode === 'void' ? (
                  <button type="button" onClick={voidIssue} disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--danger)] px-4 text-sm font-semibold text-[var(--danger-foreground)] hover:opacity-95 disabled:opacity-50">
                    <Ban size={16} /> {busy ? 'Voiding…' : 'Void and reverse stock'}
                  </button>
                ) : null}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
