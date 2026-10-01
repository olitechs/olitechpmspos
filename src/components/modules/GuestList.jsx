import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { usePmsGuestsQuery } from '@/hooks/usePmsQuery';
import { NAVY, TEAL_DARK, SAND, SURFACE, SURFACE2, BORDER, MUTED } from '@/data/themePalette';

export default function GuestList() {
	const { user } = useAuth();
	const propertyId = user?.property?.id;
	const [query, setQuery] = useState('');
	const guestsQuery = usePmsGuestsQuery(propertyId);
	const guests = guestsQuery.data || [];
	const loading = guestsQuery.isLoading;
	const error = guestsQuery.error?.message || '';

	const filtered = guests.filter((g) => {
		const name = String(g?.name || '');
		const email = String(g?.email || '');
		const phone = String(g?.phone || '');
		const q = query.trim().toLowerCase();
		return !q || name.toLowerCase().includes(q) || email.toLowerCase().includes(q) || phone.toLowerCase().includes(q);
	});

	return (
		<div className="flex-1 overflow-y-auto p-4" style={{ background: SAND }}>
			<div className="flex items-center gap-2 rounded-xl px-4 py-3 mb-4" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
				<Search size={16} style={{ color: MUTED }} />
				<input
					type="text" placeholder="Search guests by name or email…" value={query}
					onChange={(e) => setQuery(e.target.value)}
					className="flex-1 bg-transparent outline-none text-sm" style={{ color: NAVY }}
				/>
			</div>

			{error && <div className="text-xs mb-3" style={{ color: MUTED }}>{error}</div>}

			<div className="rounded-2xl overflow-hidden" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
				<table className="w-full text-sm">
					<thead>
						<tr style={{ background: SURFACE2, borderBottom: `1px solid ${BORDER}` }}>
							{['Guest', 'Country', 'Visits', 'Last Visit', 'Total Spend', ''].map((h) => (
								<th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: MUTED }}>{h}</th>
							))}
						</tr>
					</thead>
					<tbody>
						{loading && (
							<tr><td colSpan={6} className="px-4 py-6 text-center text-sm" style={{ color: MUTED }}>Loading guests…</td></tr>
						)}
						{!loading && filtered.length === 0 && (
							<tr><td colSpan={6} className="px-4 py-6 text-center text-sm" style={{ color: MUTED }}>No guests yet — they'll appear here after a check-in.</td></tr>
						)}
						{filtered.map((g, i) => (
							<tr key={g.id} style={{ borderBottom: `1px solid ${BORDER}`, background: i % 2 === 0 ? SURFACE : SURFACE2 }}>
								<td className="px-4 py-3">
									<div className="flex items-center gap-2">
										<div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: `${NAVY}14`, color: NAVY }}>
											{String(g?.name || 'Guest').split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2) || 'G'}
										</div>
										<div>
											<div className="font-medium" style={{ color: NAVY }}>{g.name}</div>
											<div className="text-xs" style={{ color: MUTED }}>{g.email || g.phone || '—'}</div>
										</div>
									</div>
								</td>
								<td className="px-4 py-3 text-xs" style={{ color: MUTED }}>{g.country || '—'}</td>
								<td className="px-4 py-3 font-mono text-xs font-bold" style={{ color: NAVY }}>{g.visits}</td>
								<td className="px-4 py-3 text-xs" style={{ color: MUTED }}>{g.last_visit || '—'}</td>
								<td className="px-4 py-3 font-mono text-xs font-bold" style={{ color: TEAL_DARK }}>KES {Number(g.total_spend || 0).toLocaleString()}</td>
								<td className="px-4 py-3">
									<button className="text-xs px-3 py-1 rounded-lg" style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: MUTED }}>View</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
