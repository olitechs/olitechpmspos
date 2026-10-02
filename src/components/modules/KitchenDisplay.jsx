import React, { useEffect, useState } from 'react';
import { useStore } from '@/data/AppStore';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';
import { getPrinters, getAssignments, printVoidTicket } from '@/services/printService';
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
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const role = String(user?.staff?.role || user?.propertyRole || user?.role || '').toLowerCase().replace(/\s+/g, '_');
  const canApproveVoid = ['hotel_admin','super_admin','cashier','fb_manager','front_office_manager','manager','admin','owner'].includes(role);
  const [tab, setTab] = useState('orders');
  const [voids, setVoids] = useState([]);
  const [voidFilter, setVoidFilter] = useState('');
  const [signature, setSignature] = useState('');
  const [voidError, setVoidError] = useState('');
  const [voidBusy, setVoidBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);


  useEffect(() => {
    if (!propertyId || tab !== 'voids') return;
    let active = true;
    pmsService.listVoidedItems(propertyId).then(rows => { if (active) setVoids(rows); }).catch(e => { if (active) setVoidError(e.message); });
    return () => { active = false; };
  }, [propertyId, tab]);

  const orders = Array.isArray(kitchenOrders) ? kitchenOrders : [];
  const visibleVoids = voids.filter(v => !voidFilter || [v.table_number,v.item_name,v.reason,v.removed_by_name,v.void_number].some(x => String(x||'').toLowerCase().includes(voidFilter.toLowerCase())));
  const reprintVoid = async (v) => {
    if (!propertyId) return;
    setVoidBusy(true); setVoidError('');
    try {
      const [printers, assignments] = await Promise.all([getPrinters(propertyId), getAssignments(propertyId)]);
      const type = v.category === 'drinks' ? 'void_drinks_orders' : 'void_food_orders';
      const fallback = v.category === 'drinks' ? 'drinks_orders' : 'food_orders';
      const targets = assignments.filter(a => a.assignment_type === type || a.assignment_type === fallback).map(a => printers.find(p => p.id === a.printer_id)).filter(Boolean).filter((p,i,a)=>a.findIndex(x=>x.id===p.id)===i);
      if (!targets.length) throw new Error('No Kitchen/Bar printer is assigned for void slips.');
      const results = await Promise.all(targets.map(printer => printVoidTicket(printer,{propertyId,voidId:v.id,tableNo:v.table_number,waiterName:v.waiter,checkNo:v.check_no||v.order_number,item:v.item_name,removedQty:v.removed_qty,originalQty:v.original_qty,newQty:v.new_qty,reason:v.reason,removedBy:v.removed_by_name,timestamp:v.created_at,category:v.category})));
      if (!results.some(r=>r.ok)) throw new Error('Void reprint failed.');
      setVoids(await pmsService.listVoidedItems(propertyId));
    } catch(e) { setVoidError(e.message||'Void reprint failed.'); } finally { setVoidBusy(false); }
  };
  const approveVoid = async (v) => {
    if (!propertyId || !signature.trim()) { setVoidError('Manager signature is required.'); return; }
    try { await pmsService.approveVoid({propertyId,voidId:v.id,signature:signature.trim()}); setSignature(''); setVoids(await pmsService.listVoidedItems(propertyId)); } catch(e) { setVoidError(e.message); }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4" style={{ background: NAVY }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button onClick={()=>setTab('orders')} className="rounded-xl px-4 py-2 text-xs font-black" style={{background:tab==='orders'?'#FFD100':NAVY2,color:tab==='orders'?NAVY:MUTED_DARK}}>KDS Orders</button>
          <button onClick={()=>setTab('voids')} className="rounded-xl px-4 py-2 text-xs font-black" style={{background:tab==='voids'?'#DC2626':NAVY2,color:tab==='voids'?'#fff':MUTED_DARK}}>Void Controls</button>
          {tab==='voids' && <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-black text-white">{voids.length}</span>}
        </div>
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

      {tab === 'voids' ? (
        <div className="rounded-2xl border border-white/10 bg-[#11161C] p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-sm font-black text-white">Today's Void / Cancellation Controls</div><div className="mt-1 text-xs text-slate-400">Every controlled removal is retained for manager review and printer reprint.</div></div>
            <input value={voidFilter} onChange={e=>setVoidFilter(e.target.value)} placeholder="Filter table, item, reason…" className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white outline-none"/>
          </div>
          {voidError && <div className="mb-3 rounded-xl bg-red-500/10 p-3 text-xs font-bold text-red-300">{voidError}</div>}
          <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs">
            <thead className="border-b border-white/10 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="p-3">Time</th><th className="p-3">Table</th><th className="p-3">Item</th><th className="p-3">Removed</th><th className="p-3">Reason</th><th className="p-3">Removed By</th><th className="p-3">Status</th><th className="p-3">Control</th></tr></thead>
            <tbody>{visibleVoids.map(v=><tr key={v.id} className="border-b border-white/5 text-slate-300">
              <td className="p-3 font-mono">{formatTime(v.created_at)}</td><td className="p-3 font-black text-white">{v.table_number}</td><td className="p-3"><div className="font-bold text-white">{v.item_name}</div><div className="text-[10px] uppercase text-slate-500">{v.category}</div></td><td className="p-3 font-black text-red-300">{v.removed_qty}</td><td className="p-3">{v.reason}</td><td className="p-3">{v.removed_by_name||'—'}</td><td className="p-3"><span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-black uppercase">{v.status === 'printed' ? 'Void Printed' : v.status}</span></td>
              <td className="p-3"><div className="flex flex-wrap gap-2"><button disabled={voidBusy} onClick={()=>reprintVoid(v)} className="rounded-lg bg-white/10 px-2.5 py-1.5 font-bold text-white">Re-print Void</button>{canApproveVoid&&v.status!=='approved'&&<button onClick={()=>approveVoid(v)} className="rounded-lg bg-[#FFD100] px-2.5 py-1.5 font-black text-[#090C11]">Approve</button>}</div></td>
            </tr>)}</tbody>
          </table></div>
          {visibleVoids.length===0&&<div className="py-10 text-center text-xs text-slate-500">No voids found today.</div>}
          {canApproveVoid && <div className="mt-4 flex items-center gap-2 border-t border-white/10 pt-4"><input value={signature} onChange={e=>setSignature(e.target.value)} placeholder="Manager signature / name for approval" className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white outline-none"/><span className="text-[10px] text-slate-500">Signature required before Approve.</span></div>}
        </div>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}