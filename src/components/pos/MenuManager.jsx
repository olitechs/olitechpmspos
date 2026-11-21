import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Download,
  Edit3,
  Eye,
  EyeOff,
  Image as ImageIcon,
  ImagePlus,
  LayoutGrid,
  Loader2,
  Plus,
  Save,
  Search,
  Tags,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { inventoryService } from '@/services/inventoryService';
import { useAuth } from '@/lib/AuthContext';
import { formatAmount } from '@/lib/posMoney';
import { SegmentedControl, StatusBadge } from '@/components/ui/system';
import MenuVisualEditor from '@/components/pos/MenuVisualEditor';
import CompositeItemEditor from '@/components/pos/CompositeItemEditor';
import {
  buildOrderPayload,
  canEditPriceAndStock,
  canManageMenuCategories,
  emptyMenuDraft,
  filterMenuItems,
  groupMenuItems,
  menuRowToDraft,
  moveWithin,
  nextSortOrder,
  toNumber,
} from '@/lib/posMenuAdmin';

const CENTER_OPTIONS = ['Kitchen', 'Bar'];
const UNIT_OPTIONS = ['pcs', 'bottle', 'glass', 'plate', 'portion', 'kg', 'ltr'];

function tokenColor(name, fallback = '') {
  if (typeof window === 'undefined') return fallback;
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

/**
 * Menu edits refresh this terminal immediately. Other terminals are refreshed
 * by the Postgres realtime subscription in `inventoryService.subscribePosMenu`,
 * so no extra broadcast channel is needed.
 */
const notifyMenuUpdated = () => {
  window.dispatchEvent(new Event('olitech:menu-updated'));
};

function ProductRow({ product, onMove, onToggle, onEdit, busy, canManage, canMoveUp, canMoveDown }) {
  const active = product.pos_active !== false;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_6rem_5rem_auto]">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-[var(--text)]" title={product.name}>{product.name}</span>
          {!active && <StatusBadge status="neutral">Hidden</StatusBadge>}
        </div>
        <div className="truncate text-[11px] text-[var(--muted)]" title={product.sku || ''}>
          {product.sku || 'No SKU'} · {product.production_center || 'Kitchen'}
        </div>
      </div>
      <div className="hidden text-right text-sm tabular-nums text-[var(--text)] sm:block">{formatAmount(toNumber(product.selling_price))}</div>
      <div className="hidden text-right text-xs tabular-nums text-[var(--muted)] sm:block">{toNumber(product.current_stock)} {product.unit || 'pcs'}</div>
      <div className="flex items-center justify-end gap-1">
        {canManage && <>
          <button type="button" onClick={() => onMove(product, -1)} disabled={busy || !canMoveUp} aria-label={`Move ${product.name} up`} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)] disabled:opacity-40"><ChevronUp size={15} /></button>
          <button type="button" onClick={() => onMove(product, 1)} disabled={busy || !canMoveDown} aria-label={`Move ${product.name} down`} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)] disabled:opacity-40"><ChevronDown size={15} /></button>
          <button type="button" onClick={() => onToggle(product)} disabled={busy} aria-pressed={active} aria-label={`${active ? 'Hide' : 'Show'} ${product.name} on the POS`} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)] disabled:opacity-40">{active ? <Eye size={15} /> : <EyeOff size={15} />}</button>
        </>}
        <button type="button" onClick={() => onEdit(product)} className="inline-flex h-9 items-center gap-1 rounded-md border border-[var(--border)] px-2.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--primary-soft)]"><Edit3 size={14} /> {canManage ? 'Edit' : 'Appearance'}</button>
      </div>
    </li>
  );
}

