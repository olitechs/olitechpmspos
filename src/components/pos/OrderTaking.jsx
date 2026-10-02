import React, { useState } from 'react';
import { CATEGORIES, MENU_ITEMS, VAT_RATE, tableLabel, CATEGORY_CENTER } from '@/data/mockData';
import { useStore } from '@/data/AppStore';
import PrintWarn from '@/components/pos/PrintWarn';
import { NAVY, NAVY2, TEAL, TEAL_DARK, TEAL_LIGHT, SAND, SURFACE, BORDER, BORDER_DARK, MUTED, MUTED_DARK } from '@/data/themePalette';

function fmt(n) {
  return `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 0 })}`;
}

export default function OrderTaking({ table, orderLines, setOrderLines, onSendToKitchen, onBill, orderNumber: orderNumberProp }) {
  const store = useStore();
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0]);

  const addItem = (item) => {
    setOrderLines((prev) => {
      const existing = prev.find((l) => l.id === item.id);
      if (existing) return prev.map((l) => (l.id === item.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { ...item, qty: 1, category: activeCategory, center: CATEGORY_CENTER[activeCategory] || 'Kitchen' }];
    });
  };

  const changeQty = (id, delta) => {
    setOrderLines((prev) =>
      prev
        .map((l) => (l.id === id ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0)
    );
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
        {CATEGORIES.map((cat) => (
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
          {(MENU_ITEMS[activeCategory] || []).map((item) => {
            const inOrder = orderLines.find((l) => l.id === item.id);
            return (
              <button
                key={item.id} onClick={() => addItem(item)}
                className="rounded-xl p-3 text-left transition-all active:scale-95 relative"
                style={{
                  background: inOrder ? NAVY : SURFACE,
                  border: `2px solid ${inOrder ? TEAL_DARK : BORDER}`,
                  minHeight: '80px',
                }}
              >
                {inOrder && (
                  <span className="absolute top-2 right-2 w-5 h-5 rounded-full text-xs font-bold font-mono flex items-center justify-center" style={{ background: TEAL_LIGHT, color: NAVY }}>
                    {inOrder.qty}
                  </span>
                )}
                <div className="text-sm font-semibold leading-tight" style={{ color: inOrder ? MUTED_DARK : NAVY }}>{item.name}</div>
                <div className="mt-1 text-sm font-mono font-bold" style={{ color: inOrder ? TEAL_LIGHT : MUTED }}>{fmt(item.price)}</div>
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
        </div>
      </div>
    </div>
  );
}