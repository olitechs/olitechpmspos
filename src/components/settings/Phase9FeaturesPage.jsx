import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, AlertTriangle, Building2, CheckCircle2, Info, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { featureEntitlementService } from '@/services/featureEntitlementService';
import { featureMatrix, PACKAGE_LABELS } from '@/lib/entitlements';

const GROUPS = [
  { title: 'Core PMS', keys: ['dashboard','property_setup_basic','rooms_basic','room_types_basic','guests','reservations_basic','check_in_out','folio_basic','payments_basic','housekeeping_basic','reports_basic'] },
  { title: 'Point of Sale', keys: ['pos_products_basic','pos_categories','pos_orders_basic','pos_receipt_printing','pos_payments_basic','multi_outlet_pos','room_charges','kitchen_printers','cashier_shifts'] },
  { title: 'Advanced operations', keys: ['advanced_reports','revenue_analytics','inventory','advanced_housekeeping','maintenance','financial_reports','staff_management','advanced_user_permissions','audit_log_view'] },
];
const LABELS = {
 dashboard:['Dashboard','Property overview and operational summary.'],
 property_setup_basic:['Property setup','Basic property configuration.'],
 rooms_basic:['Rooms','Room inventory and availability.'],
 room_types_basic:['Room types','Room type configuration.'],
 guests:['Guests','Guest records and profiles.'],
 reservations_basic:['Reservations','Reservation management workflows.'],
 check_in_out:['Check-in and check-out','Guest arrival and departure operations.'],
 folio_basic:['Guest folio','Guest billing and folio workflows.'],
 payments_basic:['Payments','Payment collection and recording.'],
 housekeeping_basic:['Housekeeping','Basic housekeeping operations.'],
 reports_basic:['Basic reports','Core operational reports.'],
 pos_products_basic:['POS products','Menu and product catalogue in POS.'],
 pos_categories:['POS categories','POS category configuration.'],
 pos_orders_basic:['POS orders','Order creation and processing.'],
 pos_receipt_printing:['Receipt printing','Customer receipt printing.'],
 pos_payments_basic:['POS payments','POS payment workflows.'],
 advanced_reports:['Advanced reports','Expanded operational reporting.'],
 revenue_analytics:['Revenue analytics','Revenue analysis and metrics.'],
 inventory:['Inventory','Inventory, purchasing and stock workflows.'],
 multi_outlet_pos:['Multi-outlet POS','Multiple POS outlets.'],
 advanced_housekeeping:['Advanced housekeeping','Expanded housekeeping controls.'],
 maintenance:['Maintenance','Maintenance tracking workflows.'],
 financial_reports:['Financial reports','Financial and settlement reporting.'],
 staff_management:['Staff management','Staff administration.'],
 advanced_user_permissions:['Advanced user permissions','Advanced role and access controls.'],
 room_charges:['Room charges','Post eligible POS charges to guest folios.'],
 kitchen_printers:['Kitchen printers','Kitchen ticket routing and printer configuration.'],
 cashier_shifts:['Cashier shifts','Cashier shift opening, closing and reconciliation.'],
 audit_log_view:['Audit log','Review property audit history.'],
};
const labelFor = key => LABELS[key]?.[0] || key.replaceAll('_',' ').replace(/\b\w/g, c=>c.toUpperCase());
const descFor = key => LABELS[key]?.[1] || 'Feature entitlement defined by the assigned subscription package.';

