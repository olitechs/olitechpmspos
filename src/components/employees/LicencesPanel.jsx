// Employee licences panel.
//
// Shows the plan allowance (fn_employee_licence_state) and the additional
// employee add-ons. The monthly price comes exclusively from the platform-
// configured employee_licence_config table — when it has not been configured
// yet, activation is refused server-side and the UI says so instead of
// inventing a price.

import React, { useEffect, useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { employeeService } from '@/services/employeeService';

function formatMoney(value, currency) {
  if (value === null || value === undefined) return null;
  const amount = Number(value);
  return `${currency || 'KES'} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function LicencesPanel({ propertyId, reloadKey, onReload }) {
  const [state, setState] = useState(null);
  const [addons, setAddons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [unconfigured, setUnconfigured] = useState(false);

  const load = async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const [licenceState, addonRows] = await Promise.all([
        employeeService.licenceState(propertyId),
        employeeService.listLicenceAddons(propertyId),
      ]);
      setState(licenceState);
      setAddons(addonRows || []);
      setUnconfigured(licenceState?.addon_monthly_price === null);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [propertyId, reloadKey]);

  const activate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await employeeService.activateLicenceAddon(propertyId, quantity);
      toast.success(`Activated ${quantity} additional employee licence(s).`);
      setState(result?.licence_state || null);
      onReload?.();
      load();
    } catch (e) {
      if (String(e.message || '').includes('pricing has not been configured')) setUnconfigured(true);
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (addon) => {
    if (!window.confirm(`Cancel ${addon.quantity} additional licence(s)? Registered employees keep working, but freed seats are not re-added.`)) return;
    try {
      const result = await employeeService.cancelLicenceAddon(propertyId, addon.id);
      toast.success('Licence add-on cancelled.');
      setState(result?.licence_state || null);
      onReload?.();
      load();
    } catch (e) { toast.error(e.message); }
  };

  if (loading) {
    return <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-surface p-6 text-sm text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> Loading licence state…</div>;
  }

  const price = formatMoney(state?.addon_monthly_price, state?.addon_currency);
  const overLimit = Number(state?.over_limit || 0) > 0;

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Plan', value: state?.plan_code ? String(state.plan_code).toUpperCase() : '—' },
          { label: 'Included employees', value: state?.included_employees ?? '—' },
          { label: 'Registered + pending', value: `${state?.registered_employees ?? 0} + ${state?.pending_invitations ?? 0}` },
          { label: 'Additional licences', value: state?.additional_employees ?? 0 },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-[var(--border)] bg-surface p-4">
            <div className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">{card.label}</div>
            <div className="mt-1 flex items-center gap-2 text-xl font-black text-[var(--text)]"><Users size={18} className="text-[var(--primary)]" aria-hidden="true" />{card.value}</div>
          </div>
        ))}
      </div>

      {overLimit && (
        <div role="alert" className="mt-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--danger-text)]">
          You are {state.over_limit} employee(s) over the plan allowance. New registrations and invitations are refused until you deactivate employees or add licences.
        </div>
      )}

      <div className="mt-4 rounded-2xl border border-[var(--border)] bg-surface p-4">
        <h2 className="text-sm font-black text-[var(--text)]">Add employee licences</h2>
        {unconfigured ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Additional employee pricing has not been configured by the platform yet. Contact OliTechs support to enable it — no price is assumed here.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="licence-qty" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Seats</label>
              <input id="licence-qty" type="number" min="1" max="100" value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                className="mt-1 w-24 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand-primary)]" />
            </div>
            <div className="text-sm text-[var(--text-muted)]">
              {price && <>Monthly total: <b className="text-[var(--text)]">{formatMoney(Number(state.addon_monthly_price) * quantity, state.addon_currency)}</b> ({price} per seat)</>}
            </div>
            <button type="button" disabled={busy} onClick={activate}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">
              {busy && <Loader2 size={15} className="animate-spin" />} Activate licences
            </button>
            {state?.next_billing_date && (
              <p className="w-full text-[11px] text-[var(--text-muted)]">
                Next billing date: {new Date(state.next_billing_date).toLocaleDateString()}
                {state.subscription_status ? ` · subscription ${state.subscription_status}` : ''}
                {state.max_grant_minutes ? ` · manager grants capped at ${state.max_grant_minutes} min` : ''}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--border)] bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-primary text-primary-foreground">
            <tr><th className="p-3 text-left">Add-on</th><th className="p-3 text-left">Monthly</th><th className="p-3 text-left">Active since</th><th className="p-3 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {!addons.length && <tr><td colSpan={4} className="p-6 text-center text-[var(--text-muted)]">No additional licence add-ons.</td></tr>}
            {addons.map((addon) => (
              <tr key={addon.id} className="border-b border-[var(--border)]">
                <td className="p-3 font-bold text-[var(--text)]">{addon.quantity} additional seat(s)</td>
                <td className="p-3 text-[var(--text)]">{formatMoney(addon.monthly_price, addon.currency)}</td>
                <td className="p-3 text-xs text-[var(--text-muted)]">{new Date(addon.started_at || addon.created_at).toLocaleDateString()}</td>
                <td className="p-3 text-right">
                  <button type="button" onClick={() => cancel(addon)}
                    className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--danger-text)] hover:bg-[var(--danger-soft)]">Cancel</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