function CategoryRow({ category, draft, count, onDraft, onSave, onMove, onToggle, busy, canMoveUp, canMoveDown }) {
  const active = category.active !== false;
  return (
    <li className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={draft.name}
          onChange={(event) => onDraft({ name: event.target.value })}
          aria-label={`Category name for ${category.name}`}
          className="min-h-10 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm font-medium text-[var(--text)]"
        />
        <span className="text-[11px] text-[var(--muted)]">{count} products</span>
        <label className="flex min-h-10 items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Send category orders to
          <select value={draft.production_center} onChange={(event) => onDraft({ production_center: event.target.value })} aria-label={`Send ${category.name} orders to`} className="min-h-10 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs font-normal normal-case text-[var(--text)]">
            {CENTER_OPTIONS.map((center) => <option key={center}>{center}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => onMove(category, -1)} disabled={busy || !canMoveUp} aria-label={`Move ${category.name} up`} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)] disabled:opacity-40"><ChevronUp size={15} /></button>
        <button type="button" onClick={() => onMove(category, 1)} disabled={busy || !canMoveDown} aria-label={`Move ${category.name} down`} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)] disabled:opacity-40"><ChevronDown size={15} /></button>
        <button type="button" onClick={() => onToggle(category)} disabled={busy} aria-pressed={active} className="inline-flex h-9 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-2)]">{active ? <Eye size={14} /> : <EyeOff size={14} />}{active ? 'Visible' : 'Hidden'}</button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Tile
          <input type="color" value={draft.tile_color || tokenColor('--primary', tokenColor('--text'))} onChange={(event) => onDraft({ tile_color: event.target.value })} className="mt-1 h-9 w-full rounded border border-[var(--border)]" aria-label={`Tile colour for ${category.name}`} />
        </label>
        <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Text
          <input type="color" value={draft.tile_text_color || tokenColor('--on-primary', tokenColor('--white'))} onChange={(event) => onDraft({ tile_text_color: event.target.value })} className="mt-1 h-9 w-full rounded border border-[var(--border)]" aria-label={`Text colour for ${category.name}`} />
        </label>
        <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Image URL
          <input value={draft.tile_image_url} onChange={(event) => onDraft({ tile_image_url: event.target.value })} placeholder="https://…" className="mt-1 h-9 w-full rounded border border-[var(--border)] px-2 text-xs" aria-label={`Image URL for ${category.name}`} />
        </label>
        <button type="button" onClick={() => onSave(category)} disabled={busy} className="mt-4 inline-flex h-9 items-center justify-center gap-1 rounded-md bg-[var(--primary)] px-3 text-xs font-semibold text-[var(--on-primary)] hover:bg-[var(--primary-hover)] disabled:opacity-60"><Save size={14} /> Save</button>
      </div>
    </li>
  );
}

