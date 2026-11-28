import React, { useEffect, useState } from 'react';
import { useStore } from '@/data/AppStore';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';
import { posService } from '@/services/posService';
import { printOrderByCategory } from '@/services/printService';
import { getPrinters, getAssignments, printVoidTicket } from '@/services/printService';

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
      const collect = (assignmentType) => assignments.filter(a => a.assignment_type === assignmentType).map(a => printers.find(p => p.id === a.printer_id)).filter(Boolean).filter((p,i,a)=>a.findIndex(x=>x.id===p.id)===i);
      const dedicated = collect(type);
      const targets = dedicated.length ? dedicated : collect(fallback);
      if (!targets.length) throw new Error('No Kitchen/Bar printer is assigned for void slips.');
      const results = await Promise.all(targets.map(printer => printVoidTicket(printer,{propertyId,voidId:v.id,voidNumber:v.void_number,tableNo:v.table_number,waiterName:v.waiter,orderNumber:v.order_number||v.check_no,orderCreatedAt:v.order_created_at||null,item:v.item_name,modifiers:v.modifiers||[],note:v.note||v.prep_note||'',removedQty:v.removed_qty,originalQty:v.original_qty,newQty:v.new_qty,reason:v.reason,removedBy:v.removed_by_name,approvedByName:v.approved_by_name||'',approvedAt:v.approved_at||null,managerSignature:v.manager_signature||'',timestamp:v.created_at,category:v.category})));
      if (results.some(r=>r.outcome==='uncertain')) throw new Error('The void slip may already have printed. Check the paper before reprinting it.');
      if (!results.some(r=>r.ok)) throw new Error('Void reprint failed.');
      setVoids(await pmsService.listVoidedItems(propertyId));
    } catch(e) { setVoidError(e.message||'Void reprint failed.'); } finally { setVoidBusy(false); }
  };

  const approveVoid = async (v) => {
    if (!propertyId || !signature.trim()) { setVoidError('Manager signature is required.'); return; }
    try {
      await pmsService.approveVoid({propertyId,voidId:v.id,signature:signature.trim()});
      setSignature('');
      setVoids(await pmsService.listVoidedItems(propertyId));
    } catch(e) { setVoidError(e.message); }
  };

  const performRefire = async () => {
    if (!propertyId || !refireOrder || !refireReason.trim()) {
      setRefireError('A re-fire reason is required.');
      return;
    }
    setRefireBusy(true); setRefireError('');
    try {
      const saved = await posService.refireKitchenOrder({ propertyId, orderId: refireOrder.id, reason: refireReason.trim() });
      const result = await printOrderByCategory({
        propertyId, table: saved.table_number, tableNumber: saved.table_number,
        orderNumber: saved.order_number,
        propertyName: user?.property?.name || user?.property?.business_name || 'OliTechs PMS + POS',
        diningOption: saved.dining_option || 'Dine In', isReprint: true,
        checkNo: saved.order_number, waiter: saved.waiter,
        createdAt: new Date().toISOString(),
        items: Array.isArray(saved.order_lines) ? saved.order_lines : [],
      });
      if (!result.ok) throw new Error('Re-fire was authorized and logged, but a department printer did not complete the ticket.');
      setRefireOrder(null);
      setRefireReason('');
    } catch (e) {
      setRefireError(e.message || 'Re-fire failed.');
    } finally {
      setRefireBusy(false);
    }
  };

  const tabClass = (active) => `rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors ${active ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--sidebar)] hover:text-[var(--text)]'}`;
  const secondaryButton = 'rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--sidebar)] disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="flex-1 min-h-full overflow-y-auto bg-[var(--canvas)] p-4 text-[var(--text)]">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <button onClick={()=>setTab('orders')} className={tabClass(tab==='orders')}>KDS Orders</button>
          <button onClick={()=>setTab('voids')} className={tabClass(tab==='voids')}>Void Controls <span className="ml-1 rounded-full bg-[var(--sidebar)] px-2 py-0.5 text-[11px]">{voids.length}</span></button>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {['new', 'preparing', 'ready'].map((s) => {
            const st = STATUS_CONFIG[s];
            const count = orders.filter((o) => o.status === s).length;
            return (
              <div key={s} className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: st.color }} />
                <span className="font-medium text-[var(--text-muted)]">{st.label}</span>
                <span className="min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-bold" style={{ background: st.bg, color: st.color }}>{count}</span>
              </div>
            );
          })}
          <span className="border-l border-[var(--border)] pl-4 font-mono text-xs text-[var(--text-muted)]">{new Date(now).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>

      {tab === 'voids' ? (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--text)]">Void and cancellation controls</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">Review voided items, approvals and printer reprints.</p>
            </div>
            <input value={voidFilter} onChange={e=>setVoidFilter(e.target.value)} placeholder="Search table, item or reason…" className="min-h-10 w-full max-w-xs rounded-lg border border-[var(--input-border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none"/>
          </div>
          {voidError && <div className="mb-3 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]">{voidError}</div>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--sidebar)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
                <tr>{['Time','Table','Item','Removed','Reason','Removed by','Status','Actions'].map(h=><th key={h} className="p-3 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {visibleVoids.map(v=><tr key={v.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--canvas)]">
                  <td className="whitespace-nowrap p-3 font-mono text-xs text-[var(--text-muted)]">{formatTime(v.created_at)}</td>
                  <td className="p-3 font-semibold text-[var(--text)]">{v.table_number}</td>
                  <td className="p-3"><div className="font-semibold text-[var(--text)]">{v.item_name}</div><div className="text-xs capitalize text-[var(--text-muted)]">{v.category}</div></td>
                  <td className="p-3 font-semibold text-[var(--danger-text)]">{v.removed_qty}</td>
                  <td className="p-3 text-[var(--text-muted)]">{v.reason || '—'}</td>
                  <td className="p-3 text-[var(--text-muted)]">{v.removed_by_name||'—'}</td>
                  <td className="p-3"><span className="rounded-full bg-[var(--sidebar)] px-2.5 py-1 text-xs font-semibold text-[var(--text)]">{v.status === 'printed' ? 'Void printed' : v.status}</span></td>
                  <td className="p-3"><div className="flex gap-2"><button disabled={voidBusy} onClick={()=>reprintVoid(v)} className={secondaryButton}>Reprint</button>{canApproveVoid&&v.status!=='approved'&&<button onClick={()=>approveVoid(v)} className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--on-primary)] hover:bg-[var(--primary-hover)]">Approve</button>}</div></td>
                </tr>)}
              </tbody>
            </table>
          </div>
          {visibleVoids.length===0&&<div className="py-10 text-center text-sm text-[var(--text-muted)]">No voids found today.</div>}
          {canApproveVoid && <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4"><input value={signature} onChange={e=>setSignature(e.target.value)} placeholder="Manager name / approval signature" className="min-h-10 flex-1 rounded-lg border border-[var(--input-border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none"/><span className="text-xs text-[var(--text-muted)]">A manager signature is required before approval.</span></div>}
        </section>
      ) : (
        <>
          {orders.length === 0 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center shadow-sm">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[var(--primary)]"><span className="text-xl">⌑</span></div>
              <h2 className="text-base font-semibold text-[var(--text)]">No active kitchen orders</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-[var(--text-muted)]">Orders sent from POS will appear here when the kitchen display queue is active.</p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {orders.filter((o) => o && o.status !== 'served').map((order) => {
              const st = STATUS_CONFIG[order.status] || STATUS_CONFIG.new;
              const areas = [...new Set((order.orderLines || []).map((item) => item.center).filter(Boolean))];
              const ageMinutes = order.firedAt ? Math.max(0, Math.floor((now - order.firedAt) / 60000)) : 0;
              return (
                <article key={order.id} className="flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
                  <header className="border-b border-[var(--border)] px-4 py-3" style={{ background: st.bg }}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-[var(--text)]">{order.orderNumber || order.id}</div>
                        <div className="mt-1 text-xs text-[var(--text-muted)]">{areas.join(' · ') || 'Kitchen'} <span className="mx-1">·</span><span className="font-semibold text-[var(--text)]">Table {order.tableNumber || '—'}</span></div>
                      </div>
                      <span className="rounded-full border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: st.color, color: st.color, background: 'var(--surface)' }}>{st.label}</span>
                    </div>
                    <div className="mt-2 flex justify-between text-xs text-[var(--text-muted)]"><span>{order.waiter || 'POS'}</span><span className="font-mono">{formatTime(order.firedAt)} · {ageMinutes}m</span></div>
                  </header>
                  <div className="flex-1 px-4 py-2">
                    {(order.orderLines || []).map((item, i) => (
                      <div key={i} className="flex items-center gap-3 border-b border-[var(--border)] py-2 last:border-0">
                        <span className="w-8 shrink-0 rounded-md bg-[var(--sidebar)] px-2 py-1 text-center text-xs font-bold text-[var(--text)]">{item.qty}×</span>
                        <span className="flex-1 text-sm font-medium text-[var(--text)]">{item.name}</span>
                        {item.center && <span className="rounded-md bg-[var(--primary-soft)] px-2 py-1 text-[10px] font-semibold text-[var(--primary)]">{item.center}</span>}
                      </div>
                    ))}
                  </div>
                  {NEXT_STATUS[order.status] && (
                    <footer className="space-y-2 border-t border-[var(--border)] p-3">
                      {canApproveVoid && <button onClick={() => { setRefireOrder(order); setRefireReason(''); setRefireError(''); }} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-semibold text-[var(--text)] hover:bg-[var(--sidebar)]">Re-fire ticket</button>}
                      <button onClick={() => updateKitchenOrderStatus(order.id, NEXT_STATUS[order.status]).catch((error) => setVoidError(error?.message || 'Unable to update production status.'))} className="w-full rounded-lg py-2.5 text-sm font-semibold" style={{ background: st.color, color: 'var(--white)' }}>Mark as {STATUS_CONFIG[NEXT_STATUS[order.status]].label} →</button>
                    </footer>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}

      {refireOrder && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--overlay-scrim)] p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-[var(--text)]">Re-fire kitchen ticket</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">This creates an audit event and prints the complete ticket again. It does not create a new sale.</p>
            {refireError && <div className="mt-3 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]">{refireError}</div>}
            <textarea value={refireReason} onChange={e=>setRefireReason(e.target.value)} placeholder="Reason, e.g. printer jam or ticket lost" className="mt-4 min-h-24 w-full rounded-lg border border-[var(--input-border)] bg-[var(--surface)] p-3 text-sm text-[var(--text)] outline-none" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={()=>setRefireOrder(null)} disabled={refireBusy} className={secondaryButton}>Cancel</button>
              <button onClick={performRefire} disabled={refireBusy||!refireReason.trim()} className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--on-primary)] disabled:opacity-50">{refireBusy?'Re-firing…':'Authorize & Re-fire'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}