import React from 'react';
import { CheckCircle2, ClipboardCheck, RefreshCw, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';
import ManagerAuthorizationScreen from '@/components/auth/ManagerAuthorizationScreen';

const money = (v) => `KES ${Number(v || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const btn = 'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50';
const input = 'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--focus)]';
const newRequestKey = () => globalThis.crypto?.randomUUID?.() || `night-audit-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function NightAudit() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [businessDate, setBusinessDate] = React.useState(null);
  const [check, setCheck] = React.useState(null);
  const [history, setHistory] = React.useState([]);
  const [notes, setNotes] = React.useState('');
  const [overrideReason, setOverrideReason] = React.useState('');
  const [overrideGrantId, setOverrideGrantId] = React.useState(null);
  const [requestKey, setRequestKey] = React.useState(newRequestKey);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [authOpen, setAuthOpen] = React.useState(false);
  const [done, setDone] = React.useState(null);

  const load = React.useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError('');
    try {
      const date = await pmsService.getBusinessDate(propertyId);
      setBusinessDate(date);
      const [precheck, rows] = await Promise.all([
        pmsService.getNightAuditPrecheck(propertyId, date),
        pmsService.listNightAudits(propertyId),
      ]);
      setCheck(precheck);
      setHistory(rows);
    } catch (e) {
      setError(e.message || 'Unable to load night audit.');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  React.useEffect(() => { load(); }, [load]);

  const reconciliation = check?.reconciliation || {};
  const blocking = Boolean(check?.blocking_variance);
  const controlsReady = Number(check?.open_cashier_shifts || 0) === 0 && Number(check?.pending_adjustments || 0) === 0;
  const canClose = Boolean(propertyId) && controlsReady && (
    !blocking || Boolean(overrideGrantId && String(overrideReason || '').trim())
  );

  const run = async (options = {}) => {
    setBusy(true);
    setError('');
    setDone(null);
    try {
      const result = await pmsService.runNightAudit({
        propertyId,
        requestKey,
        businessDate,
        notes,
        overrideReason: blocking ? (options.overrideReason ?? overrideReason) : null,
        overrideGrantId: blocking ? (options.overrideGrantId ?? overrideGrantId) : null,
      });
      if (result?.status === 'failed') {
        setError(result.reconciliation_snapshot?.blocking_reason || 'Reconciliation variance blocked the night audit.');
        setRequestKey(newRequestKey());
        await load();
        return;
      }
      setDone(result);
      setNotes('');
      setOverrideReason('');
      setOverrideGrantId(null);
      setRequestKey(newRequestKey());
      await load();
    } catch (e) {
      setError(e.message || 'Night audit could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const closeDay = () => {
    if (blocking && !overrideGrantId) {
      setError('');
      setAuthOpen(true);
      return;
    }
    if (blocking && !String(overrideReason || '').trim()) {
      setError('Record an override reason before closing with a reconciliation variance.');
      return;
    }
    run();
  };

  const handleAuthorized = (result) => {
    setAuthOpen(false);
    const grantId = result?.grant?.id || result?.id || null;
    if (!grantId) {
      setError('Manager authorization did not return a usable override grant.');
      return;
    }
    setOverrideGrantId(grantId);
    run({ overrideGrantId: grantId, overrideReason });
  };

  if (authOpen) {
    return <ManagerAuthorizationScreen
      title="Variance override authorization"
      description="This night audit has a blocking reconciliation variance. A manager with the night audit override permission must authorize the close and the reason is written to the audit log."
      permissionCode="nightaudit.override"
      permissionLabel="Override a blocked night audit reconciliation"
      onAuthorized={handleAuthorized}
      onClose={() => setAuthOpen(false)}
    />;
  }

  return <div className="flex-1 overflow-y-auto bg-canvas p-4 lg:p-6"><div className="mx-auto max-w-[1250px] space-y-4">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-xl font-medium">Night Audit</h1><p className="mt-1 text-sm text-[var(--text-muted)]">Reconcile the business day, verify cashier closure, then roll to the next business date.</p></div><button className={btn + ' border border-[var(--border)] bg-[var(--surface)]'} onClick={load} disabled={loading || busy}><RefreshCw size={15} /> Refresh</button></header>
    {error && <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]">{error}</div>}
    {done && <div className="rounded-lg border border-[var(--success)] bg-[var(--success-soft)] p-4 text-sm text-[var(--success-text)]"><div className="flex items-center gap-2 font-medium"><CheckCircle2 size={18} /> Business day {done.business_date} closed successfully.</div><div className="mt-1">Next business date: <strong>{done.next_business_date}</strong>.</div></div>}
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center gap-3"><ClipboardCheck size={20} /><div><h2 className="font-medium">Pre-audit reconciliation</h2><p className="text-sm text-[var(--text-muted)]">Business date: <strong>{businessDate || '—'}</strong></p></div></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="POS transactions" value={check?.transactions ?? '—'} />
        <Metric label="POS revenue" value={money(check?.revenue)} />
        <Metric label="Room folio revenue" value={money(reconciliation.room_folio_revenue)} />
        <Metric label="Posted room payments" value={money(reconciliation.room_posted_payments)} />
        <Metric label="Room revenue variance" value={money(reconciliation.room_revenue_variance)} bad={Number(reconciliation.room_revenue_variance) !== 0} />
        <Metric label="POS tax / discount variance" value={money(reconciliation.pos_tax_discount_variance)} bad={Number(reconciliation.pos_tax_discount_variance) !== 0} />
        <Metric label="Split tender variance" value={money(reconciliation.pos_split_tender_variance)} bad={Number(reconciliation.pos_split_tender_variance) !== 0} />
        <Metric label="Cashier variance" value={money(reconciliation.cashier_variance)} bad={Number(reconciliation.cashier_variance) !== 0} />
        <Metric label="Open cashier shifts" value={check?.open_cashier_shifts ?? '—'} bad={Number(check?.open_cashier_shifts) > 0} />
        <Metric label="Pending adjustments" value={check?.pending_adjustments ?? '—'} bad={Number(check?.pending_adjustments) > 0} />
      </div>
      <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-3 text-xs text-[var(--text-muted)]">
        Posted receipts: {money(reconciliation.pos_posted_total)} · Subtotal {money(reconciliation.pos_subtotal)} · VAT {money(reconciliation.pos_tax)} · Discounts {money(reconciliation.discounts)} · Refunds {money(reconciliation.refunds)} · Voids excluded {money(reconciliation.voids_excluded)} · Room tenders {money(reconciliation.pos_room_tender)}
      </div>
      <div className={`mt-4 rounded-lg border p-3 text-sm ${controlsReady && !blocking ? 'border-[var(--success)] bg-[var(--success-soft)] text-[var(--success-text)]' : 'border-[var(--border)] bg-[var(--warning-soft)] text-[var(--warning-text)]'}`}>
        <div className="flex items-center gap-2 font-medium">
          {controlsReady && !blocking ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
          {blocking ? check?.reconciliation?.blocking_reason || 'Reconciliation variance requires an authorized override.' : controlsReady ? 'All cashier controls are reconciled and the day is ready to close.' : 'Resolve all open cashier shifts and pending adjustments before closing the business day.'}
        </div>
      </div>
      <label className="mt-4 block text-xs font-medium text-[var(--text-muted)]">Night audit notes<textarea className={input + ' mt-1'} rows="3" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Record any operational or reconciliation notes for this business day." /></label>
      {blocking && <div className="mt-3 rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)] p-3">
        <label className="block text-xs font-medium text-[var(--warning-text)]">Variance override reason</label>
        <textarea className={input + ' mt-1'} rows="2" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Explain why the blocking variance is accepted." />
        <div className="mt-2 flex items-center gap-2 text-xs text-[var(--text-muted)]"><ShieldCheck size={14} /> {overrideGrantId ? 'Manager override authorization attached. The grant and reason will be audited.' : 'A manager must authorize this override before the day can be closed.'}</div>
      </div>}
      <button className={btn + ' mt-3 bg-primary text-primary-foreground'} disabled={busy || loading || !canClose} onClick={closeDay}>
        {blocking && !overrideGrantId ? <ShieldCheck size={15} /> : <CheckCircle2 size={15} />}
        {blocking && !overrideGrantId ? 'Authorize variance override' : blocking ? 'Close with authorized override' : 'Close business day'}
      </button>
    </section>
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"><h2 className="font-medium">Night audit history</h2><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead><tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-wide text-[var(--text-muted)]"><th className="px-3 py-2">Business date</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Revenue</th><th className="px-3 py-2">Cash</th><th className="px-3 py-2">Card</th><th className="px-3 py-2">M-Pesa</th><th className="px-3 py-2">Refunds</th><th className="px-3 py-2">Variance</th><th className="px-3 py-2">Closed</th></tr></thead><tbody>{history.map((a) => <tr key={a.id} className="border-b border-[var(--border)]"><td className="px-3 py-3 font-medium">{a.business_date}</td><td className="px-3 py-3 capitalize">{a.status}</td><td className="px-3 py-3 font-mono">{money(a.total_revenue)}</td><td className="px-3 py-3 font-mono">{money(a.cash_revenue)}</td><td className="px-3 py-3 font-mono">{money(a.card_revenue)}</td><td className="px-3 py-3 font-mono">{money(a.mpesa_revenue)}</td><td className="px-3 py-3 font-mono">{money(a.refunds)}</td><td className="px-3 py-3 font-mono">{money(a.cashier_variance)}</td><td className="px-3 py-3 text-xs text-[var(--text-muted)]">{new Date(a.completed_at).toLocaleString('en-KE')}</td></tr>)}{!history.length && <tr><td colSpan="9" className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">No completed night audits yet.</td></tr>}</tbody></table></div></section>
  </div></div>;
}

function Metric({ label, value, bad }) {
  return <div className={`rounded-lg border p-3 ${bad ? 'border-[var(--danger)] bg-[var(--danger-soft)]' : 'border-[var(--border)] bg-[var(--canvas)]'}`}><div className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</div><div className={`mt-1 text-lg font-medium ${bad ? 'text-[var(--danger-text)]' : 'text-foreground'}`}>{value}</div></div>;
}
