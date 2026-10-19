import React, { useEffect, useState } from 'react';
import { useStore } from '@/data/AppStore';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';
import { posService } from '@/services/posService';
import { printOrderByCategory } from '@/services/printService';
import { printOrder as printRoutedOrder, isPrinterGroupRoutingEnabled } from '@/services/printRoutingService';
import { toast } from 'sonner';
import { getPrinters, getAssignments, printVoidTicket } from '@/services/printService';
import { NAVY, NAVY2, BORDER_DARK, SAND } from '@/data/themePalette';

const STATUS_CONFIG = {
  new: { color: 'var(--primary)', bg: 'var(--primary-soft)', label: 'New' },
  preparing: { color: 'var(--text-muted)', bg: 'var(--sidebar)', label: 'Preparing' },
  ready: { color: 'var(--warning-text)', bg: 'var(--warning-soft)', label: 'Ready' },
  served: { color: 'var(--success-text)', bg: 'var(--success-soft)', label: 'Served' },
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
  const canApproveVoid = user?.isPlatformOwner || ['hotel_admin','super_admin','cashier','fb_manager','front_office_manager','property_manager','general_manager','manager','admin','owner'].includes(role);
  const [tab, setTab] = useState('orders');
  const [voids, setVoids] = useState([]);
  const [voidFilter, setVoidFilter] = useState('');
  const [signature, setSignature] = useState('');
  const [voidError, setVoidError] = useState('');
  const [voidBusy, setVoidBusy] = useState(false);
  const [refireOrder, setRefireOrder] = useState(null);
  const [refireReason, setRefireReason] = useState('');
  const [refireBusy, setRefireBusy] = useState(false);
  const [refireError, setRefireError] = useState('');
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

  const performRefire = async () => {
    if (!propertyId || !refireOrder || !refireReason.trim()) {
      setRefireError('A re-fire reason is required.');
      return;
    }
    setRefireBusy(true); setRefireError('');
    try {
      const saved = await posService.refireKitchenOrder({
        propertyId,
        orderId: refireOrder.id,
        reason: refireReason.trim(),
      });
      let queued = false;
      if (isPrinterGroupRoutingEnabled()) {
        const jobs = await printRoutedOrder({
          propertyId,
          orderId: saved.id,
          id: saved.order_number,
          orderNumber: saved.order_number,
          table: saved.table_number,
          waiter: saved.waiter,
          items: Array.isArray(saved.order_lines) ? saved.order_lines : [],
        });
        if (!jobs.length) throw new Error('No KOT/BOT jobs were queued. Check category mappings and printer assignments.');
        queued = true;
      } else {
        const result = await printOrderByCategory({
          propertyId,
          table: saved.table_number,
          tableNumber: saved.table_number,
          orderNumber: saved.order_number,
          checkNo: saved.order_number,
          waiter: saved.waiter,
          createdAt: new Date().toISOString(),
          items: Array.isArray(saved.order_lines) ? saved.order_lines : [],
        });
        if (!result.ok) throw new Error('Re-fire was authorized and logged, but the kitchen/bar printer did not complete the ticket.');
      }
      setRefireOrder(null);
      setRefireReason('');
      if (queued) toast.success('Re-fire queued for the print agent. Confirm the physical printer completes the ticket.');
    } catch (e) {
      setRefireError(e.message || 'Re-fire failed.');
    } finally {
      setRefireBusy(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4" style={{ background: NAVY }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button onClick={()=>setTab('orders')} className="rounded-xl px-4 py-2 text-xs font-black" style={{background:tab==='orders'?'var(--primary)':NAVY2,color:tab==='orders'?NAVY:MUTED_DARK}}>KDS Orders</button>
          <button onClick={()=>setTab('voids')} className="rounded-xl px-4 py-2 text-xs font-black" style={{background:tab==='voids'?'var(--danger)':NAVY2,color:tab==='voids'?'var(--surface)':MUTED_DARK}}>Void Controls</button>
          {tab==='voids' && <span className="rounded-full bg-surface/10 px-2 py-1 text-[10px] font-black text-foreground">{voids.length}</span>}
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
        <div className="rounded-2xl border border-white/10 bg-[var(--surface)] p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-sm font-black text-foreground">Today's Void / Cancellation Controls</div><div className="mt-1 text-xs text-muted-foreground">Every controlled removal is retained for manager review and printer reprint.</div></div>
            <input value={voidFilter} onChange={e=>setVoidFilter(e.target.value)} placeholder="Filter table, item, reason…" className="rounded-xl border border-white/10 bg-surface/5 px-3 py-2 text-xs text-foreground outline-none"/>
          </div>
          {voidError && <div className="mb-3 rounded-xl bg-red-500/10 p-3 text-xs font-bold text-red-300">{voidError}</div>}
          <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs">
            <thead className="border-b border-white/10 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="p-3">Time</th><th className="p-3">Table</th><th className="p-3">Item</th><th className="p-3">Removed</th><th className="p-3">Reason</th><th className="p-3">Removed By</th><th className="p-3">Status</th><th className="p-3">Control</th></tr></thead>
            <tbody>{visibleVoids.map(v=><tr key={v.id} className="border-b border-white/5 text-muted-foreground">
              <td className="p-3 font-mono">{formatTime(v.created_at)}</td><td className="p-3 font-black text-foreground">{v.table_number}</td><td className="p-3"><div className="font-bold text-foreground">{v.item_name}</div><div className="text-[10px] uppercase text-muted-foreground">{v.category}</div></td><td className="p-3 font-black text-red-300">{v.removed_qty}</td><td className="p-3">{v.reason}</td><td className="p-3">{v.removed_by_name||'—'}</td><td className="p-3"><span className="rounded-full bg-surface/10 px-2 py-1 text-[10px] font-black uppercase">{v.status === 'printed' ? 'Void Printed' : v.status}</span></td>
              <td className="p-3"><div className="flex flex-wrap gap-2"><button disabled={voidBusy} onClick={()=>reprintVoid(v)} className="rounded-lg bg-surface/10 px-2.5 py-1.5 font-bold text-foreground">Re-print Void</button>{canApproveVoid&&v.status!=='approved'&&<button onClick={()=>approveVoid(v)} className="rounded-lg bg-[var(--primary)] px-2.5 py-1.5 font-black text-foreground">Approve</button>}</div></td>
            </tr>)}</tbody>
          </table></div>
          {visibleVoids.length===0&&<div className="py-10 text-center text-xs text-muted-foreground">No voids found today.</div>}
          {canApproveVoid && <div className="mt-4 flex items-center gap-2 border-t border-white/10 pt-4"><input value={signature} onChange={e=>setSignature(e.target.value)} placeholder="Manager signature / name for approval" className="flex-1 rounded-xl border border-white/10 bg-surface/5 px-3 py-2 text-xs text-foreground outline-none"/><span className="text-[10px] text-muted-foreground">Signature required before Approve.</span></div>}
        </div>
      ) : (
        <>
      {orders.length === 0 && (
        <div className="rounded-2xl border p-8 text-center" style={{ borderColor: BORDER_DARK, background: NAVY2 }}>
          <div className="text-sm font-bold text-foreground">No active kitchen orders</div>
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
                    <div className="text-sm font-bold text-foreground">{order.orderNumber || order.id}</div>
                    <div className="text-xs" style={{ color: MUTED_DARK }}>
                      {areas.join(' · ') || 'Kitchen'} · <span className="font-bold text-foreground">Table {order.tableNumber || '—'}</span>
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
                <div className="px-4 pb-3 pt-1 space-y-2">
                  {canApproveVoid && (
                    <button
                      onClick={() => { setRefireOrder(order); setRefireReason(''); setRefireError(''); }}
                      className="w-full py-2 rounded-xl text-xs font-bold border"
                      style={{ borderColor: st.color, color: st.color, background: 'transparent' }}
                    >
                      Re-fire Ticket
                    </button>
                  )}
                  <button
                    onClick={() => updateKitchenOrderStatus(order.id, NEXT_STATUS[order.status]).catch((error) => setVoidError(error?.message || 'Unable to update production status.'))}
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
      {refireOrder && (
        <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[var(--surface)] p-5 shadow-2xl">
            <div className="text-lg font-black text-foreground">Re-fire kitchen ticket</div>
            <p className="mt-1 text-xs text-muted-foreground">
              This creates an audit event and prints the complete ticket again. It does not create a new sale.
            </p>
            {refireError && <div className="mt-3 rounded-xl bg-red-500/10 p-3 text-xs font-bold text-red-300">{refireError}</div>}
            <textarea value={refireReason} onChange={e=>setRefireReason(e.target.value)} placeholder="Reason, e.g. printer jam or ticket lost" className="mt-4 min-h-24 w-full rounded-xl border border-white/10 bg-surface/5 p-3 text-xs text-foreground outline-none" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={()=>setRefireOrder(null)} disabled={refireBusy} className="rounded-xl bg-surface/10 px-4 py-2 text-xs font-bold text-foreground">Cancel</button>
              <button onClick={performRefire} disabled={refireBusy||!refireReason.trim()} className="rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-black text-foreground">{refireBusy?'Re-firing…':'Authorize & Re-fire'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}