import React, { useEffect, useMemo, useState } from 'react';
import { PageDataSkeleton } from '@/components/ui/AppLoadingSkeleton';
import { ArrowLeftRight, Banknote, Plus, RefreshCw, Search, ShieldCheck, Undo2, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';
import DocumentExportMenu from '@/components/shared/DocumentExportMenu';
import { buildFolioStatementDefinition, buildFinalSettlementInvoiceDefinition, buildPaymentReceiptDefinition } from '@/services/reportDefinitions';

const money = (v) => `KES ${Number(v || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const input = "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-soft)]";
const btn = "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50";
const categoryLabels = {
  accommodation: 'Accommodation', restaurant: 'Restaurant', bar: 'Bar', laundry: 'Laundry',
  airport_transfer: 'Airport transfers', excursion: 'Excursions', room_service: 'Room service',
  other_services: 'Other services', tax_adjustment: 'Taxes and adjustments', discount: 'Discounts',
};
const categories = Object.keys(categoryLabels);
const managerRoles = ['owner', 'admin', 'manager', 'hotel_admin', 'super_admin', 'fb_manager', 'general_manager', 'front_office_manager'];

export default function Folio({ initialReservationId = null, embedded = false }) {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const roles = [user?.role, user?.staff?.role, user?.property?.role, user?.staff_role].filter(Boolean);
  const canManage = roles.some((role) => managerRoles.includes(String(role).toLowerCase()));
  const [reservations, setReservations] = useState([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [folio, setFolio] = useState(null);
  const [payments, setPayments] = useState([]);
  const [refunds, setRefunds] = useState([]);
  const [posReceipts, setPosReceipts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState('');
  const [targetPayment, setTargetPayment] = useState(null);
  const [selectedChargeIds, setSelectedChargeIds] = useState([]);
  const [targetReservationId, setTargetReservationId] = useState('');
  const [showInvoiceEditor, setShowInvoiceEditor] = useState(false);
  const [invoiceHeader, setInvoiceHeader] = useState({});
  const [invoiceDefinition, setInvoiceDefinition] = useState(null);

  const loadReservations = async () => {
    if (!propertyId) return;
    setLoading(true); setError('');
    try {
      const activeRows = (await pmsService.listReservations(propertyId) || []).filter((r) => r.status !== 'cancelled');
      setReservations(activeRows);
      if (initialReservationId) {
        const initial = activeRows.find((r) => String(r.id) === String(initialReservationId));
        if (initial) await loadFolio(initial);
        else setError('The selected room reservation could not be found in this property.');
      }
    } catch (e) { setError(e.message || 'Guest accounts could not be loaded.'); }
    finally { setLoading(false); }
  };

  const loadFolio = async (reservation) => {
    setSelected(reservation); setFolio(null); setPayments([]); setRefunds([]); setPosReceipts([]); setError(''); setNotice(''); setSelectedChargeIds([]); setShowInvoiceEditor(false); setInvoiceDefinition(null);
    setInvoiceHeader({
      invoiceTitle: 'Final Settlement Invoice',
      invoiceReference: `FOL-${String(reservation.id || '').slice(0, 8).toUpperCase()}`,
      businessName: user?.property?.business_name || user?.property?.name || 'OliTechs',
      businessAddress: user?.property?.address || '', businessPhone: '', businessEmail: '', businessTaxPin: '',
      billTo: reservation.guest_name || '', guestAddress: reservation.guest_address || reservation.address || '',
      guestPhone: reservation.phone || '', guestEmail: reservation.email || reservation.guest_email || '', guestTaxPin: '',
      headerNote: '', footerNote: 'Thank you for staying with us.',
    });
    try {
      const [f, p, r, receipts] = await Promise.all([
        pmsService.getFolio(reservation.id), pmsService.listPayments(reservation.id), pmsService.listFolioRefunds(reservation.id), pmsService.listReceiptsForReservation(reservation.id),
      ]);
      setFolio(f); setPayments(p); setRefunds(r); setPosReceipts(receipts || []);
    } catch (e) { setError(e.message || 'Guest folio could not be loaded.'); }
  };

  useEffect(() => {
    loadReservations();
    if (propertyId) pmsService.listFolioEmployees(propertyId).then(setEmployees).catch(() => setEmployees([]));
  }, [propertyId, initialReservationId]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reservations.filter((r) => !q || [r.guest_name, r.phone, r.room_id, r.id, r.channel].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [reservations, query]);

  const refresh = async () => { await loadReservations(); if (selected) await loadFolio(selected); };
  const run = async (fn, success) => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); await loadFolio(selected); if (success) setNotice(success); }
    catch (e) { setError(e.message || 'The folio operation failed. No success was assumed.'); }
    finally { setBusy(false); }
  };

  const charges = folio?.charges || [];
  const positivePayments = payments.filter((p) => Number(p.amount) > 0 && p.status === 'posted');
  const refundsTotal = Math.abs(payments.filter((p) => Number(p.amount) < 0 && p.status === 'posted').reduce((sum, p) => sum + Number(p.amount), 0));
  const chargeTotal = charges.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const grossPayments = positivePayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const netPayments = payments.filter((p) => p.status === 'posted').reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const accommodation = charges.filter((c) => c.category === 'accommodation' || c.source === 'room').reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const posCharges = charges.filter((c) => c.source === 'pos' || ['restaurant', 'bar', 'room_service'].includes(c.category)).reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const discounts = Math.abs(charges.filter((c) => c.category === 'discount').reduce((sum, c) => sum + Math.min(0, Number(c.amount || 0)), 0));
  const additionalCharges = charges.filter((c) => c.category !== 'accommodation' && c.category !== 'discount' && c.source !== 'pos').reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const balance = chargeTotal - netPayments;
  const roomLabel = folio?.room?.number ?? selected?.room_id?.slice(0, 8) ?? '—';
  const employeeName = (actorId) => employees.find((employee) => employee.user_id === actorId || employee.id === actorId)?.full_name || (actorId ? actorId.slice(0, 8) : 'System');
  const refundedByPayment = (paymentId) => refunds.filter((r) => r.target_type === 'payment' && r.target_id === paymentId).reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const openRefund = (payment) => { setTargetPayment(payment); setModal('refund'); };
  const submitCharge = (data) => run(async () => {
    await pmsService.postFolioCharge({ propertyId, reservationId: selected.id, ...data, idempotencyKey: crypto.randomUUID() });
    setModal('');
  }, 'Charge posted to the guest ledger.');
  const submitPayment = (data) => run(async () => {
    const saved = await pmsService.postFolioPayment({ propertyId, reservationId: selected.id, ...data, idempotencyKey: crypto.randomUUID() });
    setModal(''); setNotice(`Payment recorded: ${saved.reference || saved.id}. Print the saved receipt from payment history.`);
  });
  const submitRefund = (data) => run(async () => {
    const saved = await pmsService.refundFolioPayment({ propertyId, paymentId: targetPayment.id, ...data, idempotencyKey: crypto.randomUUID() });
    setModal(''); setTargetPayment(null); setNotice(`Refund recorded: ${saved.reference || saved.id}.`);
  });
  const grouped = categories.map((category) => ({ category, rows: charges.filter((c) => (c.category || (c.source === 'room' ? 'accommodation' : c.source === 'pos' ? 'restaurant' : 'other_services')) === category) })).filter((group) => group.rows.length);
  const propertyName = user?.property?.business_name || user?.property?.name || 'OliTechs';
  const generatedBy = user?.full_name || user?.staff?.full_name || user?.email || 'Authorized staff';
  const statementDefinition = useMemo(() => selected ? buildFolioStatementDefinition({ selected, charges, payments, employees, propertyName, generatedBy, totals: { chargeTotal, netPayments, balance } }) : null, [selected, charges, payments, employees, propertyName, generatedBy, chargeTotal, netPayments, balance]);
  const prepareFinalInvoice = (header) => {
    const definition = buildFinalSettlementInvoiceDefinition({ selected, room: folio?.room, charges, payments, receipts: posReceipts, employees, propertyName, generatedBy, totals: { chargeTotal, netPayments, balance }, header });
    setInvoiceHeader(header); setInvoiceDefinition(definition); setShowInvoiceEditor(false);
  };

  return (
    <div className={embedded ? "h-full min-h-0 overflow-y-auto bg-canvas p-3" : "flex-1 overflow-y-auto bg-canvas p-4 lg:p-6"}>
      <div className="mx-auto max-w-[1600px] space-y-4">
        {!embedded && <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h1 className="text-xl font-bold text-foreground">Guest Folio & Account Management</h1><p className="mt-1 text-sm text-[var(--text-muted)]">Audited guest charges, tender, refunds and account statements.</p></div>
          <button className={btn + " border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"} onClick={refresh} disabled={loading || busy}><RefreshCw size={15}/> Refresh</button>
        </header>}
        {error && <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger-text)]">{error}</div>}
        {notice && <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]">{notice}</div>}
        <div className={embedded ? "grid gap-4 grid-cols-1" : "grid gap-4 lg:grid-cols-[330px_minmax(0,1fr)]"}>
          {!embedded && <aside className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="border-b border-[var(--border)] p-3"><div className="relative"><Search size={15} className="absolute left-3 top-3 text-muted-foreground"/><input className={input+" pl-9"} placeholder="Search guest, phone, room or reference" value={query} onChange={(e)=>setQuery(e.target.value)}/></div></div>
            <div className="max-h-[720px] overflow-y-auto">
              {loading ? <div className="p-3"><PageDataSkeleton variant="list" rows={6}/></div> : filtered.map((r) => <button key={r.id} onClick={()=>loadFolio(r)} className={`w-full border-b border-[var(--border)] p-4 text-left hover:bg-[var(--canvas)] ${selected?.id===r.id?'bg-[var(--canvas)]':''}`}>
                <div className="flex items-center justify-between gap-2"><span className="font-semibold text-[var(--text)]">{r.guest_name}</span><span className="text-[11px] capitalize text-[var(--text-muted)]">{r.status}</span></div>
                <div className="mt-1 text-xs text-[var(--text-muted)]">{r.arrival} → {r.departure} · {r.channel || 'direct'}</div><div className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">Reservation {r.id.slice(0,8)}</div>
              </button>)}
              {!loading && !filtered.length && <div className="p-6 text-center text-sm text-[var(--text-muted)]">No guest accounts found.</div>}
            </div>
          </aside>}

          <main className="min-h-[600px] rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            {!selected ? <div className="flex min-h-[600px] items-center justify-center text-sm text-[var(--text-muted)]">Select a guest account to open its folio.</div> : <>
              <div className="flex flex-col gap-3 border-b border-[var(--border)] p-4 sm:flex-row sm:items-start sm:justify-between">
                <div><h2 className="text-xl font-bold text-foreground">{selected.guest_name}</h2><div className="mt-1 text-xs text-[var(--text-muted)]">Reservation #{selected.id.slice(0,8)} · Room {roomLabel} · {selected.status}</div><div className="text-xs text-[var(--text-muted)]">{selected.arrival} → {selected.departure} · {selected.channel || 'direct'} · {selected.meal_plan || 'bed_only'}</div></div>
                <div className="flex flex-wrap gap-2">
                  <DocumentExportMenu definition={statementDefinition} label="Folio statement" disabled={!statementDefinition} />
                  <button className={btn+" border border-[var(--border)]"} onClick={()=>setShowInvoiceEditor(true)} disabled={!folio}>{invoiceDefinition ? 'Edit invoice header' : 'Prepare final invoice'}</button>
                  {invoiceDefinition && <DocumentExportMenu definition={invoiceDefinition} label="Final settlement invoice" formats={['pdf','excel','print']} disabled={!invoiceDefinition}/> }
                  <button className={btn+" border border-[var(--border)]"} onClick={()=>setModal('transfer')} disabled={!charges.length}><ArrowLeftRight size={15}/> Split / transfer</button>
                  <button className={btn+" border border-[var(--border)]"} onClick={()=>setModal('discount')} disabled={!canManage}><ShieldCheck size={15}/> Discount</button>
                  <button className={btn+" border border-[var(--border)]"} onClick={()=>setModal('charge')}><Plus size={15}/> Add charge</button>
                  <button className={btn+" bg-primary text-primary-foreground"} onClick={()=>setModal('payment')} disabled={balance<=0}><Banknote size={15}/> Take payment</button>
                </div>
              </div>

              <section className="grid grid-cols-2 gap-3 border-b border-[var(--border)] p-4 md:grid-cols-4 xl:grid-cols-5">
                <Metric label="Accommodation" value={money(accommodation)}/><Metric label="Additional charges" value={money(additionalCharges)}/><Metric label="POS charges" value={money(posCharges)}/><Metric label="Payments received" value={money(grossPayments)}/><Metric label="Discounts" value={money(discounts)}/><Metric label="Refunds" value={money(refundsTotal)}/><Metric label="Total charges" value={money(chargeTotal)}/><Metric label="Net payments" value={money(netPayments)}/><Metric label="Outstanding balance" value={money(balance)} alert={balance>0.005}/>
              </section>

              <section className="border-b border-[var(--border)] p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div><h3 className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">POS receipts sent to this room</h3><p className="mt-1 text-xs text-[var(--text-muted)]">Original POS receipt numbers and consumed items linked to this guest stay.</p></div>
                  <span className="rounded-full bg-[var(--canvas)] px-2.5 py-1 text-xs font-semibold text-[var(--text)]">{posReceipts.length} receipts</span>
                </div>
                {posReceipts.length ? <div className="space-y-2">
                  {posReceipts.map((receipt)=>(
                    <details key={receipt.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 p-3 text-xs">
                        <span className="min-w-0"><strong className="text-[var(--text)]">Receipt {receipt.order_number || receipt.id.slice(0,8)}</strong><span className="ml-2 font-mono text-[var(--text-muted)]">{receipt.id}</span><span className="ml-2 text-[var(--text-muted)]">{new Date(receipt.created_at).toLocaleString('en-KE')}</span></span>
                        <span className="flex items-center gap-3"><span className="capitalize text-[var(--text-muted)]">{receipt.payment_method || '—'}</span><strong className="text-sm text-[var(--text)]">{money(receipt.total)}</strong></span>
                      </summary>
                      <div className="border-t border-[var(--border)] p-3">
                        <div className="mb-2 flex flex-wrap justify-between gap-2 text-[11px] text-[var(--text-muted)]"><span>Room {receipt.room_number || roomLabel} · Table {receipt.table_number || '—'} · Order {receipt.order_number || '—'}</span><span>Cashier {employeeName(receipt.created_by)}</span></div>
                        <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-xs"><thead><tr className="border-b border-[var(--border)] text-left text-[10px] uppercase text-[var(--text-muted)]"><th className="py-2">Consumed product / service</th><th className="px-2 py-2 text-right">Qty</th><th className="px-2 py-2 text-right">Unit price</th><th className="px-2 py-2 text-right">Line total</th></tr></thead><tbody>
                          {(Array.isArray(receipt.items)?receipt.items:[]).map((item,index)=>{const qty=Number(item.qty??item.quantity??1);const unit=Number(item.unit_price??item.price??item.selling_price??0);return <tr key={item.id||item.product_id||index} className="border-b border-[var(--border)]"><td className="py-2"><div className="font-medium text-[var(--text)]">{item.name||item.item_name||'Item'}</div>{Array.isArray(item.modifiers)&&item.modifiers.length>0&&<div className="text-[10px] text-[var(--text-muted)]">{item.modifiers.map((modifier)=>typeof modifier==='string'?modifier:(modifier.name||modifier.label||modifier.value||'')).filter(Boolean).join(' · ')}</div>}</td><td className="px-2 py-2 text-right">{qty}</td><td className="px-2 py-2 text-right">{money(unit)}</td><td className="px-2 py-2 text-right font-semibold">{money(item.total??item.line_total??item.amount??unit*qty)}</td></tr>;})}
                          {!Array.isArray(receipt.items)||!receipt.items.length ? <tr><td colSpan="4" className="py-4 text-center text-[var(--text-muted)]">No item lines were stored on this receipt.</td></tr> : null}
                        </tbody></table></div>
                        <div className="mt-3 flex flex-wrap justify-end gap-x-5 gap-y-1 border-t border-[var(--border)] pt-2 text-xs"><span>Subtotal <strong>{money(receipt.subtotal)}</strong></span><span>Discount <strong>{money(receipt.discount_amount)}</strong></span><span>VAT / tax <strong>{money(receipt.vat)}</strong></span><span>Receipt total <strong>{money(receipt.total)}</strong></span></div>
                        <div className="mt-2 text-[10px] text-[var(--text-muted)]">Linked folio charge: {receipt.folio_charge_id || 'Not linked'} · This receipt remains the original POS source record.</div>
                      </div>
                    </details>
                  ))}
                </div> : <div className="rounded-lg bg-[var(--canvas)] p-5 text-center text-sm text-[var(--text-muted)]">No POS receipts are linked to this room stay yet.</div>}
              </section>

              <section className="border-b border-[var(--border)] p-4">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Transaction ledger by category</h3>
                {grouped.length ? grouped.map(({category,rows})=><div key={category} className="mb-5 last:mb-0">
                  <div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-semibold text-[var(--text)]">{categoryLabels[category]}</h4><span className="text-xs text-[var(--text-muted)]">{rows.length} transactions</span></div>
                  <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-xs"><thead><tr className="border-b border-[var(--border)] text-left text-[10px] uppercase text-[var(--text-muted)]">{['Date & time','Reference','Source','Description','Qty','Unit price','Total','Employee','Status','Action'].map(h=><th key={h} className="px-2 py-2">{h}</th>)}</tr></thead><tbody>
                    {rows.map((c)=><tr key={c.id} className="border-b border-[var(--border)]"><td className="px-2 py-2 text-[var(--text-muted)]">{new Date(c.created_at).toLocaleString('en-KE')}</td><td className="px-2 py-2 font-mono">{c.reference || c.id.slice(0,8)}</td><td className="px-2 py-2 capitalize">{c.source_module || c.source}</td><td className="px-2 py-2 font-medium">{c.description}{posReceipts.filter((receipt)=>receipt.folio_charge_id===c.id).map((receipt)=><details key={receipt.id} className="mt-2 rounded-md border border-[var(--border)] p-2 font-normal"><summary className="cursor-pointer text-[11px] font-semibold">Open POS receipt · Order {receipt.order_number||receipt.id.slice(0,8)}</summary><div className="mt-2 space-y-1 text-[11px]">{(Array.isArray(receipt.items)?receipt.items:[]).map((item,index)=><div key={item.id||item.product_id||index} className="flex justify-between gap-2"><span>{item.name||item.item_name||'Item'} × {item.qty??item.quantity??1}{Array.isArray(item.modifiers)&&item.modifiers.length?' · '+item.modifiers.map((modifier)=>modifier.name||modifier.label||modifier).join(', '):''}</span><span>{money(item.total??item.line_total??(Number(item.price??item.unit_price??0)*Number(item.qty??item.quantity??1)))}</span></div>)}<div className="border-t border-[var(--border)] pt-1">Subtotal {money(receipt.subtotal)} · Discount {money(receipt.discount_amount)} · Tax {money(receipt.vat)} · Total {money(receipt.total)}</div><div>Receipt {receipt.id} · {new Date(receipt.created_at).toLocaleString('en-KE')}</div><div>Cashier ID: {receipt.created_by||'—'} · Waiter: {receipt.waiter||'—'} · Payment: {receipt.payment_method}</div></div></details>)}</td><td className="px-2 py-2 text-right">{c.quantity ?? 1}</td><td className="px-2 py-2 text-right">{money(c.unit_price ?? c.amount)}</td><td className="px-2 py-2 text-right font-semibold">{money(c.amount)}</td><td className="px-2 py-2 font-mono">{employeeName(c.created_by)}</td><td className="px-2 py-2">{c.reversal_of_id ? 'Reversal' : 'Posted'}</td><td className="px-2 py-2">{canManage && Number(c.amount)>0 && !c.reversal_of_id && !charges.some((x)=>x.reversal_of_id===c.id) ? <button className="text-xs font-semibold text-[var(--danger)]" disabled={busy} onClick={()=>{const reason=window.prompt('Reason for reversing this charge:');if(reason?.trim())run(()=>pmsService.reverseFolioCharge({propertyId,chargeId:c.id,reason}), 'Charge reversal posted.')}}>Reverse</button> : '—'}</td></tr>)}
                  </tbody></table></div>
                </div>) : <div className="rounded-lg bg-[var(--canvas)] p-6 text-center text-sm text-[var(--text-muted)]">No charge transactions have been posted to this folio.</div>}
              </section>

              <section className="p-4">
                <div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Payment, refund & receipt history</h3><span className="text-xs text-[var(--text-muted)]">{payments.length} ledger entries</span></div>
                <div className="overflow-x-auto"><table className="w-full min-w-[750px] text-xs"><thead><tr className="border-b border-[var(--border)] text-left text-[10px] uppercase text-[var(--text-muted)]">{['Date & time','Receipt / reference','Method','Allocation','Transaction','Amount','Status','Receipt'].map(h=><th key={h} className="px-2 py-2">{h}</th>)}</tr></thead><tbody>
                  {payments.map((p)=><tr key={p.id} className="border-b border-[var(--border)]"><td className="px-2 py-3 text-[var(--text-muted)]">{new Date(p.created_at).toLocaleString('en-KE')}</td><td className="px-2 py-3 font-mono">{p.reference || p.id.slice(0,8)}</td><td className="px-2 py-3 capitalize">{String(p.method).replace('_',' ')}</td><td className="px-2 py-3">{p.folio_charge_id ? (charges.find((c)=>c.id===p.folio_charge_id)?.description || p.folio_charge_id.slice(0,8)) : 'General folio'}</td><td className="px-2 py-3">{Number(p.amount)<0?'Refund':'Payment'}</td><td className="px-2 py-3 text-right font-semibold">{money(Math.abs(p.amount))}</td><td className="px-2 py-3">{p.status}</td><td className="px-2 py-3"><div className="flex gap-2">{Number(p.amount)>0 && p.status==='posted' && canManage && <button className="font-semibold text-[var(--danger)]" onClick={()=>openRefund(p)} disabled={busy || refundedByPayment(p.id)>=Number(p.amount)-0.005}>Refund</button>}<DocumentExportMenu definition={buildPaymentReceiptDefinition({selected,payment:p,propertyName,generatedBy})} label="Receipt" formats={['pdf','print']} /></div></td></tr>)}
                  {!payments.length&&<tr><td colSpan="8" className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">No payments recorded.</td></tr>}
                </tbody></table></div>
                {refunds.length>0&&<div className="mt-4 rounded-lg border border-[var(--border)] p-3"><h4 className="mb-2 text-xs font-semibold text-[var(--text)]">Refund audit records</h4>{refunds.map((r)=><div key={r.id} className="flex flex-wrap justify-between gap-2 border-b border-[var(--border)] py-2 text-xs last:border-0"><span>{r.method} · {r.target_type} · {r.target_id?.slice(0,8)}</span><strong>{money(r.amount)}</strong></div>)}</div>}
              </section>
            </>}
          </main>
        </div>
      </div>

      {showInvoiceEditor && <FinalInvoiceHeaderModal selected={selected} roomLabel={roomLabel} defaults={invoiceHeader} onClose={()=>setShowInvoiceEditor(false)} onSubmit={prepareFinalInvoice}/>}
      {modal==='charge'&&<ChargeModal busy={busy} onClose={()=>setModal('')} onSubmit={submitCharge}/>}
      {modal==='payment'&&<PaymentModal balance={balance} charges={charges} busy={busy} onClose={()=>setModal('')} onSubmit={submitPayment}/>}
      {modal==='refund'&&targetPayment&&<RefundModal payment={targetPayment} refundable={Math.max(0,Number(targetPayment.amount)-refundedByPayment(targetPayment.id))} busy={busy} onClose={()=>setModal('')} onSubmit={submitRefund}/>}
      {modal==='discount'&&<DiscountModal busy={busy} onClose={()=>setModal('')} onSubmit={(data)=>run(async()=>{await pmsService.applyFolioDiscount({propertyId,reservationId:selected.id,...data,idempotencyKey:crypto.randomUUID()});setModal('');},'Authorised discount posted.')}/>}
      {modal==='transfer'&&<TransferModal reservations={reservations.filter((r)=>r.id!==selected.id&&r.status!=='cancelled')} selectedCount={selectedChargeIds.length} selectedIds={selectedChargeIds} onToggle={(id)=>setSelectedChargeIds((current)=>current.includes(id)?current.filter((x)=>x!==id):[...current,id])} charges={charges} targetReservationId={targetReservationId} setTargetReservationId={setTargetReservationId} busy={busy} onClose={()=>setModal('')} onSubmit={(reason)=>run(async()=>{await pmsService.transferFolioCharges({propertyId,chargeIds:selectedChargeIds,targetReservationId,reason});setModal('');setTargetReservationId('');},'Selected charges transferred. Both account histories retain the audit trail.')}/>}
    </div>
  );
}


function FinalInvoiceHeaderModal({selected,roomLabel,defaults,onClose,onSubmit}) {
  const [form,setForm]=useState(defaults || {});
  const update=(key,value)=>setForm((current)=>({...current,[key]:value}));
  return <Modal title="Edit final invoice header" onClose={onClose}>
    <form onSubmit={(event)=>{event.preventDefault();onSubmit(form);}} className="max-h-[75vh] space-y-3 overflow-y-auto pr-1">
      <p className="text-xs text-[var(--text-muted)]">These details appear on the printable final invoice. Editing this header does not change posted POS receipts, folio charges or payments.</p>
      <Field label="Invoice title"><input className={input} value={form.invoiceTitle||''} onChange={(e)=>update('invoiceTitle',e.target.value)}/></Field>
      <Field label="Invoice reference"><input className={input} value={form.invoiceReference||''} onChange={(e)=>update('invoiceReference',e.target.value)}/></Field>
      <Field label="Business / property name"><input required className={input} value={form.businessName||''} onChange={(e)=>update('businessName',e.target.value)}/></Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Business address"><input className={input} value={form.businessAddress||''} onChange={(e)=>update('businessAddress',e.target.value)}/></Field>
        <Field label="Business phone"><input className={input} value={form.businessPhone||''} onChange={(e)=>update('businessPhone',e.target.value)}/></Field>
        <Field label="Business email"><input type="email" className={input} value={form.businessEmail||''} onChange={(e)=>update('businessEmail',e.target.value)}/></Field>
        <Field label="Business KRA PIN / tax ID"><input className={input} value={form.businessTaxPin||''} onChange={(e)=>update('businessTaxPin',e.target.value)}/></Field>
      </div>
      <div className="border-t border-[var(--border)] pt-3"><h3 className="mb-2 text-sm font-semibold text-[var(--text)]">Guest / bill-to details</h3>
        <div className="space-y-3">
          <Field label="Bill to / guest name"><input required className={input} value={form.billTo||''} onChange={(e)=>update('billTo',e.target.value)}/></Field>
          <Field label="Guest billing address"><input className={input} value={form.guestAddress||''} onChange={(e)=>update('guestAddress',e.target.value)}/></Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Guest phone"><input className={input} value={form.guestPhone||''} onChange={(e)=>update('guestPhone',e.target.value)}/></Field>
            <Field label="Guest email"><input type="email" className={input} value={form.guestEmail||''} onChange={(e)=>update('guestEmail',e.target.value)}/></Field>
          </div>
          <Field label="Guest KRA PIN / tax ID"><input className={input} value={form.guestTaxPin||''} onChange={(e)=>update('guestTaxPin',e.target.value)}/></Field>
        </div>
      </div>
      <Field label="Additional header details / company or booking information"><textarea rows="2" className={input} value={form.headerNote||''} onChange={(e)=>update('headerNote',e.target.value)}/></Field>
      <Field label="Invoice footer note"><textarea rows="2" className={input} value={form.footerNote||''} onChange={(e)=>update('footerNote',e.target.value)}/></Field>
      <div className="rounded-lg bg-[var(--canvas)] p-3 text-xs text-[var(--text-muted)]">Room {roomLabel || '—'} · {selected?.arrival || '—'} to {selected?.departure || '—'} · Reservation {String(selected?.id||'').slice(0,8)}</div>
      <div className="flex justify-end gap-2 pt-1"><button type="button" className={btn+" border border-[var(--border)]"} onClick={onClose}>Cancel</button><button type="submit" className={btn+" bg-primary text-primary-foreground"}>Prepare invoice</button></div>
    </form>
  </Modal>;
}

function Metric({label,value,alert}){return <div className="rounded-lg bg-[var(--canvas)] p-3"><div className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</div><div className={`mt-1 text-base font-bold ${alert?'text-[var(--warning-text)]':'text-[var(--text)]'}`}>{value}</div></div>}
function Modal({title,children,onClose}){return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[var(--overlay-scrim)] p-4"><div className="w-full max-w-lg rounded-xl bg-[var(--surface)] shadow-2xl"><div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4"><h2 className="font-bold text-foreground">{title}</h2><button onClick={onClose} aria-label="Close"><X size={18}/></button></div><div className="p-5">{children}</div></div></div>}
function ChargeModal({onClose,onSubmit,busy}){const [description,setDescription]=useState('');const [category,setCategory]=useState('other_services');const [quantity,setQuantity]=useState('1');const [unitPrice,setUnitPrice]=useState('');const [reference,setReference]=useState('');const total=Number(quantity||0)*Number(unitPrice||0);return <Modal title="Post a folio charge" onClose={onClose}><form onSubmit={(e)=>{e.preventDefault();onSubmit({description,category,quantity:Number(quantity),unitPrice:Number(unitPrice),reference})}} className="space-y-3"><Field label="Transaction category"><select className={input} value={category} onChange={(e)=>setCategory(e.target.value)}>{categories.map((c)=><option key={c} value={c}>{categoryLabels[c]}</option>)}</select></Field><Field label="Description"><input required className={input} value={description} onChange={(e)=>setDescription(e.target.value)}/></Field><div className="grid grid-cols-2 gap-3"><Field label="Quantity"><input required type="number" min="0.001" step="0.001" className={input} value={quantity} onChange={(e)=>setQuantity(e.target.value)}/></Field><Field label="Unit price (KES)"><input required type="number" min="0.01" step="0.01" className={input} value={unitPrice} onChange={(e)=>setUnitPrice(e.target.value)}/></Field></div><Field label="External reference (optional)"><input className={input} value={reference} onChange={(e)=>setReference(e.target.value)}/></Field><div className="rounded-lg bg-[var(--canvas)] p-3 text-sm">Charge total: <strong>{money(total)}</strong></div><button disabled={busy||!description.trim()||total<=0} className={btn+" w-full bg-primary text-primary-foreground"}><Plus size={15}/> Post charge</button></form></Modal>}
function PaymentModal({balance,charges,onClose,onSubmit,busy}){const [amount,setAmount]=useState(String(balance>0?balance:''));const [method,setMethod]=useState('cash');const [reference,setReference]=useState('');const [chargeId,setChargeId]=useState('');return <Modal title="Record guest payment" onClose={onClose}><form onSubmit={(e)=>{e.preventDefault();onSubmit({amount:Number(amount),method,reference,chargeId:chargeId||null})}} className="space-y-3"><div className="rounded-lg bg-[var(--canvas)] p-3 text-sm">Outstanding balance: <strong>{money(balance)}</strong></div><Field label="Amount (KES)"><input required type="number" min="0.01" max={balance} step="0.01" className={input} value={amount} onChange={(e)=>setAmount(e.target.value)}/></Field><Field label="Allocate payment to charge (optional)"><select className={input} value={chargeId} onChange={(e)=>setChargeId(e.target.value)}><option value="">General folio balance</option>{charges.filter((c)=>Number(c.amount)>0).map((c)=><option key={c.id} value={c.id}>{c.description} · {money(c.amount)}</option>)}</select></Field><Field label="Payment method"><select className={input} value={method} onChange={(e)=>setMethod(e.target.value)}><option value="cash">Cash</option><option value="mpesa">M-Pesa</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="other">Other configured method</option></select></Field><Field label="Reference / confirmation reference (optional)"><input className={input} value={reference} onChange={(e)=>setReference(e.target.value)} placeholder="Enter reference only after confirming receipt"/></Field><p className="text-xs text-[var(--text-muted)]">This records a payment confirmed by staff. It does not contact M-Pesa, a bank or a card processor.</p><button disabled={busy||Number(amount)<=0||Number(amount)>balance+0.005} className={btn+" w-full bg-primary text-primary-foreground"}><Banknote size={15}/> Save payment</button></form></Modal>}
function RefundModal({payment,refundable,onClose,onSubmit,busy}){const [amount,setAmount]=useState(String(refundable));const [method,setMethod]=useState(payment.method||'cash');const [reason,setReason]=useState('');return <Modal title="Authorise payment refund" onClose={onClose}><form onSubmit={(e)=>{e.preventDefault();onSubmit({amount:Number(amount),method,reason})}} className="space-y-3"><div className="rounded-lg bg-[var(--canvas)] p-3 text-sm">Original payment: {money(payment.amount)} · Remaining refundable: <strong>{money(refundable)}</strong></div><Field label="Refund amount"><input required type="number" min="0.01" max={refundable} step="0.01" className={input} value={amount} onChange={(e)=>setAmount(e.target.value)}/></Field><Field label="Refund method"><select className={input} value={method} onChange={(e)=>setMethod(e.target.value)}><option value="cash">Cash</option><option value="mpesa">M-Pesa</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></Field><Field label="Reason"><textarea required className={input} rows="3" value={reason} onChange={(e)=>setReason(e.target.value)}/></Field><p className="text-xs text-[var(--text-muted)]">Refunds are manager-authorised and create a separate negative ledger entry. The original payment remains in history.</p><button disabled={busy||!reason.trim()||Number(amount)<=0||Number(amount)>refundable+0.005} className={btn+" w-full bg-primary text-primary-foreground"}><Undo2 size={15}/> Record refund</button></form></Modal>}
function DiscountModal({onClose,onSubmit,busy}){const [amount,setAmount]=useState('');const [reason,setReason]=useState('');return <Modal title="Apply authorised discount" onClose={onClose}><form onSubmit={(e)=>{e.preventDefault();onSubmit({amount:Number(amount),reason})}} className="space-y-3"><Field label="Discount amount (KES)"><input required type="number" min="0.01" step="0.01" className={input} value={amount} onChange={(e)=>setAmount(e.target.value)}/></Field><Field label="Authorisation / reason"><textarea required rows="3" className={input} value={reason} onChange={(e)=>setReason(e.target.value)}/></Field><button disabled={busy||!reason.trim()||Number(amount)<=0} className={btn+" w-full bg-primary text-primary-foreground"}><ShieldCheck size={15}/> Apply discount</button></form></Modal>}
function TransferModal({reservations,selectedCount,selectedIds,onToggle,charges,targetReservationId,setTargetReservationId,busy,onClose,onSubmit}){const [reason,setReason]=useState('');return <Modal title="Split, transfer or consolidate folio charges" onClose={onClose}><div className="space-y-3"><p className="text-xs text-[var(--text-muted)]">Select posted charges to move to another active guest folio. This updates both account histories and records the transfer in the audit log. Selecting a subset splits the account; selecting all eligible charges consolidates it.</p><div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] p-2">{charges.filter((c)=>!c.reversal_of_id).map((c)=><label key={c.id} className="flex items-center gap-2 py-1 text-xs"><input type="checkbox" checked={selectedIds.includes(c.id)} onChange={()=>onToggle(c.id)}/><span className="flex-1">{c.description}</span><strong>{money(c.amount)}</strong></label>)}</div><Field label="Destination reservation"><select className={input} value={targetReservationId} onChange={(e)=>setTargetReservationId(e.target.value)}><option value="">Select destination guest folio</option>{reservations.map((r)=><option key={r.id} value={r.id}>{r.guest_name} · {r.arrival} · {r.id.slice(0,8)}</option>)}</select></Field><Field label="Transfer reason"><textarea rows="2" className={input} value={reason} onChange={(e)=>setReason(e.target.value)}/></Field><button disabled={busy||selectedCount===0||!targetReservationId||!reason.trim()} onClick={()=>onSubmit(reason)} className={btn+" w-full bg-primary text-primary-foreground"}><ArrowLeftRight size={15}/> Transfer {selectedCount} selected charge(s)</button></div></Modal>}
function Field({label,children}){return <label className="block space-y-1 text-xs font-medium text-[var(--text-muted)]">{label}{children}</label>}
