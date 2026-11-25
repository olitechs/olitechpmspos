import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, Minus, Search, Trash2, Save, Send, ClipboardList, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import storesService from '@/services/storesService';
import StoresStatusBadge from './StoresStatusBadge';

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'urgent', label: 'Urgent' },
];

const PANEL = 'rounded-xl border border-[var(--border)] bg-[var(--surface)]';
const FIELD = 'min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]';

function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `req-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function QtyInput({ value, onChange, step = 0.01, label }) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        onClick={() => onChange(Math.max(0, Number(value || 0) - 1))}
        className="inline-flex h-11 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
      >
        <Minus size={14} />
      </button>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step={step}
        value={value}
        aria-label={`Quantity for ${label}`}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-20 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-center text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
      />
      <button
        type="button"
        aria-label={`Increase ${label}`}
        onClick={() => onChange(Number(value || 0) + 1)}
        className="inline-flex h-11 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

export default function RequestStockPage() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editingId = searchParams.get('id');

  const [costCentres, setCostCentres] = useState([]);
  const [costCentreId, setCostCentreId] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [priority, setPriority] = useState('normal');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([]);
  const [status, setStatus] = useState('draft');
  const [reqNo, setReqNo] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [parTemplates, setParTemplates] = useState([]);
  const [parTemplateId, setParTemplateId] = useState('');
  const idempotencyKey = useRef(newIdempotencyKey());

  const canEdit = status === 'draft' && !saving;

  const loadProducts = useCallback(async (centreId) => {
    if (!propertyId || !centreId) {
      setProducts([]);
      return;
    }
    setProductsLoading(true);
    try {
      const data = await storesService.requisitionProducts(propertyId, centreId);
      setProducts(Array.isArray(data?.rows) ? data.rows : []);
    } catch (err) {
      setError(err?.message || 'Unable to load products.');
    } finally {
      setProductsLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!propertyId) return;
      setLoading(true);
      try {
        const [centres, settings] = await Promise.all([
          storesService.listCostCentres(propertyId),
          storesService.getSettings(propertyId),
        ]);
        if (!active) return;
        const rows = Array.isArray(centres?.rows) ? centres.rows.filter((row) => row.active) : [];
        setCostCentres(rows);
        if (!settings?.direct_issue_enabled && rows.length === 0) {
          setError('No active cost centre is configured. Ask a Stores manager to add one.');
        }

        if (editingId) {
          const detail = await storesService.requisitionDetail(propertyId, editingId);
          if (!active) return;
          setCostCentreId(detail.cost_centre_id || '');
          setNeededBy(detail.needed_by || '');
          setPriority(detail.priority || 'normal');
          setNotes(detail.notes || '');
          setStatus(detail.status || 'draft');
          setReqNo(detail.req_no || '');
          setLines((Array.isArray(detail.lines) ? detail.lines : []).map((line) => ({
            key: line.id,
            product_id: line.product_id,
            name: line.product_name,
            sku: line.sku,
            base_unit: line.base_unit,
            unit_code: line.unit_code || line.base_unit || 'unit',
            qty: String(line.requested_qty ?? ''),
            on_hand: Number(line.on_hand || 0),
            par_qty: 0,
            pending_qty: 0,
          })));
          await loadProducts(detail.cost_centre_id);
        } else if (rows.length > 0) {
          setCostCentreId(rows[0].id);
        }
      } catch (err) {
        if (active) setError(err?.message || 'Unable to load the requisition form.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, editingId]);

  useEffect(() => {
    if (!propertyId || !costCentreId) return;
    let active = true;
    (async () => {
      await loadProducts(costCentreId);
      try {
        const data = await storesService.listParTemplates(propertyId, costCentreId);
        if (active) setParTemplates(Array.isArray(data?.rows) ? data.rows.filter((row) => row.active) : []);
      } catch {
        if (active) setParTemplates([]);
      }
    })();
    return () => { active = false; };
  }, [propertyId, costCentreId, loadProducts]);

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    const chosen = new Set(lines.map((line) => line.product_id));
    return products
      .filter((product) => !chosen.has(product.product_id))
      .filter((product) => !term
        || String(product.name || '').toLowerCase().includes(term)
        || String(product.sku || '').toLowerCase().includes(term))
      .slice(0, 40);
  }, [products, search, lines]);

  const addProduct = (product) => {
    setLines((current) => [
      ...current,
      {
        key: product.product_id,
        product_id: product.product_id,
        name: product.name,
        sku: product.sku,
        base_unit: product.base_unit,
        unit_code: product.base_unit || 'unit',
        qty: product.par_qty ? String(product.par_qty) : '1',
        on_hand: Number(product.on_hand || 0),
        par_qty: Number(product.par_qty || 0),
        pending_qty: Number(product.pending_qty || 0),
      },
    ]);
    setSearch('');
  };

  const applyParTemplate = (templateId) => {
    setParTemplateId(templateId);
    const template = parTemplates.find((row) => row.id === templateId);
    if (!template) return;
    const byProduct = new Map(products.map((product) => [product.product_id, product]));
    setLines((current) => {
      const map = new Map(current.map((line) => [line.product_id, line]));
      for (const par of Array.isArray(template.lines) ? template.lines : []) {
        const product = byProduct.get(par.product_id);
        if (!product) continue;
        map.set(par.product_id, {
          key: par.product_id,
          product_id: par.product_id,
          name: product.name,
          sku: product.sku,
          base_unit: product.base_unit,
          unit_code: par.unit_code || product.base_unit || 'unit',
          qty: String(par.qty ?? ''),
          on_hand: Number(product.on_hand || 0),
          par_qty: Number(par.qty || 0),
          pending_qty: Number(product.pending_qty || 0),
        });
      }
      return Array.from(map.values());
    });
    toast.success(`Applied ${template.name}.`);
  };

  const updateLine = (productId, patch) => {
    setLines((current) => current.map((line) => (
      line.product_id === productId ? { ...line, ...patch } : line
    )));
  };

  const removeLine = (productId) => {
    setLines((current) => current.filter((line) => line.product_id !== productId));
  };

  const totalUnits = lines.reduce((sum, line) => sum + Number(line.qty || 0), 0);

  const buildPayload = () => ({
    id: editingId || undefined,
    cost_centre_id: costCentreId,
    from_location_id: null,
    needed_by: neededBy || null,
    priority,
    notes: notes || null,
    idempotency_key: editingId ? null : idempotencyKey.current,
    lines: lines.map((line) => ({
      product_id: line.product_id,
      requested_qty: Number(line.qty),
      unit_code: line.unit_code,
    })),
  });

  const validate = () => {
    if (!costCentreId) return 'Choose a cost centre.';
    if (lines.length === 0) return 'Add at least one product.';
    for (const line of lines) {
      const qty = Number(line.qty);
      if (!Number.isFinite(qty) || qty <= 0) return `Enter a quantity for ${line.name}.`;
      if (Math.round(qty * 100) !== qty * 100) return `${line.name} must use at most two decimals.`;
    }
    return '';
  };

  const handleSave = async ({ submit } = {}) => {
    const validation = validate();
    if (validation) {
      setError(validation);
      toast.error(validation);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const saved = await storesService.saveRequisition(propertyId, buildPayload());
      idempotencyKey.current = newIdempotencyKey();

      if (submit) {
        await storesService.submitRequisition(propertyId, saved.id);
        toast.success(`${saved.req_no} submitted.`);
        navigate('/stores/requisitions');
        return;
      }

      toast.success(`${saved.req_no} saved as draft.`);
      if (!editingId) {
        navigate(`/stores/request-stock?id=${saved.id}`, { replace: true });
      } else {
        setStatus(saved.status);
        setReqNo(saved.req_no);
      }
    } catch (err) {
      const message = err?.message || 'Unable to save this requisition.';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-full bg-[var(--canvas)] p-6">
        <div className="mx-auto max-w-6xl animate-pulse space-y-3">
          <div className="h-8 w-56 rounded bg-[var(--border)]/70" />
          <div className="h-40 rounded-xl bg-[var(--border)]/40" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[var(--canvas)] px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Link
              to="/stores/requisitions"
              className="mt-0.5 inline-flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
              aria-label="Back to requisitions"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-normal text-[var(--text)]">{editingId ? 'Edit requisition' : 'Request stock'}</h1>
                {reqNo ? <span className="text-sm font-semibold text-[var(--text-muted)]">{reqNo}</span> : null}
                {editingId ? <StoresStatusBadge status={status} /> : null}
              </div>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                Request items from the store. Submitting does not move stock; the store issues against the approval.
              </p>
            </div>
          </div>
        </div>

        {!canEdit && editingId ? (
          <div className="flex items-start gap-3 rounded-xl border border-[var(--warning)] bg-[var(--warning-soft)] px-4 py-3 text-sm text-[var(--warning-text)]" role="status">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>This requisition is {String(status).replaceAll('_', ' ')} and can no longer be edited.</span>
          </div>
        ) : null}

        {error ? (
          <div className="flex items-start gap-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger-text)]" role="alert">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5">
            <section className={`${PANEL} p-4 sm:p-5`} aria-labelledby="requisition-details-heading">
              <h2 id="requisition-details-heading" className="mb-4 text-base font-semibold text-[var(--text)]">Request details</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium text-[var(--text)]">Cost centre</span>
                  <select
                    className={FIELD}
                    value={costCentreId}
                    disabled={!canEdit}
                    onChange={(event) => setCostCentreId(event.target.value)}
                  >
                    <option value="">Select a cost centre</option>
                    {costCentres.map((centre) => (
                      <option key={centre.id} value={centre.id}>{centre.name}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium text-[var(--text)]">Needed by</span>
                  <input
                    type="date"
                    className={FIELD}
                    value={neededBy}
                    disabled={!canEdit}
                    onChange={(event) => setNeededBy(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium text-[var(--text)]">Priority</span>
                  <select
                    className={FIELD}
                    value={priority}
                    disabled={!canEdit}
                    onChange={(event) => setPriority(event.target.value)}
                  >
                    {PRIORITIES.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium text-[var(--text)]">Notes</span>
                  <input
                    type="text"
                    className={FIELD}
                    value={notes}
                    disabled={!canEdit}
                    placeholder="Optional instruction for the store"
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </label>
              </div>
            </section>

            <section className={`${PANEL} p-4 sm:p-5`} aria-labelledby="requisition-lines-heading">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 id="requisition-lines-heading" className="text-base font-semibold text-[var(--text)]">
                  Items <span className="text-sm font-normal text-[var(--text-muted)]">({lines.length})</span>
                </h2>
                {parTemplates.length > 0 && canEdit ? (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-[var(--text-muted)]">Load par</span>
                    <select
                      className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                      value={parTemplateId}
                      onChange={(event) => applyParTemplate(event.target.value)}
                    >
                      <option value="">Saved templates</option>
                      {parTemplates.map((template) => (
                        <option key={template.id} value={template.id}>{template.name}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              {canEdit ? (
                <div className="mb-4">
                  <div className="relative">
                    <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search products by name or SKU"
                      aria-label="Search products"
                      className={`${FIELD} pl-9`}
                    />
                  </div>
                  {search.trim() ? (
                    <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-[var(--border)]">
                      {productsLoading ? (
                        <p className="px-3 py-3 text-sm text-[var(--text-muted)]">Loading products…</p>
                      ) : filteredProducts.length === 0 ? (
                        <p className="px-3 py-3 text-sm text-[var(--text-muted)]">No matching stock items.</p>
                      ) : filteredProducts.map((product) => (
                        <button
                          key={product.product_id}
                          type="button"
                          onClick={() => addProduct(product)}
                          className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2 text-left text-sm last:border-b-0 hover:bg-[var(--primary-soft)]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-[var(--text)]">{product.name}</span>
                            <span className="block text-xs text-[var(--text-muted)]">
                              {product.sku || 'No SKU'} · On hand {Number(product.on_hand || 0)} {product.base_unit || ''}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs text-[var(--text-muted)]">
                            Par {Number(product.par_qty || 0)}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {lines.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center">
                  <ClipboardList size={28} className="mx-auto mb-2 text-[var(--text-muted)]" />
                  <p className="text-sm text-[var(--text-muted)]">No items yet. Search for a product to add it.</p>
                </div>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {lines.map((line) => (
                    <li key={line.product_id} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--text)]">{line.name}</p>
                        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                          {line.sku || 'No SKU'} · On hand {line.on_hand} {line.base_unit || ''}
                          {line.pending_qty > 0 ? ` · Pending ${line.pending_qty}` : ''}
                          {line.par_qty > 0 ? ` · Par ${line.par_qty}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <QtyInput
                          label={line.name}
                          value={line.qty}
                          onChange={(value) => updateLine(line.product_id, { qty: value })}
                        />
                        <span className="w-14 text-xs text-[var(--text-muted)]">{line.unit_code || line.base_unit}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(line.product_id)}
                        disabled={!canEdit}
                        aria-label={`Remove ${line.name}`}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger-text)] disabled:opacity-40"
                      >
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            <div className={`${PANEL} p-4 sm:p-5`}>
              <h2 className="text-base font-semibold text-[var(--text)]">Summary</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--text-muted)]">Items</dt>
                  <dd className="font-semibold text-[var(--text)]">{lines.length}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--text-muted)]">Total quantity</dt>
                  <dd className="font-semibold text-[var(--text)]">{totalUnits.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--text-muted)]">Cost centre</dt>
                  <dd className="text-right font-medium text-[var(--text)]">
                    {costCentres.find((centre) => centre.id === costCentreId)?.name || '—'}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 rounded-md bg-[var(--canvas)] px-3 py-2 text-xs text-[var(--text-muted)]">
                Stock changes only when the store posts an issue note.
              </p>
            </div>

            <div className={`${PANEL} space-y-2 p-4 sm:p-5`}>
              <button
                type="button"
                onClick={() => handleSave({ submit: false })}
                disabled={!canEdit}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-[var(--primary)] bg-transparent px-4 text-sm font-semibold text-[var(--primary)] hover:bg-[var(--primary-soft)] disabled:opacity-50"
              >
                <Save size={16} /> Save draft
              </button>
              <button
                type="button"
                onClick={() => handleSave({ submit: true })}
                disabled={!canEdit}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-95 disabled:opacity-50"
              >
                <Send size={16} /> Submit request
              </button>
              <Link
                to="/stores/requisitions"
                className="inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                Cancel
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
