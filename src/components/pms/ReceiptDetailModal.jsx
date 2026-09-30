import React from 'react';
import { X, Printer } from 'lucide-react';
import { NAVY, TEAL, SURFACE, SURFACE2, BORDER, MUTED } from '@/data/themePalette';

function fmtKes(n) {
	return `KES ${Math.max(0, Number(n) || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
}

const PAYMENT_LABEL = { cash: 'Cash', card: 'Card', mpesa: 'M-Pesa', room: 'Room Charge' };

export default function ReceiptDetailModal({ receipt, onClose }) {
	if (!receipt) return null;
	const items = Array.isArray(receipt.items) ? receipt.items : [];

	const printReceipt = () => {
		const rows = items.map((l) => `<tr><td>${String(l.name || '').replace(/[<>]/g, '')}</td><td>${l.qty}</td><td style="text-align:right">KES ${(Number(l.price || 0) * Number(l.qty || 0)).toLocaleString('en-KE')}</td></tr>`).join('');
		const w = window.open('', '_blank', 'width=420,height=760');
		if (!w) return;
		w.document.write(`<!doctype html><html><head><title>Receipt ${receipt.order_number || ''}</title><style>@page{size:80mm auto;margin:4mm}body{width:72mm;font-family:Arial,sans-serif;color:#090C11;font-size:11px;margin:0}h2{text-align:center;font-size:15px;margin:0 0 4px}p{margin:2px 0;text-align:center;font-size:10px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{padding:4px 0;border-bottom:1px dashed #ccc}th{text-align:left}.totals{margin-top:8px}.row{display:flex;justify-content:space-between;padding:2px 0}.total{font-size:14px;font-weight:900;border-top:2px solid #090C11;margin-top:4px;padding-top:5px}</style></head><body><h2>VISIWA BEACH RESORT</h2><p>${receipt.order_number || ''} · Table ${receipt.table_number || '—'}</p><p>${new Date(receipt.created_at).toLocaleString('en-KE')}</p>${receipt.room_number ? `<p>Room ${receipt.room_number} — ${receipt.guest_name || ''}</p>` : ''}<table><thead><tr><th>Item</th><th>Qty</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="totals"><div class="row"><span>Subtotal</span><b>KES ${Number(receipt.subtotal || 0).toLocaleString('en-KE')}</b></div>${Number(receipt.discount_amount) > 0 ? `<div class="row"><span>Discount</span><b>- KES ${Number(receipt.discount_amount).toLocaleString('en-KE')}</b></div>` : ''}<div class="row"><span>VAT</span><b>KES ${Number(receipt.vat || 0).toLocaleString('en-KE')}</b></div><div class="row total"><span>TOTAL</span><b>KES ${Number(receipt.total || 0).toLocaleString('en-KE')}</b></div></div><p style="margin-top:12px">Paid via: ${PAYMENT_LABEL[receipt.payment_method] || receipt.payment_method}</p><p>Receipt ID: ${receipt.id}</p><script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script></body></html>`);
		w.document.close();
	};

	return (
		<div className="fixed inset-0 z-[110] bg-black/40 flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-2xl shadow-2xl" style={{ background: SURFACE }}>
				<div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4" style={{ background: SURFACE, borderBottom: `1px solid ${BORDER}` }}>
					<h2 className="text-base font-bold" style={{ color: NAVY }}>Receipt {receipt.order_number || ''}</h2>
					<button onClick={onClose} className="p-2 rounded-lg" style={{ color: MUTED }}><X size={18} /></button>
				</div>
				<div className="p-5 space-y-4">
					<div className="text-xs space-y-0.5" style={{ color: MUTED }}>
						<div>{new Date(receipt.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}</div>
						<div>Table {receipt.table_number || '—'}{receipt.room_number ? ` · Room ${receipt.room_number} — ${receipt.guest_name || ''}` : ''}</div>
						<div>Paid via: <b style={{ color: NAVY }}>{PAYMENT_LABEL[receipt.payment_method] || receipt.payment_method}</b></div>
					</div>
					<div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
						{items.length ? items.map((l, i) => (
							<div key={i} className="flex justify-between px-3 py-2 text-sm" style={{ borderBottom: `1px solid ${BORDER}`, background: i % 2 ? SURFACE2 : SURFACE }}>
								<span>{l.qty}x {l.name}</span>
								<b>{fmtKes(Number(l.price || 0) * Number(l.qty || 0))}</b>
							</div>
						)) : <div className="p-4 text-sm text-center" style={{ color: MUTED }}>No line items recorded.</div>}
					</div>
					<div className="space-y-1 text-sm" style={{ color: NAVY }}>
						<div className="flex justify-between"><span style={{ color: MUTED }}>Subtotal</span><span>{fmtKes(receipt.subtotal)}</span></div>
						{Number(receipt.discount_amount) > 0 && <div className="flex justify-between"><span style={{ color: MUTED }}>Discount</span><span>- {fmtKes(receipt.discount_amount)}</span></div>}
						<div className="flex justify-between"><span style={{ color: MUTED }}>VAT</span><span>{fmtKes(receipt.vat)}</span></div>
						<div className="flex justify-between pt-1 font-bold" style={{ borderTop: `1px solid ${BORDER}` }}><span>Total</span><span>{fmtKes(receipt.total)}</span></div>
					</div>
					<div className="flex justify-end gap-2 pt-2">
						<button onClick={onClose} className="px-4 py-2 rounded-lg text-sm" style={{ border: `1px solid ${BORDER}`, color: MUTED }}>Close</button>
						<button onClick={printReceipt} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold" style={{ background: TEAL, color: '#090C11' }}><Printer size={14} /> Print Receipt</button>
					</div>
				</div>
			</div>
		</div>
	);
}