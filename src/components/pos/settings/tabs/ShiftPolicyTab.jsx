import React, { useEffect, useState } from 'react';
import { Save, Wallet } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getPosCashVarianceThreshold, savePropertySettings } from '@/services/settingsService';
import { DEFAULT_CASH_VARIANCE_THRESHOLD } from '@/lib/posShiftPolicy';

export default function ShiftPolicyTab() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [threshold, setThreshold] = useState(String(DEFAULT_CASH_VARIANCE_THRESHOLD));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!propertyId) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    getPosCashVarianceThreshold(propertyId)
      .then((value) => { if (active) setThreshold(String(value)); })
      .catch((e) => { if (active) setError(e.message || 'Unable to load the shift policy.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [propertyId]);

  const parsed = Number(threshold);
  const valid = threshold.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;

  const save = async () => {
    if (!propertyId || !valid) return;
    setSaving(true); setMessage(''); setError('');
    try {
      await savePropertySettings(propertyId, { pos_cash_variance_threshold: parsed });
      setMessage(`Shift policy saved. A cash variance above KES ${parsed.toLocaleString('en-KE')} now needs a manager PIN.`);
    } catch (e) {
      setError(e.message || 'Could not save the shift policy.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div role="status" className="p-2 text-sm text-[var(--text-muted)]">Loading shift policy…</div>;

  return <section className="max-w-2xl space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
    <div className="flex items-start gap-3">
      <Wallet size={22} className="mt-0.5 text-[var(--primary)]" aria-hidden="true"/>
      <div>
        <h3 className="font-bold text-[var(--text)]">Cash variance tolerance</h3>
        <p className="mt-1 text-sm text-[var(--text-muted)]">When a cashier closes a shift, a difference between the counted cash and the expected drawer larger than this amount needs a manager PIN.</p>
      </div>
    </div>

    {error && <div role="alert" className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm font-semibold text-[var(--danger-text)]">{error}</div>}
    {message && <div role="status" className="rounded-xl border border-[var(--success)] bg-[var(--success-soft)] p-3 text-sm font-semibold text-[var(--success-text)]">{message}</div>}

    <label htmlFor="pos-cash-variance-threshold" className="block text-sm font-bold text-[var(--text)]">
      Manager approval above (KES)
      <input
        id="pos-cash-variance-threshold"
        type="number"
        inputMode="decimal"
        min="0"
        step="50"
        value={threshold}
        onChange={(event) => setThreshold(event.target.value)}
        aria-invalid={!valid}
        className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base font-semibold text-[var(--text)] outline-none focus:border-[var(--primary)]"
      />
    </label>
    <p className="text-xs leading-5 text-[var(--text-muted)]">Enter 0 to require manager approval for any variance at all. The default is KES {DEFAULT_CASH_VARIANCE_THRESHOLD.toLocaleString('en-KE')}.</p>

    <button type="button" onClick={save} disabled={saving || !valid} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
      <Save size={16} aria-hidden="true"/> {saving ? 'Saving…' : 'Save shift policy'}
    </button>
  </section>;
}
