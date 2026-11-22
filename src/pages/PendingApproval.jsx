import { useState } from 'react';
import { Clock, ShieldAlert, XCircle, Hotel, RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { PACKAGE_LABELS } from '@/lib/entitlements';
import { Button } from '@/components/ui/button';

const STATUS_COPY = {
	pending: {
		icon: Clock,
		title: 'Your property application has been received',
		body: 'Status: Pending Approval. The OliTechs administrator will review your property and activate your account.',
	},
	rejected: {
		icon: XCircle,
		title: 'Your property application was not approved',
		body: 'Contact OliTechs support if you believe this is a mistake.',
	},
	suspended: {
		icon: ShieldAlert,
		title: 'This property is currently suspended',
		body: 'Access has been temporarily paused by the platform administrator. Your data has not been deleted.',
	},
	inactive: {
		icon: ShieldAlert,
		title: 'This property is inactive',
		body: 'Contact the OliTechs administrator to reactivate this property.',
	},
};

export default function PendingApproval() {
	const { user, logout, checkUserAuth } = useAuth();
	const [retrying, setRetrying] = useState(false);
	const retryAccountLookup = async () => {
		if (retrying) return;
		setRetrying(true);
		try { await checkUserAuth(); } finally { setRetrying(false); }
	};
	const property = user?.property;
	const status = property?.status || 'pending';
	const copy = STATUS_COPY[status] || STATUS_COPY.pending;
	const Icon = copy.icon;

	if (!property) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-background px-4">
				<div className="w-full max-w-md text-center bg-card rounded-2xl border border-border p-8">
					<h1 className="text-xl font-bold text-foreground">Application not found</h1>
					<p className="text-sm text-muted-foreground mt-2">We could not load the property linked to this account. Your account and property data have not been deleted. Retry the account lookup; if the problem continues, contact your property administrator.</p>
					<div className="mt-6 space-y-2">
						<Button className="w-full" onClick={retryAccountLookup} disabled={retrying}>
							<RefreshCw className={`mr-2 h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
							{retrying ? 'Retrying…' : 'Retry account lookup'}
						</Button>
						<Button variant="outline" className="w-full" onClick={logout}>Sign out</Button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen flex items-center justify-center bg-background px-4">
			<div className="w-full max-w-md text-center">
				<div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4">
					<Hotel className="w-7 h-7 text-primary-foreground" aria-hidden="true" />
				</div>
				<div className="bg-card rounded-2xl shadow-sm border border-border p-8">
					<Icon className="w-8 h-8 mx-auto text-muted-foreground mb-3" aria-hidden="true" />
					<h1 className="text-xl font-bold text-foreground">{copy.title}</h1>
					<p className="text-sm text-muted-foreground mt-2">{copy.body}</p>

					<div className="mt-6 space-y-2 text-left bg-muted/40 rounded-xl p-4 text-sm">
						<div className="flex justify-between">
							<span className="text-muted-foreground">Property</span>
							<span className="font-medium">{property?.name || '—'}</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">Status</span>
							<span className="font-medium capitalize">{status}</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">Package</span>
							<span className="font-medium">{PACKAGE_LABELS[property?.package || 'none']}</span>
						</div>
					</div>

					<Button variant="outline" className="w-full mt-6" onClick={logout}>
						Sign out
					</Button>
				</div>
			</div>
		</div>
	);
}
