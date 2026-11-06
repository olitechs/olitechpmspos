import React, { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { posAccessService } from '@/services/posAccessService';

export default function AccessPinTab() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!propertyId) return undefined;
    posAccessService.getPinStatus(propertyId)
      .then((value) => { if (active) setStatus(value); })
      .catch((e) => { if (active) setError(e.message || 'Could not load POS PIN status.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [propertyId]);

  const save = async () => {
    setError('');
    if (!/^\d{4}$/.test(pin)) { setError('Enter exactly four digits.'); return; }
    if (pin !== confirmPin) { setError('The PIN confirmation does not match.'); return; }
    setBusy(true);
    try {
      await posAccessService.resetPin({ propertyId, pin });
      setStatus({ configured: true, is_default: false, updated_at: new Date().toISOString() });
      setPin('');
      setConfirmPin('');
      toast.success('POS access PIN reset successfully.');
    } catch (e) {
      setError(e.message || 'Could not reset the POS PIN.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="mx-auto max-w-2xl space-y-5">
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]"><KeyRound size={20}/></div>
        <div>
          <h3 className="font-bold text-[var(--text)]">Property POS access PIN</h3>
          <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">One four-digit access code protects the POS entry screen for this property. Staff identity and permissions remain controlled by their individual accounts and staff PINs.</p>
        </div>
      </div>
      {loading ? <p className="mt-5 text-sm text-[var(--text-muted)]">Checking PIN status…</p> : status?.is_default ? (
        <div className="mt-5 flex gap-3 rounded-xl border border-[var(--warning)] bg-[var(--warning-soft)] p-4 text-sm text-[var(--warning-text)]">
          <ShieldAlert size={18} className="shrink-0"/>
          <div><b>Default PIN is still active.</b><p className="mt-1">The initial code is 1234. Reset it before normal restaurant operations and share the new code only with authorised POS staff.</p></div>
        </div>
      ) : (
        <div className="mt-5 flex gap-3 rounded-xl border border-[var(--success)] bg-[var(--success-soft)] p-4 text-sm text-[var(--success-text)]">
          <ShieldCheck size={18} className="shrink-0"/>
          <div><b>Custom POS PIN is active.</b><p className="mt-1">The code is stored as a one-way password hash and cannot be viewed here.</p></div>
        </div>
      )}
    </section>
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h4 className="font-bold text-[var(--text)]">Reset POS PIN</h4>
      <p className="mt-1 text-sm text-[var(--text-muted)]">Choose a new four-digit code. The previous code stops working immediately.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-[var(--text-muted)]">New 4-digit PIN
          <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="new-password" type="password" maxLength={4} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3 text-lg tracking-[.35em] text-[var(--text)]" placeholder="••••"/>
        </label>
        <label className="block text-xs font-semibold text-[var(--text-muted)]">Confirm new PIN
          <input value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="new-password" type="password" maxLength={4} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3 text-lg tracking-[.35em] text-[var(--text)]" placeholder="••••"/>
        </label>
      </div>
      {error && <p role="alert" className="mt-3 rounded-xl bg-[var(--danger-soft)] p-3 text-sm font-medium text-[var(--danger-text)]">{error}</p>}
      <button type="button" disabled={busy || loading || pin.length !== 4 || confirmPin.length !== 4} onClick={save} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--primary)] px-5 py-3 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40">{busy ? 'Saving…' : 'Save new POS PIN'}</button>
    </section>
  </div>;
}
