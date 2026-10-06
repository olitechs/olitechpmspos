import React, { useEffect, useState } from 'react';
import { AlertTriangle, X, ShieldCheck } from 'lucide-react';
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
import { NAVY, NAVY2, TEAL, TEAL_DARK, TEAL_LIGHT, SAND, SURFACE, BORDER, BORDER_DARK, MUTED, MUTED_DARK } from '@/data/themePalette';

function fmt(n) {
  return `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 0 })}`;
}

export default function OrderTaking({ table, orderLines, setOrderLines, onSendToKitchen, onBill, onMoveTable, orderNumber: orderNumberProp }) {
  const store = useStore();
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const activeStaff = (() => { try { return JSON.parse(sessionStorage.getItem('olitech_active_staff_v2') || 'null'); } catch { return null; } })();
  const currentRole = String(activeStaff?.role || user?.staff?.role || user?.propertyRole || user?.role || '').toLowerCase();
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0]);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removeReason, setRemoveReason] = useState('');
  const [removeError, setRemoveError] = useState('');
  const [removeBusy, setRemoveBusy] = useState(false);
  const [pinStaff, setPinStaff] = useState(null);
  const [pinError, setPinError] = useState('');
  const [menuItems, setMenuItems] = useState([]);
  const [menuCategories, setMenuCategories] = useState(CATEGORIES);
  const [modifierTarget, setModifierTarget] = useState(null);
  const [modifierGroups, setModifierGroups] = useState([]);
  const [modifierSelections, setModifierSelections] = useState({});
  const [modifierLoading, setModifierLoading] = useState(false);

  const loadPosMenu = async () => {
    if (!propertyId) return;
    try {
      const rows = await inventoryService.listPosMenu(propertyId);
      if (rows.length) {
        setMenuItems(rows.map((p) => ({ ...p, id: p.id, productId: p.id, name: p.name, price: Number(p.selling_price || 0), category: p.category || 'General', center: p.production_center || 'Kitchen', stock: Number(p.current_stock ?? 0), unit: p.unit || 'pcs' })));
        setMenuCategories([...new Set(rows.map((p) => p.category || 'General'))]);
      } else {
        setMenuItems([]); setMenuCategories(CATEGORIES);
      }
    } catch (error) {
      console.warn('[POS] menu catalogue unavailable; using built-in menu', error);
      setMenuItems([]); setMenuCategories(CATEGORIES);
    }
  };
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
    const invalid = modifierGroups.find((group) => group.required && (modifierSelections[group.id] || []).length < Number(group.min_selections || 1));
    if (invalid) return;
    commitItem(modifierTarget, selected);
    setModifierTarget(null);
    setModifierGroups([]);
    setModifierSelections({});
  };

  const changeQty = (id, delta) => {
    if (delta < 0) {
      const line = orderLines.find((l) => l.id === id);
      const session = store.getSession(table.id);
      const sent = Boolean(session?.kotSentAt || session?.status === 'unsettled');
      if (line && sent) {
        setRemoveTarget({ line, removeQty: 1, sent });
        setRemoveReason('');
        setRemoveError('');
        return;
      }
    }
    setOrderLines((prev) =>
      prev
        .map((l) => (l.id === id ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0)
    );
  };

  const managerRoles = new Set(['hotel_admin','super_admin','cashier','fb_manager','front_office_manager','property_manager','general_manager','manager','admin','owner']);
  const needsManagerPin = !(user?.isPlatformOwner || managerRoles.has(currentRole));

  const performRemoval = async () => {
    if (!removeTarget || !propertyId) return;
    if (!removeReason.trim()) { setRemoveError('Enter a reason for the item cancellation.'); return; }
    setRemoveBusy(true); setRemoveError('');
    try {
      const staffName = activeStaff?.full_name || user?.name || 'POS Staff';
      const result = await pmsService.removeOrderItem({
        propertyId,
        tableKey: table.id,
        itemId: removeTarget.line.id,
        removeQty: removeTarget.removeQty,
        reason: removeReason.trim(),
        removedByName: staffName,
      });
      setOrderLines(result?.order_lines || []);
      const voidRow = result?.void;
      const settings = await getPropertySettings(propertyId).catch(() => null);
      if (removeTarget.sent && settings?.print_void_slips !== false && voidRow) {
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
          if (!results.some(r => r.ok)) setRemoveError('Item removed, but the void slip did not print. Check the assigned printer.');
        } else {
          setRemoveError('Item removed, but no Kitchen/Bar void printer is assigned.');
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
    if (needsManagerPin) {
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
  const missingCenters = orderCenters.filter((c) => !store.orderPrinterForCenter(c));

  return (
    <div className="flex h-full overflow-hidden" style={{ background: SAND }}>
      {/* Category sidebar */}
      <div className="shrink-0 flex flex-col gap-1 py-3 px-2 overflow-y-auto" style={{ width: '130px', background: NAVY, borderRight: `1px solid ${BORDER_DARK}` }}>
        {menuCategories.map((cat) => (
          <button
            key={cat} onClick={() => setActiveCategory(cat)}
            className="w-full py-3 px-2 rounded-lg text-sm font-semibold text-center"
            style={{
              background: activeCategory === cat ? TEAL : 'transparent',
              color: activeCategory === cat ? '#fff' : MUTED_DARK,
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Menu grid */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="text-xs font-bold uppercase tracking-widest mb-3 px-1" style={{ color: MUTED }}>{activeCategory}</div>
        {missingCenters.length > 0 && (
          <div className="mb-3">
            <PrintWarn message={`No order printer set for ${missingCenters.join(', ')} — configure in Settings`} />
          </div>
        )}
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
          {(menuItems.length ? menuItems.filter((item) => item.category === activeCategory) : (MENU_ITEMS[activeCategory] || []).map((item) => ({ ...item, category: activeCategory, center: CATEGORY_CENTER[activeCategory] || 'Kitchen', stock: null }))).map((item) => {
            const inOrder = orderLines.find((l) => l.id === item.id);
            return (
              <button
                key={item.id} onClick={() => addItem(item)} disabled={menuItems.length > 0 && Number(item.stock) <= 0}
                className="rounded-xl p-3 text-left transition-all active:scale-95 relative"
                style={{
                  background: inOrder ? NAVY : SURFACE,
                  border: `2px solid ${inOrder ? TEAL_DARK : BORDER}`,
                  minHeight: '80px',
                  opacity: menuItems.length > 0 && Number(item.stock) <= 0 ? 0.5 : 1,
                }}
              >
                {inOrder && (
                  <span className="absolute top-2 right-2 w-5 h-5 rounded-full text-xs font-bold font-mono flex items-center justify-center" style={{ background: TEAL_LIGHT, color: NAVY }}>
                    {inOrder.qty}
                  </span>
                )}
                <div className="text-sm font-semibold leading-tight" style={{ color: inOrder ? MUTED_DARK : NAVY }}>{item.name}</div>
                <div className="mt-1 text-sm font-mono font-bold" style={{ color: inOrder ? TEAL_LIGHT : MUTED }}>{fmt(item.price)}</div>{menuItems.length > 0 && <div className="mt-1 text-[10px] font-bold" style={{ color: Number(item.stock) <= 0 ? '#EF4444' : MUTED }}>{Number(item.stock) <= 0 ? 'OUT OF STOCK' : `Stock ${item.stock} ${item.unit}`}</div>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Kitchen ticket */}
      <div className="shrink-0 flex flex-col" style={{ width: '260px', background: NAVY, borderLeft: `1px solid ${BORDER_DARK}`, fontFamily: '"Courier New", Courier, monospace' }}>
        <div className="px-4 py-3 text-center" style={{ borderBottom: `1px dashed ${BORDER_DARK}` }}>
          <div className="text-xs uppercase tracking-widest mb-1" style={{ color: TEAL_LIGHT }}>Visiwa Beach Resort</div>
          <div className="text-xs" style={{ color: MUTED_DARK }}>{orderNumber}</div>
          <div className="flex justify-center gap-4 mt-2 text-xs" style={{ color: MUTED_DARK }}>
            <span>Table <b className="text-white">{tableLabel(table)}</b></span>
            <span>Covers <b className="text-white">{table.seats}</b></span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {orderLines.length === 0 ? (
            <div className="text-center mt-8 text-xs" style={{ color: MUTED_DARK }}>Tap menu items<br />to add to ticket</div>
          ) : (
            orderLines.map((line) => (
              <div key={line.id} className="flex items-center gap-1 py-1.5" style={{ borderBottom: `1px solid ${BORDER_DARK}` }}>
                <div className="flex items-center gap-0.5">
                  <button onClick={() => changeQty(line.id, -1)} className="w-6 h-6 rounded text-xs font-bold flex items-center justify-center" style={{ background: NAVY2, color: MUTED_DARK }}>−</button>
                  <span className="w-5 text-center text-xs font-bold font-mono text-white">{line.qty}</span>
                  <button onClick={() => changeQty(line.id, 1)} className="w-6 h-6 rounded text-xs font-bold flex items-center justify-center" style={{ background: NAVY2, color: TEAL_LIGHT }}>+</button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs leading-tight truncate" style={{ color: '#D8E2EC' }}>{line.name}</div>
                  {line.center && <div className="text-xs" style={{ color: MUTED_DARK, fontSize: '10px' }}>{line.center}</div>}
                </div>
                <div className="text-xs font-mono shrink-0" style={{ color: TEAL_LIGHT }}>{(line.price * line.qty).toLocaleString()}</div>
              </div>
            ))
          )}
        </div>

        {orderLines.length > 0 && (
          <div className="px-4 py-3" style={{ borderTop: `1px dashed ${BORDER_DARK}` }}>
            <div className="flex justify-between text-xs mb-1" style={{ color: MUTED_DARK }}>
              <span>Subtotal</span><span className="font-mono">{subtotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-xs mb-2" style={{ color: MUTED_DARK }}>
              <span>VAT 16%</span><span className="font-mono">{vat.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm font-bold mb-3 text-white">
              <span>TOTAL KES</span><span className="font-mono">{total.toLocaleString()}</span>
            </div>
          </div>
        )}

        <div className="px-3 pb-3 flex flex-col gap-2">
          <button
            onClick={onSendToKitchen} disabled={orderLines.length === 0}
            className="w-full py-3 rounded-xl text-sm font-bold transition-all active:scale-95"
            style={{ background: orderLines.length > 0 ? TEAL : NAVY2, color: orderLines.length > 0 ? '#fff' : MUTED_DARK, cursor: orderLines.length > 0 ? 'pointer' : 'not-allowed' }}
          >
            Send & Print Ticket
          </button>
          <button
            onClick={onBill} disabled={orderLines.length === 0}
            className="w-full py-2.5 rounded-xl text-xs font-semibold transition-all"
            style={{ background: 'transparent', color: orderLines.length > 0 ? TEAL_LIGHT : MUTED_DARK, border: `1.5px solid ${orderLines.length > 0 ? TEAL_DARK : BORDER_DARK}`, cursor: orderLines.length > 0 ? 'pointer' : 'not-allowed' }}
          >
            Request Bill →
          </button>
          <button
            onClick={onMoveTable}
            disabled={!onMoveTable || orderLines.length === 0}
            className="w-full py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2"
            style={{ background: 'transparent', color: orderLines.length > 0 ? TEAL_LIGHT : MUTED_DARK, border: `1.5px solid ${orderLines.length > 0 ? TEAL_DARK : BORDER_DARK}`, cursor: orderLines.length > 0 ? 'pointer' : 'not-allowed' }}
          >
            Move / Join Table
          </button>
        </div>
      </div>
      {modifierTarget && (
        <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><div className="text-lg font-black text-slate-950">Customize {modifierTarget.name}</div><p className="mt-1 text-xs text-slate-500">Choose the available options before adding it to the order.</p></div>
              <button onClick={() => setModifierTarget(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18}/></button>
            </div>
            <div className="mt-4 space-y-4">
              {modifierGroups.map((group) => {
                const selected = modifierSelections[group.id] || [];
                return <div key={group.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="mb-3 flex items-center justify-between"><div><div className="font-black text-slate-900">{group.name}</div><div className="text-[11px] text-slate-500">{group.selection_type === 'multiple' ? 'Choose up to ' + group.max_selections : 'Choose one'}{group.required ? ' · Required' : ' · Optional'}</div></div><span className="text-xs font-bold text-slate-400">{selected.length} selected</span></div>
                  <div className="grid gap-2 sm:grid-cols-2">{group.options.map((option) => <button key={option.id} onClick={() => toggleModifier(group, option)} className="flex items-center justify-between rounded-xl border-2 p-3 text-left" style={{borderColor:selected.includes(option.id)?TEAL:'#E2E8F0',background:selected.includes(option.id)?'#F0FDFA':'#fff'}}><span className="text-sm font-bold text-slate-800">{option.name}</span><span className="text-xs font-black">{Number(option.price_delta_minor||0)>0?'+KES '+Number(Number(option.price_delta_minor)/100).toLocaleString('en-KE',{minimumFractionDigits:2}):'Included'}</span></button>)}</div>
                </div>
              })}
            </div>
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => setModifierTarget(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold">Cancel</button><button disabled={modifierLoading} onClick={confirmModifiers} className="rounded-xl px-5 py-2.5 text-sm font-black text-white" style={{background:TEAL}}>Add to Order</button></div>
          </div>
        </div>
      )}
      {removeTarget && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><div className="flex items-center gap-2 text-base font-black text-slate-950"><AlertTriangle size={18} className="text-red-600"/>Cancel sent item</div><p className="mt-1 text-xs text-slate-500">This item was already sent to production or the bill was printed. A control void will be recorded.</p></div>
              <button onClick={()=>setRemoveTarget(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18}/></button>
            </div>
            <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 p-4">
              <div className="font-black text-slate-950">{removeTarget.line.name}</div>
              <div className="mt-1 text-xs text-slate-600">Original quantity: {removeTarget.line.qty} · Removing: {removeTarget.removeQty} · Remaining: {Math.max(0, removeTarget.line.qty-removeTarget.removeQty)}</div>
            </div>
            <label className="mt-4 block text-xs font-black uppercase tracking-wider text-slate-500">Reason required
              <textarea value={removeReason} onChange={e=>setRemoveReason(e.target.value)} rows={3} placeholder="Wrong order, guest cancellation, duplicate item…" className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-red-400"/>
            </label>
            {removeError && <div className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{removeError}</div>}
            <div className="mt-4 flex items-center gap-2 text-[11px] font-semibold text-slate-500"><ShieldCheck size={15}/>Kitchen/Bar control slip will be printed when enabled.</div>
            <div className="mt-4 flex justify-end gap-2"><button onClick={()=>setRemoveTarget(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold">Keep Item</button><button disabled={removeBusy} onClick={requestRemoval} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">{removeBusy?'Removing…':needsManagerPin?'Request Manager PIN':'Confirm Void'}</button></div>
          </div>
        </div>
      )}
      {pinStaff && <PinPad title="Manager PIN Required" staffName={pinStaff.name} error={pinError} onSubmit={handleManagerPin} onClose={()=>setPinStaff(null)}/>}
    </div>
  );
}