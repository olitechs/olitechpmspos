import React, { useEffect, useState } from 'react';
import { useStore } from '@/data/AppStore';
import { NAVY, NAVY2, BORDER_DARK, SAND, MUTED_DARK } from '@/data/themePalette';

const STATUS_CONFIG = {
  new: { color: '#FFD100', bg: 'rgba(255,209,0,0.15)', label: 'NEW' },
  preparing: { color: '#8FA0AD', bg: 'rgba(143,160,173,0.15)', label: 'PREPARING' },
  ready: { color: '#D4A93A', bg: 'rgba(212,169,58,0.15)', label: 'READY' },
  served: { color: MUTED_DARK, bg: 'rgba(110,138,134,0.12)', label: 'SERVED' },
};
const NEXT_STATUS = { new: 'preparing', preparing: 'ready', ready: 'served' };

function formatTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
}

export default function KitchenDisplay() {
  const { kitchenOrders, updateKitchenOrderStatus } = useStore();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const orders = Array.isArray(kitchenOrders) ? kitchenOrders : [];

  return (
    <div className="flex-1 overflow-y-auto p-4" style={{ background: NAVY }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-4">
          {['new', 'preparing', 'ready'].map((s) => {
            const st = STATUS_CONFIG[s];
            const count = orders.filter((o) => o.status === s).length;
            return (
              <div key={s} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: st.color }} />
                <span className="text-xs font-bold" style={{ color: st.color }}>{st.label}</span>
                <span className="w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center" style={{ background: st.bg, color: st.color }}>{count}</span>
              </div>
            );
          })}
        </div>
        <div className="text-xs font-mono" style={{ color: MUTED_DARK }}>
          {new Date(now).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      {orders.length === 0 && (
        <div className="rounded-2xl border p-8 text-center" style={{ borderColor: BORDER_DARK, background: NAVY2 }}>
          <div className="text-sm font-bold text-white">No active kitchen orders</div>
          <div className="text-xs mt-1" style={{ color: MUTED_DARK }}>
            Orders fired from POS will appear here after the persistent KDS migration is applied.
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {orders.filter((o) => o && o.status !== 'served').map((order) => {
          const st = STATUS_CONFIG[order.status] || STATUS_CONFIG.new;
          const areas = [...new Set((order.orderLines || []).map((item) => item.center).filter(Boolean))];
          const ageMinutes = order.firedAt ? Math.max(0, Math.floor((now - order.firedAt) / 60000)) : 0;
          return (
            <div key={order.id} className="rounded-2xl overflow-hidden flex flex-col" style={{ background: NAVY2, border: `2px solid ${st.color}`, fontFamily: '"Courier New", Courier, monospace' }}>
              <div className="px-4 py-3" style={{ background: st.bg, borderBottom: `1px dashed ${st.color}55` }}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-white">{order.orderNumber || order.id}</div>
                    <div className="text-xs" style={{ color: MUTED_DARK }}>
                      {areas.join(' · ') || 'Kitchen'} · <span className="font-bold text-white">Table {order.tableNumber || '—'}</span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: st.bg, color: st.color, border: `1px solid ${st.color}` }}>{st.label}</span>
                </div>
                <div className="flex justify-between text-xs mt-1" style={{ color: MUTED_DARK }}>
                  <span>{order.waiter || 'POS'}</span>
                  <span className="font-mono">{formatTime(order.firedAt)} · {ageMinutes}m</span>
                </div>
              </div>

              <div className="flex-1 px-4 py-2">
                {(order.orderLines || []).map((item, i) => (
                  <div key={i} className="flex items-center gap-2 py-1.5" style={{ borderBottom: `1px solid ${BORDER_DARK}` }}>
                    <span className="text-xs font-mono font-bold w-4 text-center" style={{ color: st.color }}>{item.qty}×</span>
                    <span className="flex-1 text-xs" style={{ color: SAND }}>{item.name}</span>
                    {item.center && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: st.bg, color: st.color, fontSize: '10px' }}>{item.center}</span>}
                  </div>
                ))}
              </div>

              {NEXT_STATUS[order.status] && (
                <div className="px-4 pb-3 pt-1">
                  <button
                    onClick={() => updateKitchenOrderStatus(order.id, NEXT_STATUS[order.status])}
                    className="w-full py-2.5 rounded-xl text-xs font-bold"
                    style={{ background: st.color, color: NAVY }}
                  >
                    Mark as {STATUS_CONFIG[NEXT_STATUS[order.status]].label} →
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}