export default function MenuManager({ open, onClose, embedded = false }) {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const activeStaff = (() => { try { return JSON.parse(sessionStorage.getItem('olitech_active_staff_v2') || 'null'); } catch { return null; } })();
  const menuRole = String(activeStaff?.role || user?.staff?.role || user?.propertyRole || user?.role || '').toLowerCase();
  const visualOnly = ['cashier', 'store_manager', 'storekeeper'].includes(menuRole);
  const fileRef = useRef(null);
  const imageFileRef = useRef(null);
  const requestRef = useRef(0);

  const [tab, setTab] = useState('products');
  const [menu, setMenu] = useState([]);
  const [categories, setCategories] = useState([]);
  const [categoryDrafts, setCategoryDrafts] = useState({});
  const [newCategory, setNewCategory] = useState(() => ({ name: '', production_center: 'Kitchen', tile_color: '', tile_text_color: '', tile_image_url: '' }));
  const [editing, setEditing] = useState(null);
  const [editingSection, setEditingSection] = useState('details');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [busyKey, setBusyKey] = useState('');

  const canEditCatalogue = canEditPriceAndStock(user);
  const canManageCategories = canManageMenuCategories(user);

  const draftForCategory = useCallback((category) => categoryDrafts[category.id] || {
    name: category.name,
    production_center: category.production_center || 'Kitchen',
    tile_color: category.tile_color || '',
    tile_text_color: category.tile_text_color || '',
    tile_image_url: category.tile_image_url || '',
  }, [categoryDrafts]);

  const reload = useCallback(async () => {
    if (!propertyId) return;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setError('');
    try {
      const [products, categoryRows] = await Promise.all([
        inventoryService.listPosMenuAdmin(propertyId),
        inventoryService.listPosCategoriesAdmin(propertyId),
      ]);
      if (requestRef.current !== requestId) return;
      setMenu(Array.isArray(products) ? products : []);
      setCategories(Array.isArray(categoryRows) ? categoryRows : []);
      setCategoryDrafts({});
    } catch (cause) {
      if (requestRef.current !== requestId) return;
      setError(cause?.message || 'The menu could not be loaded.');
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    if (!open) {
      requestRef.current += 1;
      return;
    }
    void reload();
  }, [open, reload]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (editing) setEditing(null);
      else onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, editing, onClose]);

  const filtered = useMemo(() => filterMenuItems(menu, { search, category: categoryFilter }), [menu, search, categoryFilter]);
  const grouped = useMemo(() => groupMenuItems(filtered, categories), [filtered, categories]);
  const countsByCategory = useMemo(() => {
    const counts = {};
    for (const product of menu) {
      const key = product.category || 'General';
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [menu]);

  if (!open) return null;

  // Cashiers and storekeepers get the presentation-only editor. Keeping this
  // early return means the manager RPC and price/stock controls are never
  // reachable for them, matching the server-side visual permission model.
  if (visualOnly) return <MenuVisualEditor open={open} onClose={onClose} embedded={embedded} propertyId={propertyId} />;

  const startAddProduct = () => {
    const first = categories.find((category) => category.active !== false) || categories[0];
    const categoryName = categoryFilter !== 'all' ? categoryFilter : (first?.name || 'General');
    const siblings = menu.filter((product) => (product.category || 'General') === categoryName);
    setEditingSection('details');
    setEditing(emptyMenuDraft(categoryName, first?.production_center || 'Kitchen', nextSortOrder(siblings.map((product) => product.pos_sort))));
  };

  const saveProduct = async () => {
    if (saving) return;
    // Fallback for any role that can reach this screen but must not change the
    // catalogue. Appearance still goes through the restricted PR 194 RPC, never
    // a direct table write, so the server stays the authority.
    if (!canEditCatalogue) {
      if (!editing?.id) return;
      setSaving(true);
      try {
        const { error: visualError } = await inventoryService.updatePosMenuItemVisuals({
          propertyId,
          id: editing.id,
          tile_color: editing.tile_color,
          tile_text_color: editing.tile_text_color,
          tile_image_url: editing.tile_image_url,
        });
        if (visualError) throw new Error(visualError.message);
        setEditing(null);
        notifyMenuUpdated();
        await reload();
        toast.success('Tile appearance saved.');
      } catch (cause) {
        toast.error(cause?.message || 'Could not save the tile appearance.');
      } finally {
        setSaving(false);
      }
      return;
    }
    const name = String(editing?.name || '').trim();
    if (!name) { toast.error('Product name is required.'); return; }
    const sellingPrice = toNumber(editing.selling_price);
    const currentStock = toNumber(editing.current_stock);
    if (sellingPrice < 0 || currentStock < 0) { toast.error('Price and stock cannot be negative.'); return; }
    setSaving(true);
    try {
      const saved = await inventoryService.upsertPosMenuItem({
        propertyId,
        id: editing.id || null,
        sku: editing.sku,
        name,
        category: editing.category || 'General',
        unit: editing.unit || 'pcs',
        sellingPrice,
        currentStock,
        minStock: toNumber(editing.min_stock),
        maxStock: toNumber(editing.max_stock),
        productionCenter: editing.production_center || 'Kitchen',
        sortOrder: toNumber(editing.pos_sort),
        active: editing.pos_active !== false,
      });
      const savedId = editing.id || saved?.id;
      if (savedId) {
        try {
          const { error: visualError } = await inventoryService.updatePosMenuItemVisuals({
            propertyId,
            id: savedId,
            tile_color: editing.tile_color,
            tile_text_color: editing.tile_text_color,
            tile_image_url: editing.tile_image_url,
          });
          if (visualError) throw new Error(visualError.message);
        } catch (visualCause) {
          // The catalogue RPC has already committed. Keep the saved ID in the
          // draft so retrying appearance cannot accidentally create a duplicate.
          setEditing((current) => (current ? { ...current, id: savedId } : current));
          notifyMenuUpdated();
          await reload();
          throw new Error(`Product details were saved, but tile appearance was not: ${visualCause?.message || 'unknown error'}. Retry Save product to finish the appearance update.`);
        }
      }
      setEditing(null);
      notifyMenuUpdated();
      await reload();
      toast.success(editing.id ? 'Menu item updated.' : 'Menu item added to the POS.');
    } catch (cause) {
      toast.error(cause?.message || 'Could not save the menu item.');
    } finally {
      setSaving(false);
    }
  };

  const uploadProductPhoto = async (file) => {
    if (!file || !editing) return;
    setImageUploading(true);
    try {
      const url = await inventoryService.uploadPosMenuItemImage(propertyId, file);
      setEditing((current) => (current ? { ...current, tile_image_url: url } : current));
      toast.success('Product photo uploaded. Save the product to apply it.');
    } catch (cause) {
      toast.error(cause?.message || 'Could not upload product photo.');
    } finally {
      setImageUploading(false);
      if (imageFileRef.current) imageFileRef.current.value = '';
    }
  };

  const moveProduct = async (product, direction) => {
    const siblings = menu
      .filter((row) => (row.category || 'General') === (product.category || 'General'))
      .sort((a, b) => toNumber(a.pos_sort) - toNumber(b.pos_sort) || String(a.name || '').localeCompare(String(b.name || '')));
    const index = siblings.findIndex((row) => row.id === product.id);
    const reordered = moveWithin(siblings, index, direction);
    if (reordered === siblings) return;
    const payload = buildOrderPayload(reordered);
    const key = `product-order:${product.id}`;
    setBusyKey(key);
    setMenu((current) => current.map((row) => {
      const match = payload.find((entry) => entry.id === row.id);
      return match ? { ...row, pos_sort: match.sortOrder } : row;
    }));
    try {
      await inventoryService.reorderPosMenuItems(propertyId, payload);
      notifyMenuUpdated();
    } catch (cause) {
      toast.error(cause?.message || 'Could not update the product order.');
      await reload();
    } finally {
      setBusyKey('');
    }
  };

  const toggleProduct = async (product) => {
    const nextActive = product.pos_active === false;
    const key = `product-visible:${product.id}`;
    setBusyKey(key);
    setMenu((current) => current.map((row) => (row.id === product.id ? { ...row, pos_active: nextActive } : row)));
    try {
      await inventoryService.setPosMenuItemPosActive({ propertyId, id: product.id, active: nextActive });
      notifyMenuUpdated();
    } catch (cause) {
      toast.error(cause?.message || 'Could not change POS visibility.');
      await reload();
    } finally {
      setBusyKey('');
    }
  };

  const moveCategory = async (category, direction) => {
    const index = categories.findIndex((row) => row.id === category.id);
    const reordered = moveWithin(categories, index, direction);
    if (reordered === categories) return;
    const payload = buildOrderPayload(reordered);
    setBusyKey(`category-order:${category.id}`);
    setCategories(reordered.map((row, order) => ({ ...row, sort_order: order })));
    try {
      await inventoryService.reorderPosCategories(propertyId, payload);
      notifyMenuUpdated();
    } catch (cause) {
      toast.error(cause?.message || 'Could not update the category order.');
      await reload();
    } finally {
      setBusyKey('');
    }
  };

  const toggleCategory = async (category) => {
    const nextActive = category.active === false;
    setBusyKey(`category-visible:${category.id}`);
    setCategories((current) => current.map((row) => (row.id === category.id ? { ...row, active: nextActive } : row)));
    try {
      await inventoryService.setPosCategoryActive({ propertyId, id: category.id, active: nextActive });
      notifyMenuUpdated();
    } catch (cause) {
      toast.error(cause?.message || 'Could not change category visibility.');
      await reload();
    } finally {
      setBusyKey('');
    }
  };

  const saveCategory = async (category) => {
    const draft = draftForCategory(category);
    const name = String(draft.name || '').trim();
    if (!name) { toast.error('Category name is required.'); return; }
    setBusyKey(`category-save:${category.id}`);
    try {
      await inventoryService.updatePosCategory({
        propertyId,
        id: category.id,
        name,
        production_center: draft.production_center,
        tile_color: draft.tile_color,
        tile_text_color: draft.tile_text_color,
        tile_image_url: draft.tile_image_url,
      });
      notifyMenuUpdated();
      await reload();
      toast.success(`${name} saved.`);
    } catch (cause) {
      toast.error(cause?.message || 'Could not save the category.');
    } finally {
      setBusyKey('');
    }
  };

  const addCategory = async () => {
    const name = newCategory.name.trim();
    if (!name) { toast.error('Category name is required.'); return; }
    setBusyKey('category-add');
    try {
      await inventoryService.upsertPosCategory({
        propertyId,
        name,
        productionCenter: newCategory.production_center,
        sortOrder: nextSortOrder(categories.map((category) => category.sort_order)),
        tile_color: newCategory.tile_color || null,
        tile_text_color: newCategory.tile_text_color || null,
        tile_image_url: newCategory.tile_image_url || null,
      });
      setNewCategory({ name: '', production_center: 'Kitchen', tile_color: '', tile_text_color: '', tile_image_url: '' });
      notifyMenuUpdated();
      await reload();
      toast.success('Category added.');
    } catch (cause) {
      toast.error(cause?.message || 'Could not add the category.');
    } finally {
      setBusyKey('');
    }
  };

  const importFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusyKey('import');
    try {
      const rows = await inventoryService.parseImportFile(file);
      const count = await inventoryService.bulkUpsertPosMenu(propertyId, rows);
      notifyMenuUpdated();
      toast.success(`${count} menu products imported.`);
      await reload();
    } catch (cause) {
      toast.error(cause?.message || 'Import failed.');
    } finally {
      setBusyKey('');
      event.target.value = '';
    }
  };

  const exportFile = async () => {
    try {
      await inventoryService.exportPosMenu(menu);
      toast.success('POS menu exported.');
    } catch (cause) {
      toast.error(cause?.message || 'Export failed.');
    }
  };

  const bodyClass = embedded ? 'min-h-0 flex-1' : 'modal-body scroll-shadow-y';

  return (
    <div className={embedded ? 'flex w-full flex-col' : 'fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--overlay-scrim)] p-3 md:p-6'}>
      <div className={(embedded ? 'flex w-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--canvas)]' : 'modal-panel w-full max-w-[min(76rem,calc(100%-1rem))] bg-[var(--canvas)]')}>
        <header className="modal-header flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-semibold text-[var(--text)]"><LayoutGrid size={18} /> POS menu</div>
            <div className="mt-0.5 text-xs text-[var(--text-muted)]">Categories, products, ordering and tile appearance.</div>
          </div>
          <div className="flex items-center gap-2">
            <SegmentedControl
              ariaLabel="Menu management section"
              value={tab}
              onChange={setTab}
              options={canManageCategories
                ? [{ value: 'products', label: 'Products' }, { value: 'categories', label: 'Categories' }]
                : [{ value: 'products', label: 'Products' }]}
            />
            {!embedded && <button type="button" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-2)]" aria-label="Close menu manager"><X size={19} /></button>}
          </div>
        </header>

        <div className={bodyClass}>
          {error && <div role="alert" className="mx-4 mt-4 rounded-lg border border-[var(--danger-text)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger-text)]">{error}</div>}

          {tab === 'products' ? (
            <div className="p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative min-w-[12rem] flex-1">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products or SKU…" aria-label="Search products" className="min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-sm text-[var(--text)]" />
                </label>
                <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter by category" className="min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]">
                  <option value="all">All categories</option>
                  {categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}
                </select>
                {canEditCatalogue && <button type="button" onClick={startAddProduct} className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--on-primary)] hover:bg-[var(--primary-hover)]"><Plus size={15} /> Add product</button>}
                {canEditCatalogue && <button type="button" onClick={() => fileRef.current?.click()} disabled={busyKey === 'import'} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-60"><Upload size={15} /> Import</button>}
                <button type="button" onClick={exportFile} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-2)]"><Download size={15} /> Export</button>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.xml" onChange={importFile} hidden />
              </div>

              {loading ? (
                <div className="mt-4 space-y-2" aria-busy="true" aria-label="Loading menu">
                  {[0, 1, 2, 3].map((key) => <div key={key} className="h-14 animate-pulse rounded-lg bg-[var(--surface-2)]" />)}
                </div>
              ) : grouped.length === 0 ? (
                <div className="mt-6 rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center">
                  <p className="text-sm font-medium text-[var(--text)]">No menu products yet.</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{canEditCatalogue ? 'Add a product or import a spreadsheet to build the POS menu.' : 'No products match this filter.'}</p>
                </div>
              ) : (
                <div className="mt-4 space-y-5">
                  {grouped.map((group) => (
                    <section key={group.name} aria-label={`${group.name} products`}>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]"><Tags size={13} /> {group.name}</h3>
                        <span className="text-[11px] text-[var(--text-muted)]">{group.items.length} items</span>
                      </div>
                      <ul className="space-y-2">
                        {group.items.map((product, index) => (
                          <ProductRow
                            key={product.id}
                            product={product}
                            busy={Boolean(busyKey)}
                            canManage={canEditCatalogue}
                            canMoveUp={index > 0}
                            canMoveDown={index < group.items.length - 1}
                            onMove={moveProduct}
                            onToggle={toggleProduct}
                            onEdit={(row) => { setEditingSection('details'); setEditing(menuRowToDraft(row)); }}
                          />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]"><Tags size={13} /> Category order</h3>
                {loading ? <div className="h-24 animate-pulse rounded-xl bg-[var(--surface-2)]" /> : categories.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">No categories yet.</div>
                ) : (
                  <ul className="space-y-2">
                    {categories.map((category, index) => {
                      const draft = draftForCategory(category);
                      return (
                        <CategoryRow
                          key={category.id}
                          category={category}
                          draft={draft}
                          count={countsByCategory[category.name] || 0}
                          busy={Boolean(busyKey)}
                          canMoveUp={index > 0}
                          canMoveDown={index < categories.length - 1}
                          onDraft={(patch) => setCategoryDrafts((current) => ({ ...current, [category.id]: { ...draft, ...patch } }))}
                          onSave={saveCategory}
                          onMove={moveCategory}
                          onToggle={toggleCategory}
                        />
                      );
                    })}
                  </ul>
                )}
              </div>
              <aside className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <h3 className="text-sm font-semibold text-[var(--text)]">Add category</h3>
                <div className="mt-2 space-y-2">
                  <input value={newCategory.name} onChange={(event) => setNewCategory({ ...newCategory, name: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') addCategory(); }} placeholder="e.g. Cocktails" aria-label="New category name" className="min-h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm" />
                  <select value={newCategory.production_center} onChange={(event) => setNewCategory({ ...newCategory, production_center: event.target.value })} aria-label="New category production centre" className="min-h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
                    {CENTER_OPTIONS.map((center) => <option key={center}>{center}</option>)}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Tile
                      <input type="color" value={newCategory.tile_color || tokenColor('--primary', tokenColor('--text'))} onChange={(event) => setNewCategory({ ...newCategory, tile_color: event.target.value })} className="mt-1 h-9 w-full rounded border border-[var(--border)]" />
                    </label>
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Text
                      <input type="color" value={newCategory.tile_text_color || tokenColor('--on-primary', tokenColor('--white'))} onChange={(event) => setNewCategory({ ...newCategory, tile_text_color: event.target.value })} className="mt-1 h-9 w-full rounded border border-[var(--border)]" />
                    </label>
                  </div>
                  <input value={newCategory.tile_image_url} onChange={(event) => setNewCategory({ ...newCategory, tile_image_url: event.target.value })} placeholder="Optional image URL" aria-label="New category image URL" className="min-h-11 w-full rounded-lg border border-[var(--border)] px-3 text-xs" />
                  <button type="button" onClick={addCategory} disabled={busyKey === 'category-add'} className="inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-lg bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--on-primary)] hover:bg-[var(--primary-hover)] disabled:opacity-60">{busyKey === 'category-add' ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add category</button>
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--overlay-scrim)] p-3 md:p-6">
          <div className="modal-panel max-h-[90dvh] max-w-3xl">
            <header className="modal-header flex items-center justify-between gap-3 border-b border-[var(--border)] px-[var(--modal-pad)] py-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--text)]">{canEditCatalogue ? (editing.id ? 'Edit POS product' : 'Add POS product') : 'Edit POS tile'}</h2>
                <p className="text-xs text-[var(--text-muted)]">{editing.category || 'General'}</p>
              </div>
              <button type="button" onClick={() => setEditing(null)} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-2)]" aria-label="Close product editor"><X size={18} /></button>
            </header>
            <div className="modal-body scroll-shadow-y overflow-y-auto px-[var(--modal-pad)] py-4">
              <div className="mb-4 flex flex-wrap gap-2 border-b border-[var(--border)] pb-3" role="tablist" aria-label="Product editor sections">
                {[
                  { value: 'details', label: 'Details' },
                  ...(canEditCatalogue ? [{ value: 'inventory', label: 'Pricing & inventory' }] : []),
                  { value: 'appearance', label: 'POS appearance' },
                ].map((section) => (
                  <button key={section.value} type="button" role="tab" aria-selected={editingSection === section.value}
                    onClick={() => setEditingSection(section.value)}
                    className={`min-h-10 rounded-lg px-3 text-xs font-semibold transition-colors ${editingSection === section.value ? 'bg-[var(--primary)] text-[var(--on-primary)]' : 'border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]'}`}>
                    {section.label}
                  </button>
                ))}
              </div>
              {editingSection === 'details' && (canEditCatalogue ? (
                <div className="grid gap-3 sm:grid-cols-2">
<label className="text-xs font-medium text-[var(--text)]">Product name
                    <input value={editing.name || ''} onChange={(event) => setEditing({ ...editing, name: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm" autoComplete="off" />
                  </label>
                  <label className="text-xs font-medium text-[var(--text)]">SKU
                    <input value={editing.sku || ''} onChange={(event) => setEditing({ ...editing, sku: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm" autoComplete="off" />
                  </label>
                  <label className="text-xs font-medium text-[var(--text)]">Category
                    <select value={editing.category || 'General'} onChange={(event) => setEditing({ ...editing, category: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
                      {categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}
                      {!categories.length && <option value="General">General</option>}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-[var(--text)]">Unit
                    <select value={editing.unit || 'pcs'} onChange={(event) => setEditing({ ...editing, unit: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
                      {UNIT_OPTIONS.map((unit) => <option key={unit}>{unit}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-[var(--text)]">Production centre
                    <select value={editing.production_center || 'Kitchen'} onChange={(event) => setEditing({ ...editing, production_center: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
                      {CENTER_OPTIONS.map((center) => <option key={center}>{center}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-[var(--text)]">Sort order
                    <input type="number" min="0" value={editing.pos_sort ?? 0} onChange={(event) => setEditing({ ...editing, pos_sort: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm" />
                  </label>
                </div>
              ) : (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
                  <p className="text-sm font-semibold text-[var(--text)]">{editing.name || 'Product'}</p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">{editing.category || 'General'} · {formatAmount(toNumber(editing.selling_price))} · {toNumber(editing.current_stock)} {editing.unit || 'pcs'} in stock</p>
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">Prices and stock are managed in Store or by a manager. This editor only changes the POS tile.</p>
                </div>
              ))}
              {editingSection === 'inventory' && canEditCatalogue && (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
<label className="text-xs font-medium text-[var(--text)]">Selling price (KES)
                    <input type="number" min="0" step="0.01" value={editing.selling_price ?? 0} onChange={(event) => setEditing({ ...editing, selling_price: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm" />
                  </label>
                  <label className="text-xs font-medium text-[var(--text)]">Current stock
                    <input type="number" min="0" value={editing.current_stock ?? 0} onChange={(event) => setEditing({ ...editing, current_stock: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm" />
                  </label>
                  <label className="text-xs font-medium text-[var(--text)]">Minimum stock
                    <input type="number" min="0" value={editing.min_stock ?? 0} onChange={(event) => setEditing({ ...editing, min_stock: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm" />
                  </label>
                  <label className="text-xs font-medium text-[var(--text)]">Maximum stock
                    <input type="number" min="0" value={editing.max_stock ?? 0} onChange={(event) => setEditing({ ...editing, max_stock: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm" />
                  </label>
                  </div>
                  <CompositeItemEditor propertyId={propertyId} productId={editing.id} onSaved={() => { void reload(); notifyMenuUpdated(); }} />
                </div>
              )}
              {editingSection === 'appearance' && (
              <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"><ImageIcon size={14} /> Tile appearance</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))_minmax(0,2fr)]">
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Tile colour
                    <input type="color" value={editing.tile_color || tokenColor('--primary', tokenColor('--text'))} onChange={(event) => setEditing({ ...editing, tile_color: event.target.value })} className="mt-1 h-10 w-full rounded border border-[var(--border)]" />
                  </label>
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Text colour
                    <input type="color" value={editing.tile_text_color || tokenColor('--on-primary', tokenColor('--white'))} onChange={(event) => setEditing({ ...editing, tile_text_color: event.target.value })} className="mt-1 h-10 w-full rounded border border-[var(--border)]" />
                  </label>
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Image URL
                    <input value={editing.tile_image_url || ''} onChange={(event) => setEditing({ ...editing, tile_image_url: event.target.value })} placeholder="https://…" className="mt-1 min-h-10 w-full rounded border border-[var(--border)] px-2 text-xs" />
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input ref={imageFileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => uploadProductPhoto(event.target.files?.[0])} className="sr-only" />
                  <button type="button" onClick={() => imageFileRef.current?.click()} disabled={imageUploading || saving} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-60"><ImagePlus size={14} /> {imageUploading ? 'Uploading…' : 'Upload photo'}</button>
                  <span className="text-[11px] text-[var(--text-muted)]">Product photo · JPG, PNG or WebP · up to 5 MB</span>
                </div>
                <div className="mt-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Preview</div>
                  <div className="mt-1 flex h-24 w-full max-w-[16rem] items-end overflow-hidden rounded-xl border border-[var(--border)] p-3 text-sm font-semibold" style={{ background: editing.tile_image_url ? `linear-gradient(var(--overlay-scrim),var(--overlay-scrim)),url("${editing.tile_image_url}") center/cover` : (editing.tile_color || 'var(--primary)'), color: editing.tile_text_color || 'var(--on-primary)' }}>
                    <span className="truncate" title={editing.name || 'Product name'}>{editing.name || 'Product name'}</span>
                  </div>
                </div>
                <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-[var(--text)]">
                  <input type="checkbox" checked={editing.pos_active !== false} onChange={(event) => setEditing({ ...editing, pos_active: event.target.checked })} className="h-5 w-5" />
                  Show on the POS
                </label>
              </div>
              )}

            </div>
            <footer className="modal-footer flex flex-col-reverse gap-2 border-t border-[var(--border)] px-[var(--modal-pad)] py-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setEditing(null)} disabled={saving} className="min-h-11 rounded-lg border border-[var(--border)] px-4 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-60">Cancel</button>
              <button type="button" onClick={saveProduct} disabled={saving || imageUploading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-5 text-sm font-semibold text-[var(--on-primary)] hover:bg-[var(--primary-hover)] disabled:opacity-60">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{saving ? 'Saving…' : (canEditCatalogue ? 'Save product' : 'Save appearance')}</button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
