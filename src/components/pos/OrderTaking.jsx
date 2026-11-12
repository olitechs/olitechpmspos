import React, { useEffect, useState } from 'react';
import { AlertTriangle, Search, X, ShieldCheck, ChevronLeft, Folder } from 'lucide-react';
import { CATEGORIES, MENU_ITEMS, VAT_RATE, tableLabel, CATEGORY_CENTER } from '@/data/mockData';
import { useStore } from '@/data/AppStore';
import PrintWarn from '@/components/pos/PrintWarn';
import PinPad from '@/components/auth/PinPad';
import { useAuth } from '@/lib/AuthContext';
import { authService } from '@/services/authService';
import { pmsService } from '@/services/pmsService';
import { getPrinters, getAssignments, printVoidTicket } from '@/services/printService';
import { getPropertySettings } from '@/services/settingsService';
import { inventoryService } from '@/services/inventoryService';
import { posPhase3Service } from '@/services/posPhase3Service';
import { filterPosMenuItems, getPosStockStatus } from '@/components/pos/stockStatus';

function fmt(n) {
  return `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 0 })}`;
}

export default function OrderTaking({ table, orderLines, setOrderLines, onSendToKitchen, onBill, onMoveTable, orderNumber: orderNumberProp }) {
  const store = useStore();
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const activeStaff = (() => { try { return JSON.parse(sessionStorage.getItem('olitech_active_staff_v2') || 'null'); } catch { return null; } })();
  const currentRole = String(activeStaff?.role || user?.staff?.role || user?.propertyRole || user?.role || '').toLowerCase();
  const [activeCategory, setActiveCategory] = useState(null);
  const [orderPanelExpanded, setOrderPanelExpanded] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removeReason, setRemoveReason] = useState('');
  const [removeError, setRemoveError] = useState('');
  const [removeBusy, setRemoveBusy] = useState(false);
  const [pinStaff, setPinStaff] = useState(null);
  const [pinError, setPinError] = useState('');
  const [menuItems, setMenuItems] = useState([]);
  const [menuCategories, setMenuCategories] = useState(CATEGORIES);
  const [menuCategoryStyles, setMenuCategoryStyles] = useState({});
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState('');
  const [menuSearch, setMenuSearch] = useState('');
  const [modifierTarget, setModifierTarget] = useState(null);
  const [modifierGroups, setModifierGroups] = useState([]);
  const [modifierSelections, setModifierSelections] = useState({});
  const [modifierLoading, setModifierLoading] = useState(false);
  const [assignedOrderCenters, setAssignedOrderCenters] = useState(null);
  const [assignedOrderDepartments, setAssignedOrderDepartments] = useState(null);

  const loadPosMenu = async () => {
    if (!propertyId) { setMenuLoading(false); return; }
    setMenuLoading(true);
    setMenuError('');
    try {
      const [rows, categoryRows] = await Promise.all([
        inventoryService.listPosMenu(propertyId),
        inventoryService.listPosCategories(propertyId).catch((error) => {
          console.warn('[POS] category catalogue unavailable; deriving categories from products', error);
          return [];
        })
      ]);
      if (rows.length) {
        setMenuItems(rows.map((p) => ({ ...p, id: p.id, productId: p.id, name: p.name, price: Number(p.selling_price || 0), category: p.category || 'General', center: p.production_center || 'Kitchen', stock: Number(p.current_stock ?? 0), minimumStock: Number(p.min_stock ?? 0), unit: p.unit || 'pcs' })));
      } else {
        setMenuItems([]);
      }
      const configuredCategories = categoryRows.map((category) => category.name).filter(Boolean);
      setMenuCategoryStyles(Object.fromEntries(categoryRows.map((category) => [category.name, category])));
      setMenuCategories(configuredCategories.length ? configuredCategories : [...new Set(rows.map((p) => p.category || 'General'))]);
    } catch (error) {
      console.warn('[POS] menu catalogue unavailable', error);
      setMenuItems([]); setMenuCategories(CATEGORIES);
      setMenuError('The menu could not be loaded. Check the connection and retry.');
    } finally {
      setMenuLoading(false);
    }
  };
  useEffect(() => {
    let active = true;
    if (propertyId) {
      Promise.all([getPrinters(propertyId), getAssignments(propertyId)])
        .then(([printers, assignments]) => {
          if (!active) return;
          const printerIds = new Set(printers.map(printer => printer.id));
          const centers = new Set();
          if (assignments.some(a => a.assignment_type === 'food_orders' && printerIds.has(a.printer_id))) centers.add('kitchen');
          if (assignments.some(a => a.assignment_type === 'drinks_orders' && printerIds.has(a.printer_id))) centers.add('bar');
          setAssignedOrderCenters([...centers]);
          // Departments are the routing key once any printer has one; until then
          // the food/drinks assignment above is what actually prints.
          setAssignedOrderDepartments(printers.map(p => String(p.department || '').trim().toLowerCase()).filter(Boolean));
        })
        .catch(error => {
          console.warn('[POS] could not verify saved order-printer assignments', error);
          if (active) setAssignedOrderCenters([]);
        });
    }
    return () => { active = false; };
  }, [propertyId]);

  useEffect(() => {
    loadPosMenu();
    const refresh = () => loadPosMenu();
    window.addEventListener('olitech:menu-updated', refresh);
    return () => window.removeEventListener('olitech:menu-updated', refresh);
  }, [propertyId]);

  const commitItem = (item, selected = []) => {
    const modifierTotal = selected.reduce((sum, option) => sum + Number(option.price_delta_minor || 0) / 100, 0);
    const selectedIds = selected.map((option) => option.id).sort();
    const lineId = selectedIds.length ? item.id + '::mods::' + selectedIds.join('-') : item.id;
    const unitPrice = Number(item.price || 0) + modifierTotal;
    setOrderLines((prev) => {
      const existing = prev.find((l) => l.id === lineId);
      if (existing) return prev.map((l) => (l.id === lineId ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, {
        ...item, id: lineId, baseProductId: item.productId || item.id, productId: item.productId || item.id,
        qty: 1, price: unitPrice, basePrice: Number(item.price || 0),
        modifiers: selected.map((option) => ({ id: option.id, name: option.name, price_delta_minor: option.price_delta_minor })),
        modifierTotal, category: item.category || activeCategory,
        center: item.center || CATEGORY_CENTER[activeCategory] || 'Kitchen'
      }];
    });
  };

  const addItem = async (item) => {
    if (!propertyId || !(item.productId || item.id)) return commitItem(item);
    setModifierLoading(true);
    try {
      const groups = await posPhase3Service.getItemModifiers(propertyId, item.productId || item.id);
      if (!groups.length) return commitItem(item);
      setModifierTarget(item);
      setModifierGroups(groups);
      setModifierSelections(Object.fromEntries(groups.map((g) => [g.id, []])));
    } catch (error) {
      console.warn('[POS] modifiers unavailable; adding base item', error);
      commitItem(item);
    } finally {
      setModifierLoading(false);
    }
  };

  const toggleModifier = (group, option) => {
    setModifierSelections((prev) => {
      const current = prev[group.id] || [];
      if (group.selection_type === 'single') return { ...prev, [group.id]: [option.id] };
      const exists = current.includes(option.id);
      if (exists) return { ...prev, [group.id]: current.filter((id) => id !== option.id) };
      if (current.length >= Number(group.max_selections || 1)) return prev;
      return { ...prev, [group.id]: [...current, option.id] };
    });
  };

  const confirmModifiers = () => {
    const selected = modifierGroups.flatMap((group) =>
      (modifierSelections[group.id] || []).map((id) => group.options.find((option) => option.id === id)).filter(Boolean)
    );
    const invalid = modifierGroups.find((group) => group.required && (modifierSelections[group.id] || []).length < Math.max(1, Number(group.min_selections || 0)));
    if (invalid) return;
    commitItem(modifierTarget, selected);
    setModifierTarget(null);
    setModifierGroups([]);
    setModifierSelections({});
  };

  const changeQty = (id, delta) => {
    if (delta < 0) {
      const line = orderLines.find((l) => l.id === id);
      if (!line) return;
      const session = store.getSession(table.id);
      const currentQty = Math.max(0, Number(line.qty) || 0);
      const sentLine = (Array.isArray(session?.kotSentOrderLines) ? session.kotSentOrderLines : [])
        .find((item) => item.id === id);
      const sentQty = session?.status === 'unsettled'
        ? currentQty
        : Math.min(currentQty, Math.max(0, Number(sentLine?.qty || 0)));
      const unsentQty = Math.max(0, currentQty - sentQty);
      // Remove unsent additions first. Only quantities confirmed in the KOT
      // snapshot (or included on a printed bill) enter the audited void flow.
      const sent = unsentQty <= 0 && sentQty > 0;
      const allowedQty = sent ? sentQty : unsentQty;
      if (allowedQty <= 0) return;
      setRemoveTarget({
        line,
        removeQty: Math.min(1, allowedQty),
        sent,
        sentQty,
        unsentQty,
      });
      setRemoveReason('');
      setRemoveError('');
      return;
    }
    setOrderLines((prev) => prev.map((l) => (l.id === id ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0));
  };

  const managerRoles = new Set(['hotel_admin','super_admin','cashier','fb_manager','front_office_manager','property_manager','general_manager','manager','admin','owner']);
  const needsManagerPin = !(user?.isPlatformOwner || managerRoles.has(currentRole));

  const performRemoval = async () => {
    if (!removeTarget || !propertyId) return;
    const removeQty = Number(removeTarget.removeQty);
    const allowedQty = Number(removeTarget.sent ? removeTarget.sentQty : removeTarget.unsentQty);
    if (!Number.isFinite(removeQty) || removeQty <= 0 || removeQty > allowedQty) {
      setRemoveError(`Enter a quantity greater than zero and no more than ${allowedQty}.`);
      return;
    }
    if (removeTarget.sent && !removeReason.trim()) {
      setRemoveError('Enter a reason for the item cancellation.');
      return;
    }
    setRemoveBusy(true); setRemoveError('');
    try {
      if (!removeTarget.sent) {
        setOrderLines((prev) => prev
          .map((line) => line.id === removeTarget.line.id ? { ...line, qty: Number(line.qty) - removeQty } : line)
          .filter((line) => Number(line.qty) > 0));
        setRemoveTarget(null);
        return;
      }
      const staffName = activeStaff?.full_name || user?.name || 'POS Staff';
      const result = await pmsService.removeOrderItem({
        propertyId,
        tableKey: table.id,
        itemId: removeTarget.line.id,
        removeQty,
        reason: removeReason.trim(),
        removedByName: staffName,
      });
      setOrderLines(result?.order_lines || []);
      try { await store.setKotSentOrderLines(table.id, result?.kot_sent_order_lines || []); }
      catch (snapshotError) { console.error('[POS] voided order KOT snapshot could not be reconciled', snapshotError); setRemoveError('Item was voided. The void ticket will still print, but reconnect before sending more items.'); }
      const voidRow = result?.void;
      const settings = await getPropertySettings(propertyId).catch(() => null);
      if (settings?.print_void_slips !== false && voidRow) {
        const [printers, assignments] = await Promise.all([getPrinters(propertyId), getAssignments(propertyId)]);
        const assignmentType = voidRow.category === 'drinks' ? 'void_drinks_orders' : 'void_food_orders';
        const fallbackType = voidRow.category === 'drinks' ? 'drinks_orders' : 'food_orders';
        const targets = assignments
          .filter(a => a.assignment_type === assignmentType || a.assignment_type === fallbackType)
          .map(a => printers.find(p => p.id === a.printer_id))
          .filter(Boolean)
          .filter((p,i,arr) => arr.findIndex(x => x.id === p.id) === i);
        if (targets.length) {
          const results = await Promise.all(targets.map(printer => printVoidTicket(printer, {
            propertyId,
            voidId: voidRow.id,
            tableNo: tableLabel(table),
            waiterName: store.getSession(table.id)?.waiter || '',
            checkNo: orderNumber,
            item: voidRow.item_name,
            removedQty: voidRow.removed_qty,
            originalQty: voidRow.original_qty,
            newQty: voidRow.new_qty,
            reason: voidRow.reason,
            removedBy: voidRow.removed_by_name || staffName,
            timestamp: voidRow.created_at,
            category: voidRow.category,
          })));
          if (!results.some(r => r.ok)) setRemoveError('Item voided, but the void slip did not print. Check the assigned printer.');
        } else {
          setRemoveError('Item voided, but no Kitchen/Bar void printer is assigned.');
        }
      }
      setRemoveTarget(null);
    } catch (error) {
      setRemoveError(error.message || 'Could not remove the item.');
    } finally {
      setRemoveBusy(false);
    }
  };

  const requestRemoval = () => {
    if (removeTarget?.sent && needsManagerPin) {
      setPinError('');
      setPinStaff({ name: 'Manager approval required' });
      return;
    }
    performRemoval();
  };

  const handleManagerPin = async (pin) => {
    try {
      const result = await authService.verifyStaffPin({ propertyId, module: 'pos', pin });
      const role = String(result?.staff?.role || '').toLowerCase();
      if (!result?.ok || !managerRoles.has(role)) {
        setPinError('Manager, cashier or administrator PIN required.');
        return;
      }
      setPinStaff(null);
      await performRemoval();
    } catch (error) {
      setPinError(error.message || 'PIN verification failed.');
    }
  };

  const subtotal = orderLines.reduce((s, l) => s + l.price * l.qty, 0);
  const vat = Math.round(subtotal * VAT_RATE);
  const total = subtotal + vat;
  const orderNumber = orderNumberProp || `ORD-${String(table.number).padStart(3, '0')}-${Math.floor(Date.now() / 10000) % 1000}`;

  // Order-routing warning: any production center in this order lacking a connected order printer.
  const orderCenters = [...new Set(orderLines.map((l) => l.center).filter(Boolean))];
  const missingCenters = assignedOrderCenters === null || assignedOrderDepartments === null ? [] : orderCenters
    .filter(center => {
      const key = String(center).trim().toLowerCase();
      if (assignedOrderDepartments.length) return !assignedOrderDepartments.includes(key);
      return !assignedOrderCenters.includes(/bar|drink/i.test(key) ? 'bar' : 'kitchen');
    });
  const demoMenuItems = Object.entries(MENU_ITEMS).flatMap(([category, items]) => items.map((item) => ({
    ...item, category, center: CATEGORY_CENTER[category] || 'Kitchen', stock: null, minimumStock: 0
  })));
  const allMenuItems = propertyId ? menuItems : demoMenuItems;
  const categoryMenuItems = activeCategory ? allMenuItems.filter((item) => item.category === activeCategory) : allMenuItems;
  const visibleMenuItems = filterPosMenuItems(categoryMenuItems, menuSearch);
  const categoryCounts = allMenuItems.reduce((counts, item) => {
    counts[item.category] = (counts[item.category] || 0) + 1;
    return counts;
  }, {});
  const categoryTileStyles = [
    'border-[var(--primary)] bg-[var(--primary-soft)]',
    'border-[var(--accent)] bg-[var(--warning-soft)]',
    'border-[var(--info)] bg-[var(--info-soft)]',
    'border-[var(--success)] bg-[var(--success-soft)]',
    'border-[var(--border)] bg-[var(--sidebar)]',
    'border-[var(--room-occupied)] bg-[var(--primary-soft)]'
  ];

  return (
    <div className="pos-shell flex h-full min-h-0 flex-col overflow-hidden bg-[var(--canvas)] lg:flex-row">
      <main className="order-1 flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-3 lg:order-none lg:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {activeCategory && (
              <button
                type="button"
                onClick={() => { setActiveCategory(null); setMenuSearch(''); }}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] transition-colors hover:bg-[var(--primary-soft)]"
                aria-label="Back to menu categories"
              >
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
            )}
            <div className="min-w-0">
              <div className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Order menu</div>
              <h2 className="truncate text-xl font-extrabold text-[var(--text)]">{activeCategory || 'Browse categories'}</h2>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {activeCategory ? `${categoryCounts[activeCategory] || 0} items in this category` : `${menuCategories.length} categories · ${allMenuItems.length} menu items`}
              </p>
            </div>
          </div>
          <div className="text-xs font-semibold text-[var(--text-muted)]">Table {tableLabel(table)} · Tap a tile to add</div>
        </div>

        {missingCenters.length > 0 && (
          <div className="mb-3">
            <PrintWarn message={`No order printer set for ${missingCenters.join(', ')} — configure in Settings`} />
          </div>
        )}

        <div className="relative mb-4">
          <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <label htmlFor="pos-menu-search" className="sr-only">Search menu items and categories</label>
          <input
            id="pos-menu-search"
            type="search"
            value={menuSearch}
            onChange={(event) => setMenuSearch(event.target.value)}
            placeholder={activeCategory ? `Search ${activeCategory.toLowerCase()} items` : 'Search all menu items or categories'}
            autoComplete="off"
            className="h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] pl-10 pr-3 text-base text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
          />
        </div>

        {menuLoading ? (
          <div role="status" aria-live="polite" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm font-semibold text-[var(--text-muted)]">Loading menu items…</div>
        ) : menuError ? (
          <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-6 text-center">
            <p className="text-sm font-semibold text-[var(--danger-text)]">{menuError}</p>
            <button type="button" onClick={loadPosMenu} className="min-h-11 rounded-lg bg-[var(--primary)] px-4 text-sm font-bold text-[var(--on-primary)] hover:bg-[var(--primary-hover)]">Retry menu</button>
          </div>
        ) : !activeCategory && !menuSearch.trim() ? (
          <section aria-label="Menu categories" className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-1.5">
            {menuCategories.map((cat, index) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                style={{ backgroundColor: menuCategoryStyles[cat]?.tile_color || undefined, color: menuCategoryStyles[cat]?.tile_text_color || undefined, borderColor: menuCategoryStyles[cat]?.tile_color || undefined, ...(menuCategoryStyles[cat]?.tile_image_url ? { backgroundImage: `linear-gradient(var(--overlay-scrim),var(--overlay-scrim)),url("${menuCategoryStyles[cat].tile_image_url}")`, backgroundSize: "cover", backgroundPosition: "center" } : {}) }}
                className={`group relative flex aspect-square min-w-0 flex-col justify-end overflow-hidden rounded-xl border-2 p-2 text-center shadow-sm transition-all hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 ${categoryTileStyles[index % categoryTileStyles.length]}`}
                aria-label={`Open ${cat}, ${categoryCounts[cat] || 0} products`}
              >
                <Folder size={16} className="absolute right-2 top-2" aria-hidden="true" />
                <div className="line-clamp-2 break-words text-xs font-extrabold leading-tight sm:text-sm">{cat}</div>
                <div className="mt-1 text-[9px] font-semibold opacity-80">{categoryCounts[cat] || 0} items</div>
              </button>
            ))}
            {menuCategories.length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--text-muted)]">No menu categories are configured yet.</div>
            )}
          </section>
        ) : visibleMenuItems.length === 0 ? (
          <div role="status" aria-live="polite" className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--text-muted)]">
            {menuSearch.trim() ? `No menu items match “${menuSearch.trim()}”.` : `No POS items are available in ${activeCategory}.`}
          </div>
        ) : (
          <section aria-label={activeCategory ? `${activeCategory} products` : 'Menu search results'}>
            {!activeCategory && menuSearch.trim() && (
              <div className="mb-3 text-xs font-semibold text-[var(--text-muted)]">{visibleMenuItems.length} matching products across all categories</div>
            )}
            <div id="pos-product-grid" className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-1.5">
              {visibleMenuItems.map((item) => {
                const inOrderQty = orderLines.reduce((qty, line) => qty + ((line.baseProductId || line.productId || line.id) === (item.productId || item.id) ? Number(line.qty || 0) : 0), 0);
                const stockStatus = propertyId && menuItems.length > 0 ? getPosStockStatus(item.stock, item.minimumStock) : 'unknown';
                const outOfStock = stockStatus === 'out-of-stock';
                const lowStock = stockStatus === 'low-stock';
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => addItem(item)}
                    disabled={outOfStock || modifierLoading}
                    aria-label={`${item.name}, ${outOfStock ? 'out of stock' : lowStock ? 'low stock' : fmt(item.price)}`}
                    style={{ backgroundColor: item.tile_color || undefined, color: item.tile_text_color || undefined, borderColor: item.tile_color || undefined, ...(item.tile_image_url ? { backgroundImage: `linear-gradient(var(--overlay-scrim),var(--overlay-scrim)),url("${item.tile_image_url}")`, backgroundSize: "cover", backgroundPosition: "center" } : {}) }}
                    className={`relative flex aspect-square min-w-0 flex-col justify-between overflow-hidden rounded-xl border-2 p-2 text-left transition-all active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 ${outOfStock ? 'cursor-not-allowed border-[var(--danger)] bg-[var(--danger-soft)] opacity-75' : inOrderQty > 0 ? 'border-[var(--primary)] bg-[var(--primary-soft)] shadow-sm' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]'}`}
                  >
                    <div className="flex w-full items-start justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{item.category}</span>
                      {inOrderQty > 0 && (
                        <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-[var(--primary)] px-1.5 text-xs font-extrabold text-[var(--on-primary)]">{inOrderQty}</span>
                      )}
                    </div>
                    <div className="my-2 w-full break-words text-center text-[11px] font-bold leading-tight sm:text-xs">{item.name}{item.sku && <span className="mt-1 block text-[9px] font-semibold tracking-wide opacity-80">SKU {item.sku}</span>}</div>
                    <div className="flex w-full items-end justify-between gap-2">
                      <span className="text-sm font-extrabold text-[var(--primary)]">{fmt(item.price)}</span>
                      {stockStatus !== 'unknown' && (
                        <span className={`text-[10px] font-bold ${outOfStock ? 'text-[var(--danger-text)]' : lowStock ? 'text-[var(--warning-text)]' : 'text-[var(--text-muted)]'}`}>
                          {outOfStock ? 'OUT OF STOCK' : lowStock ? `LOW · ${item.stock} ${item.unit}` : `${item.stock} ${item.unit}`}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </main>

      <aside className={`pos-ticket order-3 flex shrink-0 flex-col border-t border-[var(--border)] bg-[var(--surface)] text-[var(--text)] transition-[height] duration-200 lg:order-none lg:h-full lg:max-h-none lg:w-[22rem] lg:border-l lg:border-t-0 ${orderPanelExpanded ? 'h-[58vh] min-h-[19rem] max-h-[72vh]' : 'h-[4.75rem] min-h-[4.75rem] max-h-[4.75rem] lg:h-full'}`}>
        <button
          type="button"
          onClick={() => setOrderPanelExpanded((expanded) => !expanded)}
          aria-expanded={orderPanelExpanded}
          aria-controls="pos-order-panel-content"
          className="flex min-h-[4.75rem] w-full items-center justify-between gap-3 px-4 text-left lg:hidden"
        >
          <span className="min-w-0">
            <span className="block text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Current order · {tableLabel(table)}</span>
            <span className="mt-1 block truncate text-sm font-extrabold text-[var(--text)]">{orderLines.length} items · {fmt(total)}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-xs font-bold text-[var(--on-primary)]">
            {orderPanelExpanded ? 'Hide order' : 'View order'}
            <ChevronLeft className={`h-4 w-4 transition-transform ${orderPanelExpanded ? '-rotate-90' : 'rotate-90'}`} aria-hidden="true" />
          </span>
        </button>
        <div id="pos-order-panel-content" className={orderPanelExpanded ? 'flex min-h-0 flex-1 flex-col' : 'hidden lg:flex lg:min-h-0 lg:flex-1 lg:flex-col'}>
        <div className="border-b border-dashed border-[var(--border)] px-4 py-3">
          <div className="text-center text-xs font-bold uppercase tracking-widest text-[var(--primary)]">Visiwa Beach Resort</div>
          <div className="mt-1 text-center text-xs text-[var(--text-muted)]">{orderNumber}</div>
          <div className="mt-2 flex justify-center gap-4 text-xs text-[var(--text-muted)]">
            <span>Table <b className="text-[var(--text)]">{tableLabel(table)}</b></span>
            <span>Covers <b className="text-[var(--text)]">{table.seats}</b></span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {orderLines.length === 0 ? (
            <div className="mt-8 text-center text-sm text-[var(--text-muted)]">Tap menu items<br />to add to ticket</div>
          ) : (
            orderLines.map((line) => (
              <div key={line.id} className="flex items-center gap-2 border-b border-[var(--border)] py-2">
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" aria-label={`Decrease ${line.name}`} onClick={() => changeQty(line.id, -1)} className="flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--sidebar)] text-lg font-bold text-[var(--text)] hover:bg-[var(--primary-soft)]">−</button>
                  <span className="w-7 text-center text-sm font-bold text-[var(--text)]">{line.qty}</span>
                  <button type="button" aria-label={`Increase ${line.name}`} onClick={() => changeQty(line.id, 1)} className="flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--primary)] bg-[var(--primary-soft)] text-lg font-bold text-[var(--primary)]">+</button>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold leading-tight text-[var(--text)]">{line.name}</div>
                  {line.modifiers?.length > 0 && <div className="mt-0.5 text-xs leading-tight text-[var(--primary)]">{line.modifiers.map((m) => m.name).join(' · ')}</div>}
                  {line.center && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{line.center}</div>}
                </div>
                <div className="shrink-0 text-sm font-bold text-[var(--text)]">{(line.price * line.qty).toLocaleString()}</div>
              </div>
            ))
          )}
        </div>

        {orderLines.length > 0 && (
          <div className="border-t border-dashed border-[var(--border)] px-4 py-3">
            <div className="mb-1 flex justify-between text-sm text-[var(--text-muted)]">
              <span>Subtotal</span><span className="font-mono">{subtotal.toLocaleString()}</span>
            </div>
            <div className="mb-2 flex justify-between text-sm text-[var(--text-muted)]">
              <span>VAT 16%</span><span className="font-mono">{vat.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-base font-bold text-[var(--text)]">
              <span>TOTAL KES</span><span className="font-mono">{total.toLocaleString()}</span>
            </div>
          </div>
        )}

        <div className="flex shrink-0 flex-col gap-2 px-3 pb-3">
          <button
            type="button"
            onClick={onSendToKitchen}
            disabled={orderLines.length === 0}
            className={`min-h-12 w-full rounded-xl px-3 text-sm font-bold transition-colors ${orderLines.length > 0 ? 'bg-[var(--primary)] text-[var(--on-primary)] hover:bg-[var(--primary-hover)]' : 'cursor-not-allowed bg-[var(--sidebar)] text-[var(--text-muted)]'}`}
          >
            Send &amp; Print Ticket
          </button>
          <button
            type="button"
            onClick={onBill}
            disabled={orderLines.length === 0}
            className={`min-h-12 w-full rounded-xl border-2 px-3 text-sm font-bold transition-colors ${orderLines.length > 0 ? 'border-[var(--primary)] bg-[var(--surface)] text-[var(--primary)] hover:bg-[var(--primary-soft)]' : 'cursor-not-allowed border-[var(--border)] bg-[var(--sidebar)] text-[var(--text-muted)]'}`}
          >
            Request Bill →
          </button>
          <button
            type="button"
            onClick={onMoveTable}
            disabled={!onMoveTable || orderLines.length === 0}
            className={`min-h-12 w-full rounded-xl border-2 px-3 text-sm font-bold transition-colors ${onMoveTable && orderLines.length > 0 ? 'border-[var(--border)] bg-[var(--surface)] text-[var(--primary)] hover:bg-[var(--primary-soft)]' : 'cursor-not-allowed border-[var(--border)] bg-[var(--sidebar)] text-[var(--text-muted)]'}`}
          >
            Move / Join Table
          </button>
        </div>
        </div>
      </aside>

      {modifierTarget && (
        <div className="fixed inset-0 z-[240] flex items-center justify-center bg-[var(--overlay-scrim)] p-4">
          <div className="overlay-surface max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex items-start justify-between gap-3">
              <div><div className="text-lg font-bold text-[var(--text)]">Customize {modifierTarget.name}</div><p className="mt-1 text-sm text-[var(--text-muted)]">Choose the available options before adding it to the order.</p></div>
              <button type="button" aria-label="Close customization" onClick={() => setModifierTarget(null)} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--primary-soft)]"><X size={18}/></button>
            </div>
            <div className="mt-4 space-y-4">
              {modifierGroups.map((group) => {
                const selected = modifierSelections[group.id] || [];
                return <div key={group.id} className="rounded-2xl border border-[var(--border)] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3"><div><div className="font-bold text-[var(--text)]">{group.name}</div><div className="text-xs text-[var(--text-muted)]">{group.selection_type === 'multiple' ? 'Choose up to ' + group.max_selections : 'Choose one'}{group.required ? ' · Required' : ' · Optional'}</div></div><span className="shrink-0 text-xs font-semibold text-[var(--text-muted)]">{selected.length} selected</span></div>
                  <div className="grid gap-2 sm:grid-cols-2">{group.options.map((option) => <button type="button" key={option.id} onClick={() => toggleModifier(group, option)} className={`flex min-h-12 items-center justify-between gap-3 rounded-xl border-2 p-3 text-left ${selected.includes(option.id) ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--primary)]'}`}><span className="text-sm font-semibold text-[var(--text)]">{option.name}</span><span className="shrink-0 text-xs font-semibold text-[var(--text-muted)]">{Number(option.price_delta_minor||0)>0?'+KES '+Number(Number(option.price_delta_minor)/100).toLocaleString('en-KE',{minimumFractionDigits:2}):'Included'}</span></button>)}</div>
                </div>;
              })}
            </div>
            <div className="mt-5 flex flex-col-reverse justify-end gap-2 sm:flex-row"><button type="button" onClick={() => setModifierTarget(null)} className="min-h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-bold text-[var(--text)] hover:bg-[var(--primary-soft)]">Cancel</button><button type="button" disabled={modifierLoading} onClick={confirmModifiers} className="min-h-12 rounded-xl bg-[var(--primary)] px-5 text-sm font-bold text-[var(--on-primary)] hover:bg-[var(--primary-hover)]">Add to Order</button></div>
          </div>
        </div>
      )}
      {removeTarget && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-[var(--overlay-scrim)] p-4">
          <div className="overlay-surface w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex items-start justify-between gap-3">
              <div><div className="flex items-center gap-2 text-base font-bold text-[var(--text)]"><AlertTriangle size={18} className="text-[var(--danger)]"/>{removeTarget.sent ? 'Void sent item' : 'Remove item'}</div><p className="mt-1 text-sm text-[var(--text-muted)]">{removeTarget.sent ? 'This item was already sent to production or the bill was printed. A control void will be recorded.' : 'The quantity you are removing has not been sent to production. Confirm how many units to remove from the open order.'}</p></div>
              <button type="button" aria-label="Close cancellation dialog" onClick={()=>setRemoveTarget(null)} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--primary-soft)]"><X size={18}/></button>
            </div>
            <div className="mt-4 rounded-2xl border border-[var(--danger)] bg-[var(--danger-soft)] p-4">
              <div className="font-bold text-[var(--text)]">{removeTarget.line.name}</div>
              <div className="mt-1 text-sm text-[var(--text-muted)]">On order: {removeTarget.line.qty} · Already sent: {removeTarget.sentQty || 0} · {removeTarget.sent ? 'Voiding' : 'Removing'}: {removeTarget.removeQty || 0} · Remaining: {Math.max(0, Number(removeTarget.line.qty)-Number(removeTarget.removeQty || 0))}</div>
              {!removeTarget.sent && Number(removeTarget.sentQty || 0) > 0 && <div className="mt-1 text-xs font-semibold text-[var(--text-muted)]">The sent quantity is protected and will require a separate manager-approved void.</div>}
            </div>
            <label className="mt-4 block text-sm font-semibold text-[var(--text)]">Quantity to {removeTarget.sent ? 'void' : 'remove'}
              <input type="number" inputMode="decimal" min="0.01" max={removeTarget.sent ? removeTarget.sentQty : removeTarget.unsentQty} step="any" value={removeTarget.removeQty} onChange={e=>setRemoveTarget(prev=>({...prev,removeQty:e.target.value === '' ? '' : Number(e.target.value)}))} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--text)] outline-none focus:border-[var(--danger)]"/>
            </label>
            {removeTarget.sent && <label className="mt-4 block text-sm font-semibold text-[var(--text)]">Reason required
              <textarea value={removeReason} onChange={e=>setRemoveReason(e.target.value)} rows={3} placeholder="Wrong order, guest cancellation, duplicate item…" className="mt-2 w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-base text-[var(--text)] outline-none focus:border-[var(--danger)]"/>
            </label>}
            {removeError && <div role="alert" className="mt-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm font-semibold text-[var(--danger-text)]">{removeError}</div>}
            {removeTarget.sent && <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]"><ShieldCheck size={15}/>Kitchen/Bar control slip will be printed when enabled.</div>}
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={()=>setRemoveTarget(null)} className="min-h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-bold text-[var(--text)] hover:bg-[var(--primary-soft)]">Keep Item</button><button type="button" disabled={removeBusy || !Number.isFinite(Number(removeTarget.removeQty)) || Number(removeTarget.removeQty) <= 0 || Number(removeTarget.removeQty) > Number(removeTarget.sent ? removeTarget.sentQty : removeTarget.unsentQty) || (removeTarget.sent && !removeReason.trim())} onClick={requestRemoval} className="min-h-12 rounded-xl bg-[var(--danger)] px-4 text-sm font-bold text-[var(--danger-foreground)] disabled:opacity-50">{removeBusy ? (removeTarget.sent ? 'Voiding…' : 'Removing…') : removeTarget.sent ? (needsManagerPin ? 'Request Manager PIN' : 'Confirm Void') : 'Confirm Remove'}</button></div>
          </div>
        </div>
      )}
      {pinStaff && <PinPad title="Manager PIN Required" staffName={pinStaff.name} error={pinError} onSubmit={handleManagerPin} onClose={()=>setPinStaff(null)} />}
    </div>
  );
}
