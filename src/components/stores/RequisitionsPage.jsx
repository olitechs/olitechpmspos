import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, RefreshCw, Search, ClipboardList, ThumbsUp, ThumbsDown, PackageCheck, XCircle, ArrowRight, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import storesService from '@/services/storesService';
import StoresStatusBadge from './StoresStatusBadge';
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const STATUS_OPTIONS = [
  ['', 'All statuses'],
  ['draft', 'Draft'],
  ['submitted', 'Submitted'],
  ['approved', 'Approved'],
  ['partially_issued', 'Partly issued'],
  ['issued', 'Issued'],
  ['rejected', 'Rejected'],
  ['cancelled', 'Cancelled'],
];

const FIELD = 'min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]';
const PANEL = 'rounded-xl border border-[var(--border)] bg-[var(--surface)]';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function qty(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function RequisitionsPage() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [searchParams] = useSearchParams();

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
  const [draftLines, setDraftLines] = useState([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError('');
    try {
      const data = await storesService.listRequisitions(propertyId, {
        status: status || null,
        costCentreId: costCentreId || null,
        search: search.trim() || null,
        limit: 100,
      });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setMeta(data || {});
    } catch (err) {
      setError(err?.message || 'Unable to load requisitions.');
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
    setMode('view');
    setReason('');
    setDetail(null);
    setDetailLoading(true);
    try {
      const data = await storesService.requisitionDetail(propertyId, id);
      setDetail(data);
    } catch (err) {
      toast.error(err?.message || 'Unable to open this requisition.');
      setSelectedId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedId(null);
    setDetail(null);
    setMode('view');
    setReason('');
    setDraftLines([]);
  };

  const refreshDetail = async (id) => {
    const data = await storesService.requisitionDetail(propertyId, id);
    setDetail(data);
    return data;
  };

  useEffect(() => {
    const focusId = searchParams.get('focus');
    if (focusId && propertyId) openDetail(focusId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, propertyId]);

  const startApprove = () => {
    setMode('approve');
    setDraftLines((detail?.lines || []).map((line) => ({
      id: line.id,
      name: line.product_name,
      unit: line.unit_code || line.base_unit,
      requested: Number(line.requested_qty || 0),
      approved: Number(line.requested_qty || 0),
    })));
  };

  const startIssue = () => {
    setMode('issue');
    setDraftLines((detail?.lines || []).map((line) => ({
      id: line.id,
      name: line.product_name,
      unit: line.unit_code || line.base_unit,
      remaining: Number(line.remaining_qty || 0),
      onHand: Number(line.on_hand || 0),
      qty: Number(line.remaining_qty || 0),
    })));
  };

  const runAction = async (action, successMessage) => {
    setBusy(true);
    setError('');
    try {
      await action();
      toast.success(successMessage);
      setMode('view');
      setReason('');
      await Promise.all([load(), selectedId ? refreshDetail(selectedId) : Promise.resolve()]);
    } catch (err) {
      const message = err?.message || 'The action could not be completed.';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const approve = () => runAction(
    () => storesService.decideRequisition(propertyId, selectedId, 'approve', {
      lines: draftLines.map((line) => ({ requisition_line_id: line.id, approved_qty: Number(line.approved) })),
    }),
    'Requisition approved.',
  );

  const reject = () => {
    if (!reason.trim()) {
      toast.error('A rejection reason is required.');
      return;
    }
    return runAction(
      () => storesService.decideRequisition(propertyId, selectedId, 'reject', { reason: reason.trim() }),
      'Requisition rejected.',
    );
  };

  const cancel = () => {
    if (!reason.trim()) {
      toast.error('A cancellation reason is required.');
      return;
    }
    return runAction(
      () => storesService.cancelRequisition(propertyId, selectedId, reason.trim()),
      'Requisition cancelled.',
    );
  };

  const issue = () => {
    const lines = draftLines
      .filter((line) => Number(line.qty) > 0)
      .map((line) => ({ requisition_line_id: line.id, qty: Number(line.qty) }));

    if (lines.length === 0) {
      toast.error('Enter an issue quantity on at least one line.');
      return;
    }
    return runAction(
      () => storesService.issueRequisition(propertyId, {
        requisition_id: selectedId,
        idempotency_key: globalThis.crypto?.randomUUID?.() || `${selectedId}-${Date.now()}`,
        lines,
      }),
      'Issue posted and stock updated.',
    );
  };

  const totalApproved = useMemo(
    () => draftLines.reduce((sum, line) => sum + Number(line.approved || 0), 0),
    [draftLines],
  );

  const summary = detail ? [
    ['Cost centre', detail.cost_centre_name],
    ['Issuing store', detail.from_location_name || 'Default store'],
    ['Requested by', detail.requested_by_name || '—'],
    ['Needed by', formatDate(detail.needed_by)],
    ['Priority', String(detail.priority || 'normal')],
    ['Created', formatDate(detail.created_at)],
  ] : [];

  return (
    <div className="min-h-full bg-[var(--canvas)] px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-normal text-[var(--text)]">Stock requisitions</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Department requests and their approval queue. Stock moves only when the store posts an issue.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {meta.can_create !== false ? (
              <Link
                to="/stores/request-stock"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-95"
              >
                <Plus size={16} /> New request
              </Link>
            ) : null}
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 text-sm text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
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
                placeholder="Search requisition number, cost centre or requester"
                aria-label="Search requisitions"
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
              <ClipboardList size={30} className="mx-auto mb-2 text-[var(--text-muted)]" />
              <p className="text-sm font-medium text-[var(--text)]">No requisitions found</p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">Adjust the filters or create a new request.</p>
            </div>
          ) : (
            <>
              <div className="hidden border-b border-[var(--border)] bg-[var(--canvas)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] md:grid md:grid-cols-[110px_minmax(0,1fr)_120px_110px_110px_90px]">
                <span>Number</span><span>Cost centre</span><span>Requester</span><span>Status</span><span>Needed by</span><span className="text-right">Lines</span>
              </div>
              <ul className="divide-y divide-[var(--border)]">
                {rows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => openDetail(row.id)}
                      className="grid w-full gap-1 px-4 py-3 text-left hover:bg-[var(--primary-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)] md:grid-cols-[110px_minmax(0,1fr)_120px_110px_110px_90px] md:items-center md:gap-3"
                    >
                      <span className="text-sm font-semibold text-[var(--text)]">{row.req_no}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-[var(--text)]">{row.cost_centre_name}</span>
                        <span className="block truncate text-xs text-[var(--text-muted)] md:hidden">
                          {row.requested_by_name || '—'} · {formatDate(row.needed_by)}
                        </span>
                      </span>
                      <span className="hidden truncate text-sm text-[var(--text-muted)] md:block">{row.requested_by_name || '—'}</span>
                      <span><StoresStatusBadge status={row.status} /></span>
                      <span className="hidden text-sm text-[var(--text-muted)] md:block">{formatDate(row.needed_by)}</span>
                      <span className="hidden text-right text-sm text-[var(--text-muted)] md:block">{row.line_count}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--text-muted)]">
                Showing {rows.length} of {meta.total ?? rows.length} requisitions
              </div>
            </>
          )}
        </div>
      </div>

      <Dialog open={Boolean(selectedId)} onOpenChange={(open) => { if (!open) closeDetail(); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {detail?.req_no || 'Requisition'}
              {detail ? <StoresStatusBadge status={detail.status} /> : null}
            </DialogTitle>
            <DialogDescription>
              {mode === 'view' && 'Review the request, its lines and history.'}
              {mode === 'approve' && 'Adjust approved quantities, then approve.'}
              {mode === 'issue' && 'Post the issue. This moves stock immediately.'}
              {mode === 'reject' && 'Give a reason for rejecting this requisition.'}
              {mode === 'cancel' && 'Give a reason for cancelling this requisition.'}
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
                      <dd className="truncate font-medium capitalize text-[var(--text)]">{value ?? '—'}</dd>
                    </div>
                  ))}
                </dl>

                {detail.notes ? (
                  <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)]">{detail.notes}</p>
                ) : null}

                {detail.rejection_reason ? (
                  <p className="rounded-md border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger-text)]">
                    Rejected: {detail.rejection_reason}
                  </p>
                ) : null}

                <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead className="bg-[var(--canvas)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Item</th>
                        <th className="px-3 py-2 text-right font-semibold">Requested</th>
                        <th className="px-3 py-2 text-right font-semibold">Approved</th>
                        <th className="px-3 py-2 text-right font-semibold">Issued</th>
                        <th className="px-3 py-2 text-right font-semibold">Remaining</th>
                        <th className="px-3 py-2 text-right font-semibold">On hand</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {(detail.lines || []).map((line) => {
                        const draft = draftLines.find((item) => item.id === line.id);
                        return (
                          <tr key={line.id}>
                            <td className="px-3 py-2">
                              <span className="block font-medium text-[var(--text)]">{line.product_name}</span>
                              <span className="block text-xs text-[var(--text-muted)]">{line.sku || 'No SKU'} · {line.unit_code || line.base_unit}</span>
                            </td>
                            <td className="px-3 py-2 text-right text-[var(--text)]">{qty(line.requested_qty)}</td>
                            <td className="px-3 py-2 text-right">
                              {mode === 'approve' ? (
                                <input
                                  type="number"
                                  min="0"
                                  max={line.requested_qty}
                                  step="0.01"
                                  value={draft?.approved ?? ''}
                                  aria-label={`Approved quantity for ${line.product_name}`}
                                  onChange={(event) => setDraftLines((current) => current.map((item) => (
                                    item.id === line.id ? { ...item, approved: event.target.value } : item
                                  )))}
                                  className="h-10 w-24 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-right text-sm"
                                />
                              ) : qty(line.approved_qty)}
                            </td>
                            <td className="px-3 py-2 text-right text-[var(--text)]">{qty(line.issued_qty)}</td>
                            <td className="px-3 py-2 text-right">
                              {mode === 'issue' ? (
                                <input
                                  type="number"
                                  min="0"
                                  max={line.remaining_qty}
                                  step="0.01"
                                  value={draft?.qty ?? ''}
                                  aria-label={`Issue quantity for ${line.product_name}`}
                                  onChange={(event) => setDraftLines((current) => current.map((item) => (
                                    item.id === line.id ? { ...item, qty: event.target.value } : item
                                  )))}
                                  className="h-10 w-24 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-right text-sm"
                                />
                              ) : qty(line.remaining_qty)}
                            </td>
                            <td className="px-3 py-2 text-right text-[var(--text-muted)]">{qty(line.on_hand)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {mode === 'approve' ? (
                  <p className="text-xs text-[var(--text-muted)]">Approving {qty(totalApproved)} units in total. Approval does not move stock.</p>
                ) : null}

                {mode === 'reject' || mode === 'cancel' ? (
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-[var(--text)]">Reason</span>
                    <textarea
                      className="min-h-24 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-sm focus:border-[var(--primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Explain the decision"
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
                {detail?.can_cancel ? (
                  <button type="button" onClick={() => { setMode('cancel'); setReason(''); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--danger)] px-4 text-sm font-semibold text-[var(--danger-text)] hover:bg-[var(--danger-soft)]">
                    <XCircle size={16} /> Cancel request
                  </button>
                ) : null}
                {detail?.can_edit ? (
                  <Link to={`/stores/request-stock?id=${detail.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--border)] px-4 text-sm text-[var(--text)] hover:bg-[var(--surface-2)]">
                    Edit <ArrowRight size={16} />
                  </Link>
                ) : null}
                {detail?.can_approve ? (
                  <button type="button" onClick={() => { setMode('reject'); setReason(''); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--border)] px-4 text-sm text-[var(--text)] hover:bg-[var(--danger-soft)]">
                    <ThumbsDown size={16} /> Reject
                  </button>
                ) : null}
                {detail?.can_approve ? (
                  <button type="button" onClick={startApprove} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-95">
                    <ThumbsUp size={16} /> Review & approve
                  </button>
                ) : null}
                {detail?.can_issue ? (
                  <button type="button" onClick={startIssue} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-95">
                    <PackageCheck size={16} /> Issue stock
                  </button>
                ) : null}
                {!detail?.can_cancel && !detail?.can_edit && !detail?.can_approve && !detail?.can_issue ? (
                  <button type="button" onClick={closeDetail} className="inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--border)] px-4 text-sm text-[var(--text)] hover:bg-[var(--surface-2)]">
                    Close
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <button type="button" onClick={() => { setMode('view'); setReason(''); setError(''); }} disabled={busy} className="inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--border)] px-4 text-sm text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-50">
                  Back
                </button>
                {mode === 'approve' ? (
                  <button type="button" onClick={approve} disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-95 disabled:opacity-50">
                    <ThumbsUp size={16} /> {busy ? 'Approving…' : 'Approve requisition'}
                  </button>
                ) : null}
                {mode === 'reject' ? (
                  <button type="button" onClick={reject} disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--danger)] px-4 text-sm font-semibold text-[var(--danger-foreground)] hover:opacity-95 disabled:opacity-50">
                    <ThumbsDown size={16} /> {busy ? 'Rejecting…' : 'Reject requisition'}
                  </button>
                ) : null}
                {mode === 'cancel' ? (
                  <button type="button" onClick={cancel} disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--danger)] px-4 text-sm font-semibold text-[var(--danger-foreground)] hover:opacity-95 disabled:opacity-50">
                    <XCircle size={16} /> {busy ? 'Cancelling…' : 'Cancel requisition'}
                  </button>
                ) : null}
                {mode === 'issue' ? (
                  <button type="button" onClick={issue} disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-95 disabled:opacity-50">
                    <PackageCheck size={16} /> {busy ? 'Posting…' : 'Post issue'}
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
