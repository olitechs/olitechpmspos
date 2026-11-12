import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { platformService } from '@/services/platformService';
import { supabase } from '@/lib/supabaseClient';
import { PACKAGE_LABELS } from '@/lib/entitlements';
import { Button } from '@/components/ui/button';
import PackageAssignmentModal from './PackageAssignmentModal';
import { PageDataSkeleton } from '@/components/ui/AppLoadingSkeleton';

const STATUS_STYLES = {
	pending: 'bg-[var(--warning-soft)] text-[var(--warning-text)]',
	active: 'bg-[var(--success-soft)] text-[var(--success-text)]',
	suspended: 'bg-[var(--danger-soft)] text-[var(--danger-text)]',
	rejected: 'bg-secondary text-foreground',
	inactive: 'bg-secondary text-foreground',
	trial: 'bg-primary-soft text-primary-text',
	past_due: 'bg-[var(--warning-soft)] text-[var(--warning-text)]',
	cancelled: 'bg-secondary text-foreground',
	'not configured': 'bg-secondary text-muted-foreground',
};

function StatusBadge({ status }) {
	return <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[status] || ''}`}>{status}</span>;
}

export default function AdminProperties() {
	const [properties, setProperties] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [busyId, setBusyId] = useState(null);
	const [packageDialog, setPackageDialog] = useState(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			setProperties(await platformService.listProperties());
		} catch (err) {
			setError(err.message);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
		const channel = supabase
			.channel('platform-properties-live')
			.on('postgres_changes', { event: '*', schema: 'public', table: 'properties' }, () => load())
			.on('postgres_changes', { event: '*', schema: 'public', table: 'property_subscriptions' }, () => load())
			.subscribe();
		return () => { supabase.removeChannel(channel); };
	}, [load]);

	const withBusy = async (id, fn) => {
		setBusyId(id);
		try {
			await fn();
			await load();
		} catch (err) {
			setError(err.message);
		} finally {
			setBusyId(null);
		}
	};

	const approve = (p) => setPackageDialog({ property: p, mode: 'approve' });

	const confirmPackage = (pkg) => {
		const dialog = packageDialog;
		if (!dialog) return;
		setPackageDialog(null);
		withBusy(dialog.property.id, () =>
			dialog.mode === 'approve'
				? platformService.approve(dialog.property.id, pkg)
				: platformService.setPackage(dialog.property.id, pkg, dialog.property.package)
		);
	};

	const setStatus = (p, status) => {
		// eslint-disable-next-line no-alert
		if (!window.confirm(`Set "${p.name}" to ${status}?`)) return;
		withBusy(p.id, () => platformService.setStatus(p.id, status, p.status));
	};

	const changePackage = (p) => setPackageDialog({ property: p, mode: 'change' });

	return (
		<div className="space-y-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold text-foreground">Properties</h1>
					<p className="text-sm text-muted-foreground mt-1">Review applications, approve, manage packages, subscriptions and live property access.</p>
				</div>
				<Link to="/admin/properties/new" className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium">+ Add Property</Link>
			</div>

			{error && <div className="p-4 rounded-xl bg-destructive/10 text-destructive text-sm">{error}</div>}

			<div className="bg-card border border-border rounded-2xl overflow-hidden">
				<table className="w-full text-sm">
					<thead className="bg-muted/40 text-muted-foreground text-left">
						<tr>
							<th className="px-4 py-3 font-medium">Property</th>
							<th className="px-4 py-3 font-medium">Status</th>
							<th className="px-4 py-3 font-medium">Package</th>
							<th className="px-4 py-3 font-medium">Subscription / Entitlements</th>
							<th className="px-4 py-3 font-medium">Created</th>
							<th className="px-4 py-3 font-medium text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{loading && (
							<tr>
								<td colSpan={6} className="p-3">
									<PageDataSkeleton variant="table" rows={6}/
								</td>
							</tr>
						)}
						{!loading && properties.length === 0 && (
							<tr>
								<td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
									No properties yet.
								</td>
							</tr>
						)}
						{properties.map((p) => (
							<tr key={p.id} className="border-t border-border">
								<td className="px-4 py-3">
									<Link to={`/admin/properties/${p.id}`} className="font-medium text-foreground hover:underline">
										{p.name}
									</Link>
									{p.business_name && <div className="text-xs text-muted-foreground">{p.business_name}</div>}
								{(p.owner_full_name || p.owner_email) && <div className="text-xs text-muted-foreground mt-1">Owner: {p.owner_full_name || p.owner_email}</div>}
								</td>
								<td className="px-4 py-3">
									<StatusBadge status={p.status} />
								</td>
								<td className="px-4 py-3">
									<div>{PACKAGE_LABELS[p.package] || 'No Package'}</div>
									{p.subscription_plan_code && p.subscription_plan_code !== p.package && (
										<div className="text-xs text-muted-foreground mt-0.5">Plan: {p.subscription_plan_code}</div>
									)}
								</td>
								<td className="px-4 py-3">
									<div className="flex items-center gap-2">
										<StatusBadge status={p.subscription_status || 'not configured'} />
										<Link to={`/admin/properties/${p.id}`} className="text-xs font-medium text-primary hover:underline">View subscription</Link>
									</div>
									{p.current_period_ends_at && <div className="text-xs text-muted-foreground mt-1">Ends {new Date(p.current_period_ends_at).toLocaleDateString()}</div>}
								</td>
								<td className="px-4 py-3 text-muted-foreground">{new Date(p.created_at).toLocaleDateString()}</td>
								<td className="px-4 py-3">
									<div className="flex justify-end gap-2">
										{p.status === 'pending' && (
											<>
												<Button size="sm" disabled={busyId === p.id} onClick={() => approve(p)}>
													Approve
												</Button>
												<Button size="sm" variant="outline" disabled={busyId === p.id} onClick={() => setStatus(p, 'rejected')}>
													Reject
												</Button>
											</>
										)}
										{p.status === 'active' && (
											<>
												<Button size="sm" variant="outline" disabled={busyId === p.id} onClick={() => changePackage(p)}>
													Change Package
												</Button>
												<Button size="sm" variant="outline" disabled={busyId === p.id} onClick={() => setStatus(p, 'suspended')}>
													Suspend
												</Button>
											</>
										)}
										{(p.status === 'suspended' || p.status === 'inactive') && (
											<Button size="sm" disabled={busyId === p.id} onClick={() => setStatus(p, 'active')}>
												Reactivate
											</Button>
										)}
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{packageDialog && (
				<PackageAssignmentModal
					property={packageDialog.property}
					mode={packageDialog.mode}
					busy={busyId === packageDialog.property.id}
					onClose={() => setPackageDialog(null)}
					onConfirm={confirmPackage}
				/>
			)}
		</div>
	);
}
