import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle, ArrowLeft, ArrowRightLeft, CheckCircle2, Clock3, PackageCheck,
  Plus, RefreshCw, Search, Truck, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import storesService from '@/services/storesService';
import DocumentExportMenu from '@/components/shared/DocumentExportMenu';
import StoresStatusBadge, { statusLabel } from '@/components/stores/StoresStatusBadge';
import {
  buildStoresTransferNoteDefinition,
} from '@/services/reportDefinitions';
import {
  Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter,
  DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

const STATUS_OPTIONS = [
  ['', 'All statuses'],
  ['pending', 'Awaiting dispatch'],
  ['in_transit', 'In transit'],
  ['completed', 'Completed'],
  ['discrepancy', 'Discrepancy'],
  ['cancelled', 'Cancelled'],
];

const FIELD = 'min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]';
const PANEL = 'rounded-xl border border-[var(--border)] bg-[var(--surface)]';
const BUTTON = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = 'bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-95';
const SECONDARY = 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--sidebar)]';

function newKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `line-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-KE', {
    timeZone: 'Africa/Nairobi',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatQty(value) {
  const number = Number(value || 0);
  return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

export default function Transfers({ workspace = 'stores' }) {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const backPath = workspace === 'backoffice' ? '/backoffice' : '/stores';

  const [locations, setLocations] = useState([]);
  const [products, setProducts] = useState([]);
  const [rows, setRows] = useState([]);
  const [settings, setSettings] = useState({});
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ key: newKey(), product_id: '', qty: '1' }]);
  const [busy, setBusy] = useState(false);

  const [detail, setDetail] = useState(null);
  const [detailProducts, setDetailProducts] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [receiveLines, setReceiveLines] = useState({});
  const [receiveNotes, setReceiveNotes] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const selectableLocations = useMemo(
    () => locations.filter((location) => String(location.name || '').toLowerCase() !== 'in transit'),
    [locations],
  );

  const loadProducts = useCallback(async (locationId) => {
    if (!propertyId || !locationId || !permissions.can_create) {
      setProducts([]);
      return;
    }
    try {
      const result = await storesService.transferProducts(propertyId, locationId);
      setProducts(array(result?.rows));
    } catch (cause) {
      setProducts([]);
      setError(cause?.message || 'Unable to load transfer products.');
    }
  }, [propertyId, permissions.can_create]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError('');
    try {
      const [settingsResult, locationResult, listResult] = await Promise.all([
        storesService.getSettings(propertyId),
        storesService.listLocations(propertyId),
        storesService.listTransfers(propertyId, {
          status: status || null,
          search: search || null,
          overdueOnly,
          limit: 200,
        }),
      ]);

      setSettings(settingsResult || {});
      setLocations(array(locationResult?.rows));
      setRows(array(listResult?.rows));
      setPermissions(listResult?.permissions || {});

      if (listResult?.permissions?.can_mark_overdue) {
        try {
          const flagged = await storesService.markTransfersOverdue(propertyId);
          if (Number(flagged || 0) > 0) {
            const refreshed = await storesService.listTransfers(propertyId, {
              status: status || null,
              search: search || null,
              overdueOnly,
              limit: 200,
            });
            setRows(array(refreshed?.rows));
          }
        } catch {
          // Overdue marking is a read-side convenience; a failed marker must
          // not hide the transfer list.
        }
      }
    } catch (cause) {
      setError(cause?.message || 'Unable to load transfers.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [propertyId, status, search, overdueOnly]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadProducts(from); }, [from, loadProducts]);

  const openDetail = useCallback(async (transferId) => {
    if (!propertyId) return;
    setDetailLoading(true);
    try {
      const result = await storesService.transferDetail(propertyId, transferId);
      setDetail(result);
      const initial = {};
      for (const line of array(result?.lines)) {
        initial[line.id] = String(line.received_qty ?? line.qty ?? 0);
      }
      setReceiveLines(initial);
      setReceiveNotes('');
      setCancelReason('');

      const fromLocationId = result?.transfer?.from_location_id;
      if (fromLocationId) {
        try {
          const productResult = await storesService.transferProducts(propertyId, fromLocationId);
          setDetailProducts(array(productResult?.rows));
        } catch {
          setDetailProducts([]);
        }
      }
    } catch (cause) {
      toast.error(cause?.message || 'Unable to open this transfer.');
    } finally {
      setDetailLoading(false);
    }
  }, [propertyId]);

  const applyResult = useCallback((result, message) => {
    setDetail(result);
    const initial = {};
    for (const line of array(result?.lines)) {
      initial[line.id] = String(line.received_qty ?? line.qty ?? 0);
    }
    setReceiveLines(initial);
    toast.success(message);
    load();
  }, [load]);

  const addLine = () => setLines((current) => [
    ...current,
    { key: newKey(), product_id: '', qty: '1' },
  ]);

  const updateLine = (key, field, value) => {
    setLines((current) => current.map((line) => (
      line.key === key ? { ...line, [field]: value } : line
    )));
  };

  const removeLine = (key) => {
    setLines((current) => (
      current.length === 1 ? current : current.filter((line) => line.key !== key)
    ));
  };

  const createTransfer = async (event) => {
    event.preventDefault();
    if (!propertyId || !permissions.can_create) return;
    if (!from || !to || from === to) {
      toast.error('Choose different source and destination locations.');
      return;
    }
    const payloadLines = lines
      .map((line) => ({ product_id: line.product_id, qty: Number(line.qty) }))
      .filter((line) => line.product_id && Number(line.qty) > 0);
    if (payloadLines.length === 0) {
      toast.error('Add at least one product with a quantity above zero.');
      return;
    }

    setBusy(true);
    try {
      await storesService.createTransfer(propertyId, {
        from_location_id: from,
        to_location_id: to,
        lines: payloadLines,
        reference,
        notes,
      });
      toast.success('Transfer note created. Dispatch it when the goods leave the source location.');
      setReference('');
      setNotes('');
      setLines([{ key: newKey(), product_id: '', qty: '1' }]);
      await load();
    } catch (cause) {
      toast.error(cause?.message || 'The transfer could not be created.');
    } finally {
      setBusy(false);
    }
  };

  const dispatch = async () => {
    if (!detail?.transfer || !propertyId) return;
    setActionBusy(true);
    try {
      const result = await storesService.dispatchTransfer(propertyId, detail.transfer.id);
      applyResult(result, `${result?.transfer?.document_no || 'Transfer'} dispatched. Stock is now in transit.`);
    } catch (cause) {
      toast.error(cause?.message || 'The transfer could not be dispatched.');
    } finally {
      setActionBusy(false);
    }
  };

  const receive = async () => {
    if (!detail?.transfer || !propertyId) return;
    const payloadLines = array(detail.lines).map((line) => ({
      line_id: line.id,
      received_qty: Number(receiveLines[line.id] ?? line.qty ?? 0),
    }));
    setActionBusy(true);
    try {
      const result = await storesService.receiveTransfer(propertyId, detail.transfer.id, {
        lines: payloadLines,
        notes: receiveNotes,
      });
      applyResult(
        result,
        result?.transfer?.status === 'discrepancy'
          ? 'Receipt recorded with a discrepancy. Review the remaining transit stock.'
          : 'Receipt confirmed. Stock has reached the destination location.',
      );
    } catch (cause) {
      toast.error(cause?.message || 'Receipt could not be confirmed.');
    } finally {
      setActionBusy(false);
    }
  };

  const cancel = async () => {
    if (!detail?.transfer || !propertyId) return;
    setActionBusy(true);
    try {
      const result = await storesService.cancelTransfer(propertyId, detail.transfer.id, cancelReason);
      applyResult(result, `${result?.transfer?.document_no || 'Transfer'} cancelled. No stock moved.`);
    } catch (cause) {
      toast.error(cause?.message || 'The transfer could not be cancelled.');
    } finally {
      setActionBusy(false);
    }
  };

  const noteDefinition = useMemo(() => {
    if (!detail) return null;
    const namedLines = array(detail.lines).map((line) => ({
      ...line,
      product_name: detailProducts.find((product) => product.product_id === line.product_id)?.name,
    }));
    return buildStoresTransferNoteDefinition({
      transfer: detail.transfer,
      lines: namedLines,
      propertyName: user?.property?.name || 'Property',
      generatedBy: user?.name || user?.email || 'Authorized user',
    });
  }, [detail, detailProducts, user]);

  const isInTransit = ['in_transit', 'dispatched'].includes(String(detail?.transfer?.status || ''));
  const isPending = String(detail?.transfer?.status || '') === 'pending';

  return (
    <div className="min-h-full bg-[var(--canvas)] px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link to={backPath} className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text)]">
              <ArrowLeft size={14} /> Back to {workspace === 'backoffice' ? 'Back Office' : 'Stores'}
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-[var(--text)]">Stock transfers</h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
              Create a transfer note, dispatch when goods leave the source, then confirm what arrived. Stock moves only at dispatch and receipt.
            </p>
          </div>
          <button type="button" onClick={load} disabled={loading} className={`${BUTTON} ${SECONDARY}`}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {error ? (
          <div role="alert" className="flex items-start gap-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger-text)]">
            <AlertCircle size={18} className="mt-0.5 shrink-0" /> <span>{error}</span>
          </div>
        ) : null}

        {permissions.can_create ? (
          <form onSubmit={createTransfer} className={`${PANEL} p-4 sm:p-5`}>
            <div className="flex items-center gap-2 border-b border-[var(--border)] pb-3">
              <Plus size={18} className="text-[var(--primary)]" />
              <h2 className="text-lg font-semibold text-[var(--text)]">New transfer note</h2>
            </div>
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              Expected receipt window: {Number(settings.transfer_overdue_hours || 0)} hours after dispatch. Creating this note does not move stock.
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
                From location
                <select className={FIELD} value={from} onChange={(event) => setFrom(event.target.value)} required>
                  <option value="">Select source</option>
                  {selectableLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
                To location
                <select className={FIELD} value={to} onChange={(event) => setTo(event.target.value)} required>
                  <option value="">Select destination</option>
                  {selectableLocations.filter((location) => location.id !== from).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                </select>
              </label>
            </div>

            <div className="mt-3 space-y-2">
              {lines.map((line, index) => (
                <div key={line.key} className="grid gap-2 rounded-lg border border-[var(--border)] p-3 sm:grid-cols-[minmax(0,1fr)_140px_44px]">
                  <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
                    Product {index + 1}
                    <select
                      className={FIELD}
                      value={line.product_id}
                      onChange={(event) => updateLine(line.key, 'product_id', event.target.value)}
                      required
                    >
                      <option value="">Select product</option>
                      {products.map((product) => (
                        <option key={product.product_id} value={product.product_id}>
                          {product.name}{product.sku ? ` · ${product.sku}` : ''} · {formatQty(product.on_hand)} on hand
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
                    Quantity
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      className={FIELD}
                      value={line.qty}
                      onChange={(event) => updateLine(line.key, 'qty', event.target.value)}
                      required
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    disabled={lines.length === 1}
                    aria-label={`Remove product ${index + 1}`}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--sidebar)] disabled:opacity-40"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              <button type="button" onClick={addLine} className={`${BUTTON} ${SECONDARY}`}>
                <Plus size={16} /> Add another line
              </button>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
                Reference
                <input className={FIELD} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Optional reference" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
                Notes
                <input className={FIELD} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional handling note" />
              </label>
            </div>

            <div className="mt-4 flex justify-end">
              <button type="submit" disabled={busy} className={`${BUTTON} ${PRIMARY}`}>
                <ArrowRightLeft size={16} /> {busy ? 'Creating…' : 'Create transfer note'}
              </button>
            </div>
          </form>
        ) : null}

        <div className={`${PANEL} p-3 sm:p-4`}>
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)_44px]">
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
              Status
              <select className={FIELD} value={status} onChange={(event) => setStatus(event.target.value)}>
                {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-xs font-medium text-[var(--text-muted)]">
              <input
                type="checkbox"
                checked={overdueOnly}
                onChange={(event) => setOverdueOnly(event.target.checked)}
                className="h-5 w-5 accent-[var(--primary)]"
              />
              Overdue only
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
              Search
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input className={`${FIELD} pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Transfer number or reference" />
              </div>
            </label>
            <button type="button" onClick={load} aria-label="Apply filters" className={`${BUTTON} ${SECONDARY} min-w-11 px-0`}>
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className={`${PANEL} p-6`}>
            <div className="mb-4 flex items-center gap-2 text-sm text-[var(--text-muted)]"><RefreshCw size={16} className="animate-spin" /> Loading transfers…</div>
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-lg bg-[var(--border)]/40" />)}</div>
          </div>
        ) : rows.length === 0 ? (
          <div className={`${PANEL} p-10 text-center`}>
            <Truck size={28} className="mx-auto text-[var(--text-muted)]" />
            <h3 className="mt-3 text-base font-semibold text-[var(--text)]">No transfers match this view</h3>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Create a transfer note or change the status and search filters.</p>
          </div>
        ) : (
          <>
            <div className={`${PANEL} hidden overflow-x-auto md:block`}>
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                    <th className="px-4 py-3">Transfer</th>
                    <th className="px-4 py-3">Route</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Lines</th>
                    <th className="px-4 py-3">Dispatched</th>
                    <th className="px-4 py-3">Expected / received</th>
                    <th className="px-4 py-3 text-right">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--sidebar)]/40">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[var(--text)]">{row.document_no || 'Unnumbered'}</p>
                        <p className="text-xs text-[var(--text-muted)]">{row.reference || formatDate(row.created_at)}</p>
                      </td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{row.from_location_name || 'Source'} → {row.to_location_name || 'Destination'}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StoresStatusBadge status={row.status} />
                          {row.is_overdue ? <span className="inline-flex items-center gap-1 rounded-full border border-[var(--warning)] bg-[var(--warning-soft)] px-2 py-1 text-[10px] font-bold text-[var(--warning-text)]"><Clock3 size={11} /> Overdue</span> : null}
                          {array(row.discrepancies).length > 0 ? <span className="rounded-full border border-[var(--danger)] bg-[var(--danger-soft)] px-2 py-1 text-[10px] font-bold text-[var(--danger-text)]">Short / over</span> : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{row.line_count || 0}</td>
                      <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{formatDate(row.dispatched_at)}</td>
                      <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{formatDate(row.received_at || row.expected_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => openDetail(row.id)} className={`${BUTTON} ${SECONDARY} min-h-10 px-3`}>Open</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 md:hidden">
              {rows.map((row) => (
                <div key={row.id} className={`${PANEL} p-4`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-[var(--text)]">{row.document_no || 'Unnumbered'}</p>
                      <p className="text-xs text-[var(--text-muted)]">{row.from_location_name || 'Source'} → {row.to_location_name || 'Destination'}</p>
                    </div>
                    <StoresStatusBadge status={row.status} />
                  </div>
                  <p className="mt-3 text-xs text-[var(--text-muted)]">Dispatched {formatDate(row.dispatched_at)} · Expected / received {formatDate(row.received_at || row.expected_at)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {row.is_overdue ? <span className="rounded-full bg-[var(--warning-soft)] px-2 py-1 text-[10px] font-bold text-[var(--warning-text)]">Overdue</span> : null}
                    {array(row.discrepancies).length > 0 ? <span className="rounded-full bg-[var(--danger-soft)] px-2 py-1 text-[10px] font-bold text-[var(--danger-text)]">Discrepancy</span> : null}
                    <button type="button" onClick={() => openDetail(row.id)} className={`${BUTTON} ${SECONDARY} min-h-10 px-3`}>Open transfer</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <Dialog open={!!detail || detailLoading} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{detail?.transfer?.document_no || 'Transfer note'}</DialogTitle>
            <DialogDescription>
              {detail?.transfer?.from_location_name || 'Source'} → {detail?.transfer?.to_location_name || 'Destination'} · {statusLabel(detail?.transfer?.status)}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <DialogBody><p className="text-sm text-[var(--text-muted)]">Opening transfer note…</p></DialogBody>
          ) : detail ? (
            <>
              <DialogBody className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StoresStatusBadge status={detail.transfer.status} />
                  {detail.transfer.is_overdue ? <span className="inline-flex items-center gap-1 rounded-full bg-[var(--warning-soft)] px-2 py-1 text-xs font-bold text-[var(--warning-text)]"><Clock3 size={12} /> Overdue</span> : null}
                </div>

                <div className="grid gap-2 text-xs sm:grid-cols-2">
                  <div className="rounded-lg bg-[var(--canvas)] p-3"><span className="text-[var(--text-muted)]">Created</span><p className="mt-0.5 font-semibold text-[var(--text)]">{formatDate(detail.transfer.created_at)}</p></div>
                  <div className="rounded-lg bg-[var(--canvas)] p-3"><span className="text-[var(--text-muted)]">Dispatched</span><p className="mt-0.5 font-semibold text-[var(--text)]">{formatDate(detail.transfer.dispatched_at)}</p></div>
                  <div className="rounded-lg bg-[var(--canvas)] p-3"><span className="text-[var(--text-muted)]">Expected receipt</span><p className="mt-0.5 font-semibold text-[var(--text)]">{formatDate(detail.transfer.expected_at)}</p></div>
                  <div className="rounded-lg bg-[var(--canvas)] p-3"><span className="text-[var(--text-muted)]">Received</span><p className="mt-0.5 font-semibold text-[var(--text)]">{formatDate(detail.transfer.received_at)}</p></div>
                </div>

                {detail.transfer.reference || detail.transfer.notes ? (
                  <div className="rounded-lg border border-[var(--border)] p-3 text-sm">
                    {detail.transfer.reference ? <p><span className="text-[var(--text-muted)]">Reference: </span>{detail.transfer.reference}</p> : null}
                    {detail.transfer.notes ? <p className="mt-1"><span className="text-[var(--text-muted)]">Notes: </span>{detail.transfer.notes}</p> : null}
                  </div>
                ) : null}

                <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead className="bg-[var(--canvas)] text-left text-xs text-[var(--text-muted)]">
                      <tr>
                        <th className="px-3 py-2">Product</th>
                        <th className="px-3 py-2">Expected</th>
                        <th className="px-3 py-2">Dispatched</th>
                        <th className="px-3 py-2">Received</th>
                      </tr>
                    </thead>
                    <tbody>
                      {array(detail.lines).map((line) => {
                        const productName = detailProducts.find((product) => product.product_id === line.product_id)?.name;
                        return (
                          <tr key={line.id} className="border-t border-[var(--border)]">
                            <td className="px-3 py-2">
                              <p className="font-medium text-[var(--text)]">{productName || line.product_name || line.product_id}</p>
                              <p className="text-xs text-[var(--text-muted)]">Line {line.line_no}</p>
                            </td>
                            <td className="px-3 py-2 tabular-nums">{formatQty(line.qty)}</td>
                            <td className="px-3 py-2 tabular-nums">{formatQty(line.dispatched_qty)}</td>
                            <td className="px-3 py-2">
                              {isInTransit && detail.permissions.can_receive ? (
                                <input
                                  type="number"
                                  min="0"
                                  max={line.qty}
                                  step="0.01"
                                  className="min-h-11 w-28 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                                  value={receiveLines[line.id] ?? String(line.qty ?? 0)}
                                  onChange={(event) => setReceiveLines((current) => ({ ...current, [line.id]: event.target.value }))}
                                  aria-label={`Received quantity for ${productName || line.product_id}`}
                                />
                              ) : (
                                <span className="tabular-nums">{formatQty(line.received_qty)}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {array(detail.discrepancies || detail.transfer.discrepancies).length > 0 ? (
                  <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]">
                    <p className="font-semibold">Receipt discrepancy recorded</p>
                    <ul className="mt-1 list-disc pl-5 text-xs">
                      {array(detail.discrepancies || detail.transfer.discrepancies).map((item) => (
                        <li key={item.line_id || item.product_id}>
                          Line {item.line_no || item.line_id}: expected {formatQty(item.expected_qty)}, received {formatQty(item.received_qty)}, difference {formatQty(item.difference_qty)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {isInTransit && detail.permissions.can_receive ? (
                  <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
                    Receipt note
                    <input className={FIELD} value={receiveNotes} onChange={(event) => setReceiveNotes(event.target.value)} placeholder="Optional note about the received goods" />
                  </label>
                ) : null}

                {isPending && detail.permissions.can_cancel ? (
                  <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
                    Cancellation reason
                    <input className={FIELD} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Required if the transfer is being cancelled" />
                  </label>
                ) : null}
              </DialogBody>

              <DialogFooter className="flex flex-wrap items-center justify-between gap-2">
                <DocumentExportMenu
                  definition={noteDefinition}
                  label="Transfer note"
                  formats={['pdf', 'print']}
                  disabled={!noteDefinition}
                />
                <div className="flex flex-wrap gap-2">
                  {isPending && detail.permissions.can_cancel ? (
                    <button type="button" onClick={cancel} disabled={actionBusy || !cancelReason.trim()} className={`${BUTTON} ${SECONDARY}`}>
                      Cancel transfer
                    </button>
                  ) : null}
                  {isPending && detail.permissions.can_dispatch ? (
                    <button type="button" onClick={dispatch} disabled={actionBusy} className={`${BUTTON} ${PRIMARY}`}>
                      <Truck size={16} /> {actionBusy ? 'Dispatching…' : 'Dispatch stock'}
                    </button>
                  ) : null}
                  {isInTransit && detail.permissions.can_receive ? (
                    <button type="button" onClick={receive} disabled={actionBusy} className={`${BUTTON} ${PRIMARY}`}>
                      <PackageCheck size={16} /> {actionBusy ? 'Confirming…' : 'Confirm receipt'}
                    </button>
                  ) : null}
                  {['completed', 'discrepancy'].includes(String(detail.transfer.status)) ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--success-text)]"><CheckCircle2 size={15} /> Confirmed</span>
                  ) : null}
                </div>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
