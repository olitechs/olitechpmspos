import React, { useEffect, useState, useCallback } from 'react';
import { Wrench, Plus } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { usePms } from '@/data/PmsStore';
import { pmsService } from '@/services/pmsService';
import FeatureGate from '@/lib/FeatureGate';
import { NAVY, TEAL, SAND, SURFACE, SURFACE2, BORDER, MUTED, DESTRUCTIVE } from '@/data/themePalette';

const PRIORITY_COLOR = { low: MUTED, medium: '#D9A441', high: DESTRUCTIVE };
const STATUS_FLOW = { open: 'assigned', assigned: 'in_progress', in_progress: 'resolved', resolved: 'closed' };
const STATUS_LABEL = { open: 'Open', assigned: 'Assigned', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' };

function MaintenanceInner() {
	const { user } = useAuth();
	const pms = usePms();
	const propertyId = user?.property?.id;

	const [tickets, setTickets] = useState([]);
	const [loading, setLoading] = useState(true);
	const [issue, setIssue] = useState('');
	const [roomId, setRoomId] = useState('');
	const [priority, setPriority] = useState('medium');
	const [returnStatus, setReturnStatus] = useState('dirty');
	const [resolutionNotes, setResolutionNotes] = useState('');
	const [error, setError] = useState('');

	const load = useCallback(() => {
		if (!propertyId) { setLoading(false); return; }
		setLoading(true);
		pmsService
			.listMaintenanceTickets(propertyId)
			.then(setTickets)
			.catch((err) => setError(err.message))
			.finally(() => setLoading(false));
	}, [propertyId]);

	useEffect(() => {
		load();
	}, [load]);

	const submit = async () => {
		if (!issue) {
			setError('Describe the issue first.');
			return;
		}
		try {
			await pmsService.createMaintenanceTicket({ propertyId, roomId: roomId || null, issue, priority });
			setIssue('');
			setRoomId('');
			setPriority('medium');
			setError('');
			load();
		} catch (err) {
			setError(err.message);
		}
	};

	const advance = async (ticket) => {
		const next = STATUS_FLOW[ticket.status];
		if (!next) return;
		try {
			await pmsService.updateMaintenanceTicket(ticket.id, {
				status: next,
				returnStatus: next === 'resolved' || next === 'closed' ? returnStatus : null,
				resolutionNotes: next === 'resolved' || next === 'closed' ? resolutionNotes : null,
			});
			setError('');
			load();
		} catch (err) {
			setError(err?.message || 'Could not update maintenance ticket.');
		}
	};

	return (
		<div className="flex-1 overflow-y-auto p-4" style={{ background: SAND }}>
			<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
				<div className="lg:col-span-1 rounded-2xl p-4 h-fit" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
					<div className="flex items-center gap-2 mb-4">
						<Wrench size={16} style={{ color: NAVY }} />
						<h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: MUTED }}>New Ticket</h3>
					</div>

					<label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Room (optional)</label>
					<select value={roomId} onChange={(e) => setRoomId(e.target.value)}
						className="w-full px-3 py-2.5 rounded-lg mb-3 text-sm outline-none"
						style={{ background: SURFACE2, border: `1.5px solid ${BORDER}`, color: NAVY }}>
						<option value="">General / not room-specific</option>
						{(pms?.rooms || []).map((r) => (
							<option key={r.id} value={r.id}>Room {r.number}</option>
						))}
					</select>

					<label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Issue *</label>
					<textarea value={issue} onChange={(e) => setIssue(e.target.value)} rows={3}
						className="w-full px-3 py-2.5 rounded-lg mb-3 text-sm outline-none"
						style={{ background: SURFACE2, border: `1.5px solid ${BORDER}`, color: NAVY }} />

					<label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Priority</label>
					<select value={priority} onChange={(e) => setPriority(e.target.value)}
						className="w-full px-3 py-2.5 rounded-lg mb-4 text-sm outline-none"
						style={{ background: SURFACE2, border: `1.5px solid ${BORDER}`, color: NAVY }}>
						<option value="low">Low</option>
						<option value="medium">Medium</option>
						<option value="high">High</option>
					</select>

					{error && <div className="text-xs mb-3" style={{ color: DESTRUCTIVE }}>{error}</div>}

					<button onClick={submit} className="w-full flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-bold" style={{ background: TEAL, color: '#090C11' }}>
						<Plus size={14} /> Create Ticket
					</button>
				</div>

				<div className="lg:col-span-2 rounded-2xl overflow-hidden h-fit" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
					<div className="px-4 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
						<h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: MUTED }}>Open Tickets</h3>
					</div>
					{loading && <div className="px-4 py-6 text-center text-sm" style={{ color: MUTED }}>Loading…</div>}
					{!loading && tickets.length === 0 && <div className="px-4 py-6 text-center text-sm" style={{ color: MUTED }}>No maintenance tickets.</div>}
					{tickets.map((t) => (
						<div key={t.id} className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
							<span className="w-2 h-2 rounded-full shrink-0" style={{ background: PRIORITY_COLOR[t.priority] }} />
							<div className="min-w-0 flex-1">
								<div className="text-sm font-medium truncate" style={{ color: NAVY }}>
									{t.room ? `Room ${t.room.number} — ` : ''}{t.issue}
								</div>
								<div className="text-xs" style={{ color: MUTED }}>{STATUS_LABEL[t.status]} · {t.priority}</div>
							</div>
							{(t.status === 'in_progress' || t.status === 'resolved') && (
								<div className="flex items-center gap-2 shrink-0">
									<select value={returnStatus} onChange={(e) => setReturnStatus(e.target.value)} className="text-xs px-2 py-1.5 rounded-lg" style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: NAVY }} aria-label="Room return status">
										<option value="dirty">Return dirty</option><option value="available">Return available</option>
									</select>
									<input value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} placeholder="Resolution note" className="text-xs px-2 py-1.5 rounded-lg w-32" style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: NAVY }} aria-label="Resolution note" />
								</div>
							)}
							{t.status !== 'closed' && (
								<button onClick={() => advance(t)} className="text-xs font-bold px-3 py-1.5 rounded-lg shrink-0" style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: NAVY }}>
									Mark {STATUS_LABEL[STATUS_FLOW[t.status]]}
								</button>
							)}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

export default function Maintenance() {
	return (
		<FeatureGate feature="maintenance">
			<MaintenanceInner />
		</FeatureGate>
	);
}
