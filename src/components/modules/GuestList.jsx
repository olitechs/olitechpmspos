import React, { useState } from 'react';
import { Search, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { usePmsGuestHistoryQuery, usePmsGuestsQuery } from '@/hooks/usePmsQuery';
import { NAVY, TEAL_DARK, SAND, SURFACE, SURFACE2, BORDER, MUTED } from '@/data/themePalette';

const money = (value) => `KES ${Number(value || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

export default function GuestList() {
	const { user } = useAuth();
	const propertyId = user?.property?.id;
	const [query, setQuery] = useState('');
	const [selected, setSelected] = useState(null);
	const guestsQuery = usePmsGuestsQuery(propertyId);
	const historyQuery = usePmsGuestHistoryQuery({ propertyId, guestId: selected?.id });
	const guests = guestsQuery.data || [];
	const loading = guestsQuery.isLoading;
	const error = guestsQuery.error?.message || '';

	const filtered = guests.filter((g) => {
		const q = query.trim().toLowerCase();
		return !q || [g?.name, g?.email, g?.phone].some((v) => String(v || '').toLowerCase().includes(q));
	});

	return (
		<div className="flex-1 overflow-y-auto p-4" style={{ background: SAND }}>
			<div className="mb-4 flex items-center gap-2 rounded-xl px-4 py-3" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
				<Search size={16} style={{ color: MUTED }} />
				<input type="text" placeholder="Search guests by name or email…" value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1 bg-transparent text-sm outline-none" style={{ color: NAVY }} />
			</div>
			{error && <div className="mb-3 text-xs" style={{ color: MUTED }}>{error}</div>}
			<div className="overflow-hidden rounded-2xl" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
				<table className="w-full text-sm">
					<thead><tr style={{ background: SURFACE2, borderBottom: `1px solid ${BORDER}` }}>{['Guest', 'Country', 'Visits', 'Last Visit', 'Total Spend', ''].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide" style={{ color: MUTED }}>{h}</th>)}</tr></thead>
					<tbody>
						{loading && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm" style={{ color: MUTED }}>Loading guests…</td></tr>}
						{!loading && filtered.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm" style={{ color: MUTED }}>No guests yet — they'll appear here after a check-in.</td></tr>}
						{filtered.map((g, i) => (
							<tr key={g.id} style={{ borderBottom: `1px solid ${BORDER}`, background: i % 2 === 0 ? SURFACE : SURFACE2 }}>
								<td className="px-4 py-3"><div className="flex items-center gap-2"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ background: `${NAVY}14`, color: NAVY }}>{String(g?.name || 'Guest').split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2) || 'G'}</div><div><div className="font-medium" style={{ color: NAVY }}>{g.name}</div><div className="text-xs" style={{ color: MUTED }}>{g.email || g.phone || '—'}</div></div></div></td>
								<td className="px-4 py-3 text-xs" style={{ color: MUTED }}>{g.country || g.nationality || '—'}</td>
								<td className="px-4 py-3 font-mono text-xs font-bold" style={{ color: NAVY }}>{g.visits}</td>
								<td className="px-4 py-3 text-xs" style={{ color: MUTED }}>{g.last_visit || '—'}</td>
								<td className="px-4 py-3 font-mono text-xs font-bold" style={{ color: TEAL_DARK }}>{money(g.total_spend)}</td>
								<td className="px-4 py-3"><button className="rounded-lg px-3 py-1 text-xs" style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: MUTED }} onClick={() => setSelected(g)}>View</button></td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{selected && <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="dialog" aria-modal="true" aria-label="Guest profile">
				<div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
					<div className="sticky top-0 z-10 flex items-center justify-between border-b px-5 py-4" style={{ background: SURFACE, borderColor: BORDER }}>
						<div><div className="text-lg font-bold" style={{ color: NAVY }}>{selected.name}</div><div className="text-xs" style={{ color: MUTED }}>{selected.email || selected.phone || 'Guest profile'}</div></div>
						<button onClick={() => setSelected(null)} aria-label="Close guest profile"><X size={18} style={{ color: MUTED }} /></button>
					</div>
					<div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
						<ProfileMetric label="Visits" value={selected.visits} /><ProfileMetric label="Spend" value={money(selected.total_spend)} /><ProfileMetric label="Phone" value={selected.phone || '—'} /><ProfileMetric label="Country" value={selected.country || selected.nationality || '—'} />
					</div>
					<div className="px-5 pb-6">
						<h2 className="mb-3 text-xs font-bold uppercase tracking-wide" style={{ color: MUTED }}>Stay history</h2>
						{historyQuery.isLoading ? <div className="py-8 text-center text-sm" style={{ color: MUTED }}>Loading stay history…</div> :
						 historyQuery.isError ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{historyQuery.error.message}</div> :
						 !historyQuery.data?.length ? <div className="py-8 text-center text-sm" style={{ color: MUTED }}>No reservation history recorded.</div> :
						 <div className="space-y-2">{historyQuery.data.map((stay) => <div key={stay.id} className="rounded-xl p-4" style={{ background: SURFACE2, border: `1px solid ${BORDER}` }}>
							<div className="flex items-center justify-between gap-3"><div className="font-semibold" style={{ color: NAVY }}>{stay.arrival} → {stay.departure}</div><span className="rounded-full px-2 py-1 text-[10px] font-bold uppercase" style={{ background: SURFACE, color: MUTED }}>{stay.status}</span></div>
							<div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4" style={{ color: MUTED }}><span>Room {stay.room_id?.slice(0, 8) || '—'}</span><span>{stay.channel || '—'}</span><span>{money(stay.total_amount ?? stay.rate)}</span><span>{stay.payment_status || '—'}</span></div>
						</div>)}</div>}
					</div>
				</div>
			</div>}
		</div>
	);
}

function ProfileMetric({ label, value }) {
	return <div className="rounded-xl p-3" style={{ background: SURFACE2, border: `1px solid ${BORDER}` }}><div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{label}</div><div className="mt-1 truncate text-sm font-semibold" style={{ color: NAVY }}>{value}</div></div>;
}
