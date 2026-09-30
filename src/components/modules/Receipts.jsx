import React, { useEffect, useState } from 'react';
import { Loader2, Receipt as ReceiptIcon } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';
import ReceiptDetailModal from '@/components/pms/ReceiptDetailModal';
import { NAVY, TEAL, BORDER, SAND, SURFACE, SURFACE2, MUTED } from '@/data/themePalette';

const PAYMENT_LABEL = { cash: 'Cash', card: 'Card', mpesa: 'M-Pesa', room: 'Room Charge' };

export default function Receipts() {
	const { user } = useAuth();
	const propertyId = user?.property?.id;
	const [receipts, setReceipts] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [view, setView] = useState(null);

	useEffect(() => {
		if (!propertyId) return;
		let alive = true;
		setLoading(true);
		pmsService.listReceiptsForProperty(propertyId)
			.then((rows) => { if (alive) setReceipts(rows); })
			.catch((e) => { if (alive) setError(e.message); })
			.finally(() => { if (alive) setLoading(false); });
		return () => { alive = false; };
	}, [propertyId]);

	return (
		<div className="flex-1 overflow-y-auto p-4" style={{ background: SAND }}>
			<div className="flex items-center justify-between mb-4">
				<div>
					<h2 className="text-lg font-bold" style={{ color: NAVY }}>Receipts</h2>
					<p className="text-xs" style={{ color: MUTED }}>Every POS sale — cash, card, M-Pesa, and room charges.</p>
				</div>
			</div>
			{loading && <div className="flex items-center gap-2 text-sm p-6 justify-center" style={{ color: MUTED }}><Loader2 size={16} className="animate-spin" /> Loading receipts…</div>}
			{error && <div className="text-xs p-3 rounded-lg mb-3" style={{ background: '#FDECEC', color: '#C0392B' }}>{error}</div>}
			{!loading && !error && (
				<div className="rounded-2xl overflow-hidden" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
					{receipts.length === 0 ? (
						<div className="p-10 text-center text-sm" style={{ color: MUTED }}>
							<ReceiptIcon size={28} className="mx-auto mb-2" style={{ color: BORDER }} />
							No receipts yet.
						</div>
					) : receipts.map((r, i) => (
						<button key={r.id} onClick={() => setView(r)} className="w-full flex items-center justify-between px-4 py-3 text-left" style={{ borderBottom: `1px solid ${BORDER}`, background: i % 2 ? SURFACE2 : SURFACE }}>
							<div className="min-w-0">
								<div className="text-sm font-semibold truncate" style={{ color: NAVY }}>{r.order_number} · Table {r.table_number}</div>
								<div className="text-xs mt-0.5" style={{ color: MUTED }}>
									{new Date(r.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}
									{r.room_number ? ` · Room ${r.room_number} — ${r.guest_name || ''}` : ''}
								</div>
							</div>
							<div className="flex items-center gap-3 shrink-0 pl-3">
								<span className="text-[10px] font-bold uppercase px-2 py-1 rounded-full" style={{ background: r.payment_method === 'room' ? TEAL : SURFACE2, color: NAVY, border: `1px solid ${BORDER}` }}>{PAYMENT_LABEL[r.payment_method] || r.payment_method}</span>
								<b className="font-mono text-sm" style={{ color: NAVY }}>KES {Number(r.total).toLocaleString()}</b>
							</div>
						</button>
					))}
				</div>
			)}
			{view && <ReceiptDetailModal receipt={view} onClose={() => setView(null)} />}
		</div>
	);
}