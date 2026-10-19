import React from 'react';
import { ChartNoAxesCombined } from 'lucide-react';

export default function SalesSummaryTab() {
  return <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
    <div className="flex items-start gap-3"><ChartNoAxesCombined size={22} className="mt-1 text-[var(--primary)]"/><div><h3 className="font-bold">Sales summary</h3><p className="mt-1 text-sm text-[var(--text-muted)]">Sales reporting is being wired to the authoritative property-scoped reporting RPC so the screen and exports reconcile.</p></div></div>
  </section>;
}
