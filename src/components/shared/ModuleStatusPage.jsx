import React from 'react';
import { ArrowRight, CheckCircle2, Clock3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const PHASES = {
  'payment-types': { phase:'Phase 6', title:'Payment Types', description:'Central configuration for cash, M-Pesa, card, bank and other payment methods.' },
  loyalty: { phase:'Phase 7', title:'Loyalty', description:'Guest loyalty profiles, points, redemption and transaction history.' },
  taxes: { phase:'Phase 6', title:'Taxes', description:'Property tax configuration and transaction-level tax rules.' },
  'open-tickets': { phase:'Phase 3', title:'Open Tickets', description:'Operational control of unsettled POS checks and open folios.' },
  'dining-options': { phase:'Phase 3', title:'Dining Options', description:'Dine-in, takeaway, delivery and other service modes.' },
  features: { phase:'Phase 9', title:'Features', description:'Property-level feature and entitlement controls.' },
};

export default function ModuleStatusPage({ module='features', phase, title, description, back='/backoffice' }) {
  const navigate = useNavigate();
  const meta = PHASES[module] || { phase:phase||'Upcoming phase', title:title||'Module', description:description||'This operational module is scheduled for implementation.' };
  return <div className="min-h-full bg-background p-4 md:p-6">
    <div className="mx-auto max-w-3xl">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm md:p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-primary/10 p-3 text-primary"><Clock3 size={22}/></div>
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{meta.phase}</div>
            <h1 className="mt-1 text-2xl font-black text-foreground">{meta.title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{meta.description}</p>
          </div>
        </div>
        <div className="mt-6 rounded-xl border border-border bg-background p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-primary"/>
            <div><p className="text-sm font-bold text-foreground">Navigation is active; operational logic is being delivered by phase.</p><p className="mt-1 text-xs leading-5 text-muted-foreground">This page deliberately does not pretend that unfinished functionality is production-ready.</p></div>
          </div>
        </div>
        <button type="button" onClick={()=>navigate(back)} className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground">Return to Back Office <ArrowRight size={16}/></button>
      </div>
    </div>
  </div>;
}
