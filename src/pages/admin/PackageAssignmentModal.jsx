import { useState } from 'react';
import { Check, Crown, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PACKAGES = [
	{
		id: 'standard',
		name: 'Standard',
		price: 'Core PMS + POS',
		icon: Sparkles,
		description: 'Essential hotel operations for smaller properties.',
		features: ['Rooms & reservations', 'Guests & check-in/out', 'Basic POS & payments', 'Basic reports'],
	},
	{
		id: 'premium',
		name: 'Premium',
		price: 'Advanced operations',
		icon: Crown,
		description: 'More automation and operational controls for growing properties.',
		features: ['Everything in Standard', 'Inventory & maintenance', 'Revenue analytics', 'Staff management & advanced POS'],
	},
	{
		id: 'professional',
		name: 'Professional',
		price: 'Full platform',
		icon: Crown,
		description: 'The complete OliTechs feature set for larger operations.',
		features: ['Everything in Premium', 'Advanced user permissions', 'Audit log access', 'Complete feature set'],
	},
];

export default function PackageAssignmentModal({ property, mode = 'approve', busy = false, onClose, onConfirm }) {
	const initial = property?.package && property.package !== 'none' ? property.package : 'standard';
	const [selected, setSelected] = useState(initial);
	const isApproval = mode === 'approve';

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)] p-4" role="dialog" aria-modal="true" aria-labelledby="package-dialog-title">
			<div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl">
				<div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-card px-6 py-5">
					<div>
						<h2 id="package-dialog-title" className="text-lg font-bold text-foreground">
							{isApproval ? 'Approve property & assign package' : 'Change property package'}
						</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							{property?.name} · {isApproval ? 'Choose the package to activate this property.' : 'Choose the new package for this property.'}
						</p>
					</div>
					<button type="button" onClick={onClose} disabled={busy} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
						<X className="h-5 w-5" />
					</button>
				</div>

				<div className="grid gap-3 p-6 md:grid-cols-3">
					{PACKAGES.map((pkg) => {
						const Icon = pkg.icon;
						const active = selected === pkg.id;
						return (
							<button
								key={pkg.id}
								type="button"
								onClick={() => setSelected(pkg.id)}
								className={`relative rounded-xl border p-4 text-left transition-all ${active ? 'border-primary ring-2 ring-primary/20 bg-primary/5' : 'border-border hover:border-primary/40'}`}
							>
								{active && <span className="absolute right-3 top-3 rounded-full bg-primary p-1 text-primary-foreground"><Check className="h-3 w-3" /></span>}
								<div className="mb-3 flex items-center gap-2">
									<div className="rounded-lg bg-muted p-2"><Icon className="h-4 w-4" /></div>
									<div><div className="font-semibold text-foreground">{pkg.name}</div><div className="text-xs text-muted-foreground">{pkg.price}</div></div>
								</div>
								<p className="mb-3 text-xs leading-5 text-muted-foreground">{pkg.description}</p>
								<ul className="space-y-1.5 text-xs text-foreground">
									{pkg.features.map((feature) => <li key={feature} className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />{feature}</li>)}
								</ul>
							</button>
						);
					})}
				</div>

				<div className="flex justify-end gap-2 border-t border-border bg-muted/20 px-6 py-4">
					<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
					<Button onClick={() => onConfirm(selected)} disabled={busy}>
						{busy ? 'Saving...' : isApproval ? `Approve & activate on ${PACKAGES.find((p) => p.id === selected)?.name}` : `Assign ${PACKAGES.find((p) => p.id === selected)?.name}`}
					</Button>
				</div>
			</div>
		</div>
	);
}