export default function Phase9FeaturesPage() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');
  const [error, setError] = useState('');
  const matrix = useMemo(() => featureMatrix(), []);
  const pkg = record?.package || user?.property?.package || 'none';
  const packageFeatures = matrix[pkg] || {};
  const effective = record?.features || {};
  const enabledCount = Object.values(effective).filter(Boolean).length;

  const load = useCallback(async () => {
    if (!propertyId) { setRecord(null); setLoading(false); setError('No property is assigned to this account.'); return; }
    setLoading(true); setError('');
    try { setRecord(await featureEntitlementService.getForProperty(propertyId)); }
    catch (e) { setError(e?.message || 'Unable to load server-side entitlements.'); }
    finally { setLoading(false); }
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (key) => {
    if (savingKey || !packageFeatures[key]) return;
    const next = !effective[key];
    setSavingKey(key); setError('');
    try { setRecord(await featureEntitlementService.setForProperty(propertyId, key, next)); }
    catch (e) { setError(e?.message || 'The server rejected this entitlement change.'); }
    finally { setSavingKey(''); }
  };

  const canManage = user?.isPlatformOwner || ['owner','admin'].includes(String(user?.propertyRole || '').toLowerCase());
  const keys = new Set(GROUPS.flatMap(group => group.keys));
  const extraKeys = Object.keys(packageFeatures).filter(key => !keys.has(key));

  return <main className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6" data-testid="phase-9-features-page">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><div className="mb-2 text-xs font-bold uppercase tracking-[.18em] text-[var(--muted)]">Phase 9 · Property configuration</div><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Features &amp; Entitlements</h1><p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">Manage feature restrictions for this property. The assigned package remains the maximum entitlement.</p></div>
      <Link to="/backoffice" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 font-semibold hover:bg-[var(--surface-2)]"><ArrowLeft size={16}/> Return to Back Office</Link>
    </div>

    <section role="status" className="flex gap-3 rounded-lg border border-orange-300 bg-orange-50 p-4 text-orange-950">
      <AlertTriangle className="mt-0.5 shrink-0" size={20}/><div><p className="font-bold">Navigation is active; operational logic is being delivered by phase.</p><p className="mt-1 text-sm">Feature changes are saved to the server and audited. They can restrict package features, but cannot grant features excluded by the assigned package. Each operational workflow must still enforce its entitlement at its database/RPC boundary before it is considered fully production-enforced.</p></div>
    </section>

    {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900"><AlertTriangle size={18} className="mt-0.5 shrink-0"/><div className="flex-1">{error}</div><button onClick={load} className="inline-flex items-center gap-1 font-bold underline"><RefreshCw size={14}/> Retry</button></div>}

    <section className="global-card space-y-4 p-4 sm:p-5">
      <div className="flex items-center gap-2"><Building2 size={19} className="text-[var(--brand-primary)]"/><h2 className="text-lg font-bold">Property scope</h2></div>
      {loading ? <p className="text-sm text-[var(--muted)]">Loading current property entitlements…</p> : <div className="grid gap-4 sm:grid-cols-3">
        <div><p className="text-xs font-semibold text-[var(--muted)]">Property</p><p className="mt-1 font-bold">{user?.property?.name || 'Assigned property'}</p><p className="break-all text-xs text-[var(--muted)]">{propertyId || 'No property ID'}</p></div>
        <div><p className="text-xs font-semibold text-[var(--muted)]">Assigned package</p><p className="mt-1 font-bold">{PACKAGE_LABELS[pkg] || pkg}</p></div>
        <div><p className="text-xs font-semibold text-[var(--muted)]">Effective features</p><p className="mt-1 text-xl font-bold">{enabledCount} / {Object.keys(effective).length || Object.keys(packageFeatures).length}</p></div>
      </div>}
      <p className="text-xs text-[var(--muted)]">Changes are stored in Supabase. Only a platform owner or the property's owner/admin can change entitlements. Package-level restrictions are enforced by the database function.</p>
    </section>

    {!loading && GROUPS.concat(extraKeys.length ? [{title:'Other package features',keys:extraKeys}] : []).map(group => <section key={group.title} className="global-card overflow-hidden">
      <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3"><h2 className="font-bold">{group.title}</h2></div>
      <div className="divide-y divide-[var(--border)]">
        {group.keys.map(key => {
          const included = Boolean(packageFeatures[key]);
          const enabled = Boolean(effective[key]);
          const busy = savingKey === key;
          return <div key={key} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0 flex-1"><div className="font-semibold">{labelFor(key)}</div><p className="mt-1 text-sm text-[var(--muted)]">{descFor(key)}</p><code className="mt-1 inline-block text-xs text-[var(--muted)]">{key}</code></div>
            <button type="button" role="switch" aria-checked={enabled} disabled={!canManage || !included || Boolean(savingKey) || loading} onClick={() => toggle(key)} className={'inline-flex min-h-10 items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 '+(enabled?'border-green-300 bg-green-50 text-green-800':'border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]')}>
              {busy ? <RefreshCw size={15} className="animate-spin"/> : included ? <CheckCircle2 size={15}/> : <LockKeyhole size={15}/>}
              {!included ? 'Not in package' : enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>;
        })}
      </div>
    </section>)}

    {!canManage && <p className="flex items-center gap-2 text-sm text-orange-800"><ShieldCheck size={16}/> Read-only access. Ask the property owner/admin to change feature entitlements.</p>}
    <p className="flex items-center gap-2 text-xs text-[var(--muted)]"><Info size={16}/> Every successful change is written to the property audit log. A failed server update leaves the previous saved value in place.</p>
  </main>;
}
