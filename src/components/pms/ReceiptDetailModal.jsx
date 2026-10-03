import React from 'react';
import { X, Printer } from 'lucide-react';
import { NAVY, TEAL, SURFACE, SURFACE2, BORDER, MUTED } from '@/data/themePalette';
import { printReceipt as printDirectReceipt } from '@/services/printService';

function fmtKes(n) {
	return `KES ${Math.max(0, Number(n) || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
}

const PAYMENT_LABEL = { cash: 'Cash', card: 'Card', mpesa: 'M-Pesa', room: 'Room Charge' };

export default function ReceiptDetailModal({ receipt, onClose }) {
	if (!receipt) return null;
	const items = Array.isArray(receipt.items) ? receipt.items : [];

	const printReceipt = async () => {
		const result = await printDirectReceipt('RECEIPT', {
			propertyId: receipt.property_id || receipt.propertyId,
			orderNumber: receipt.order_number,
			checkNo: receipt.order_number,
			table: receipt.table_number ? `Table ${receipt.table_number}` : '—',
			waiter: receipt.waiter || receipt.waiter_name || 'Unassigned',
			covers: receipt.covers,
			items,
			total: receipt.total,
			currency: 'KES',
			paymentMethod: PAYMENT_LABEL[receipt.payment_method] || receipt.payment_method,
			createdAt: receipt.created_at,
		});
		if (!result.ok) {
			window.alert(result.friendlyError || 'The receipt printer is offline or not configured.');
		}
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