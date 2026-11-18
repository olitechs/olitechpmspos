import React, { useState } from 'react';
import { KeyRound, ShieldAlert } from 'lucide-react';
import BrandLogo from '@/components/ui/BrandLogo';
import { posAccessService } from '@/services/posAccessService';

// Forced "Set a new POS PIN" screen (upgrade pack Task 3).
//
// Shown to owners/administrators when the property POS access PIN is either
// still the default (server flag `must_change`) or not configured at all.
// POS stays blocked until a real PIN is set — the weak-PIN rules live on the
// server (`fn_reset_pos_access_pin`); its messages are surfaced verbatim.
export default function PosPinSetupGate({ propertyId, propertyName, reason = 'must_change', onComplete }) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const heading = reason === 'not_configured'
    ? 'Set the POS access PIN'
    : 'Set a new POS PIN';
  const detail = reason === 'not_configured'
    ? 'This property has no POS access PIN yet. Create a private four-digit code to protect the POS entry screen.'
    : 'The POS is still using the initial default code. Choose a private four-digit code before continuing.';

  const save = async () => {
    setError('');
    if (!propertyId) { setError('No active property. Select a property first.'); return; }
    if (!/^\d{4}$/.test(pin)) { setError('Enter exactly four digits.'); return; }
    if (pin === '1234') { setError('Choose a PIN different from the initial default 1234.'); return; }
    if (pin !== confirmPin) { setError('The PIN confirmation does not match.'); return; }
    setBusy(true);
    try {
      await posAccessService.resetPin({ propertyId, pin });
      onComplete?.({ is_default: false });
    } catch (caught) {
      setError(caught?.message || 'Could not set the POS PIN. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="fixed inset-0 z-[9999] flex h-[100dvh] w-screen flex-col items-center overflow-y-auto bg-[var(--pos-gate-bg)] px-4 py-6 font-body text-[var(--pos-gate-text)] sm:justify-center">
      <header className="mb-5 flex w-full max-w-[520px] shrink-0 items-center justify-center">
        <div className="rounded-xl bg-[var(--surface)] px-4 py-2 shadow-sm"><BrandLogo className="h-9 w-auto max-w-[158px] object-contain" /></div>
      </header>
      <section className="w-full max-w-[520px] rounded-2xl border border-[var(--pos-gate-border)] bg-[var(--surface)] p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-lg bg-[var(--warning-soft)] p-2 text-[var(--warning-text)]"><ShieldAlert size={20} aria-hidden="true" /></span>
          <div>
            <h1 className="font-heading text-lg font-bold tracking-tight">{heading}</h1>
            <p className="mt-1 text-sm text-[var(--pos-gate-muted)]">{detail}</p>
          </div>
        </div>
        <form
          className="mt-5 grid gap-3"
          onSubmit={(event) => { event.preventDefault(); save(); }}
        >
          <label className="block text-xs font-semibold text-[var(--pos-gate-muted)]">
            New 4-digit PIN
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              autoComplete="new-password"
              type="password"
              maxLength={4}
              required
              className="mt-1 min-h-11 w-full rounded-xl border border-[var(--pos-gate-border)] bg-[var(--canvas)] p-3 text-lg tracking-[.35em] text-[var(--text)]"
              placeholder="••••"
            />
          </label>
          <label className="block text-xs font-semibold text-[var(--pos-gate-muted)]">
            Confirm new PIN
            <input
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              autoComplete="new-password"
              type="password"
              maxLength={4}
              required
              className="mt-1 min-h-11 w-full rounded-xl border border-[var(--pos-gate-border)] bg-[var(--canvas)] p-3 text-lg tracking-[.35em] text-[var(--text)]"
              placeholder="••••"
            />
          </label>
          {error && <p role="alert" className="rounded-xl bg-[var(--danger-soft)] p-3 text-sm font-semibold text-[var(--danger-text)]">{error}</p>}
          <button
            type="submit"
            disabled={busy || pin.length !== 4 || confirmPin.length !== 4}
            className="mt-1 inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--primary)] px-5 py-3 text-sm font-bold text-primary-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            <KeyRound size={16} className="mr-2" aria-hidden="true" />
            {busy ? 'Saving…' : 'Save POS PIN'}
          </button>
        </form>
      </section>
    </main>
  );
}
