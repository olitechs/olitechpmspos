import React, { useMemo, useState } from 'react';
import { ArrowLeft, ShieldCheck, Building2, LockKeyhole, Info, Save, ToggleLeft, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';

const FEATURE_GROUPS = [
  { title: 'Front Office', items: [
    { id: 'room_planner', name: 'Room Planner', description: 'Room rack, availability calendar and reservation planning.' },
    { id: 'reservations', name: 'Reservations', description: 'Create, update and manage guest reservations.' },
    { id: 'guest_folio', name: 'Guest folio & billing', description: 'Guest charges, folios and settlement workflows.' },
    { id: 'housekeeping', name: 'Housekeeping', description: 'Room status and housekeeping operations.' },
  ]},
  { title: 'Point of Sale', items: [
    { id: 'pos', name: 'Point of Sale', description: 'Cashier workspace, orders and payment workflows.' },
    { id: 'kitchen_display', name: 'Kitchen display', description: 'Kitchen order display and fulfilment.' },
    { id: 'printer_routing', name: 'Printer routing', description: 'Route order tickets to configured printer groups.' },
  ]},
  { title: 'Back Office', items: [
    { id: 'inventory', name: 'Inventory & stores', description: 'Stock movement, purchasing and store operations.' },
    { id: 'reports', name: 'Reports & analytics', description: 'Operational and financial reporting.' },
    { id: 'staff_access', name: 'Staff access controls', description: 'Roles, permissions and staff access management.' },
  ]},
];

export default function Phase9FeaturesPage() {
  const [propertyName, setPropertyName] = useState('');
  const [packageName, setPackageName] = useState('professional');
  const [features, setFeatures] = useState(() => Object.fromEntries(FEATURE_GROUPS.flatMap(g => g.items.map(i => [i.id, true]))));
  const [dirty, setDirty] = useState(false);
  const count = useMemo(() => Object.values(features).filter(Boolean).length, [features]);
  const toggle = id => { setFeatures(prev => ({ ...prev, [id]: !prev[id] })); setDirty(true); };
  const reset = () => { setFeatures(Object.fromEntries(FEATURE_GROUPS.flatMap(g => g.items.map(i => [i.id, true])))); setDirty(false); };

  return <main className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6" data-testid="phase-9-features-page">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="mb-2 text-xs font-bold uppercase tracking-[.18em] text-[var(--muted)]">Phase 9 · Property configuration</div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Features &amp; Entitlements</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">Review feature availability by property and subscription package.</p>
      </div>
      <Link to="/backoffice" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 font-semibold hover:bg-[var(--surface-2)]"><ArrowLeft size={16}/> Return to Back Office</Link>
    </div>

    <section role="alert" className="flex gap-3 rounded-lg border border-orange-300 bg-orange-50 p-4 text-orange-950">
      <AlertTriangle className="mt-0.5 shrink-0" size={20}/>
      <div><p className="font-bold">Navigation is active; operational logic is being delivered by phase.</p><p className="mt-1 text-sm">This page deliberately does not pretend that unfinished functionality is production-ready. Changes on this screen are a local preview only and are not saved to the property record or enforced by the server.</p></div>
    </section>

    <section className="global-card space-y-4 p-4 sm:p-5">
      <div className="flex items-center gap-2"><Building2 size={19} className="text-[var(--brand-primary)]"/><h2 className="text-lg font-bold">Property scope</h2></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5"><span className="text-sm font-semibold">Property name / ID</span><input value={propertyName} onChange={e=>setPropertyName(e.target.value)} placeholder="Select a property (preview only)" className="min-h-10 w-full rounded-md border bg-[var(--surface)] px-3 text-[var(--text)]"/></label>
        <label className="space-y-1.5"><span className="text-sm font-semibold">Subscription package</span><select value={packageName} onChange={e=>{setPackageName(e.target.value);setDirty(true)}} className="min-h-10 w-full rounded-md border bg-[var(--surface)] px-3 text-[var(--text)]"><option value="standard">Standard</option><option value="premium">Premium</option><option value="professional">Professional</option><option value="enterprise">Enterprise</option></select></label>
      </div>
      <p className="text-xs text-[var(--muted)]">Property selection and package changes are not connected to persisted subscription data yet.</p>
    </section>

    <section className="grid gap-3 sm:grid-cols-3">
      <div className="global-card p-4"><p className="text-sm text-[var(--muted)]">Features enabled in preview</p><p className="mt-1 text-2xl font-bold">{count}<span className="text-sm font-medium text-[var(--muted)]"> / 10</span></p></div>
      <div className="global-card p-4"><p className="text-sm text-[var(--muted)]">Selected package</p><p className="mt-1 text-2xl font-bold capitalize">{packageName}</p></div>
      <div className="global-card p-4"><p className="text-sm text-[var(--muted)]">Enforcement status</p><p className="mt-1 flex items-center gap-2 text-base font-bold text-orange-700"><LockKeyhole size={18}/> Not connected</p></div>
    </section>

    {FEATURE_GROUPS.map(group => <section key={group.title} className="global-card overflow-hidden">
      <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3"><h2 className="font-bold">{group.title}</h2></div>
      <div className="divide-y divide-[var(--border)]">
        {group.items.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0 flex-1"><div className="font-semibold">{item.name}</div><p className="mt-1 text-sm text-[var(--muted)]">{item.description}</p><code className="mt-1 inline-block text-xs text-[var(--muted)]">{item.id}</code></div>
          <button type="button" role="switch" aria-checked={!!features[item.id]} onClick={()=>toggle(item.id)} className={'inline-flex min-h-10 items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold '+(features[item.id]?'border-green-300 bg-green-50 text-green-800':'border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]')}><span className={'h-2.5 w-2.5 rounded-full '+(features[item.id]?'bg-green-600':'bg-gray-400')}/>{features[item.id]?'Enabled (preview)':'Disabled (preview)'}</button>
        </div>)}
      </div>
    </section>)}

    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="flex items-center gap-2 text-sm text-[var(--muted)]"><Info size={17}/> Preview only — server-side entitlement enforcement remains authoritative.</p>
      <div className="flex gap-2"><button type="button" onClick={reset} className="min-h-10 rounded-md border border-[var(--border)] px-4 font-semibold hover:bg-[var(--surface-2)]">Reset preview</button><button type="button" disabled={!dirty} onClick={()=>setDirty(false)} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[var(--brand-primary)] px-4 font-bold text-[#23262f] disabled:cursor-not-allowed disabled:opacity-50"><Save size={16}/> Apply preview</button></div>
    </div>
  </main>;
}
