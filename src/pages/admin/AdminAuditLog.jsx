import { useEffect, useState } from 'react';
import { platformService } from '@/services/platformService';
import { PageDataSkeleton } from '@/components/ui/AppLoadingSkeleton';

export default function AdminAuditLog() {
	const [entries, setEntries] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');

	useEffect(() => {
		platformService
			.listAuditLog()
			.then(setEntries)
			.catch((err) => setError(err.message))
			.finally(() => setLoading(false));
	}, []);

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold text-foreground">Audit Log</h1>
					<p className="text-sm text-muted-foreground mt-1">Platform actions and property-scoped report exports in an append-only record.</p>
			</div>

			{error && <div className="p-4 rounded-xl bg-destructive/10 text-destructive text-sm">{error}</div>}

			<div className="bg-card border border-border rounded-2xl divide-y divide-border">
				{loading && <div className="p-4"><PageDataSkeleton variant="list" rows={6}/></div>}
				{!loading && entries.length === 0 && <div className="px-4 py-6 text-center text-muted-foreground text-sm">No activity recorded yet.</div>}
					{entries.map((entry) => {
						const details = entry.action === 'report_exported' ? entry.new_value || {} : null;
						const filters = Object.entries(details?.filters || {}).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join(' · ');
						return (
							<div key={entry.id} className="px-4 py-3 text-sm flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
								<div>
									<span className="font-medium text-foreground capitalize">{entry.action.replace(/_/g, ' ')}</span>
									<span className="text-muted-foreground"> by {entry.actor_full_name || entry.actor?.full_name || entry.actor_email || entry.actor?.email || 'system'}</span>
									{details?.report_key && <div className="mt-1 text-xs text-muted-foreground">{details.report_key} · {String(details.file_format || '').toUpperCase()} · {(Number(details.row_count) || 0).toLocaleString()} rows · Property {entry.property_id || '—'}</div>}
									{filters && <div className="text-xs text-muted-foreground">Filters: {filters}</div>}
								</div>
								<time className="shrink-0 text-xs text-muted-foreground" dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString()}</time>
							</div>
						);
					})}
			</div>
		</div>
	);
}
