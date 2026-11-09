import React, { useEffect, useState } from 'react';
import BrandLogo from '@/components/ui/BrandLogo';

const POS_ACCESS_KEY = 'olitech_pos_window_access_v1';

export default function POSAccessGate({ propertyName, error, busy, canManagePin, onAdminReset, onSubmit }) {
  const [pin, setPin] = useState('');

  useEffect(() => {
    if (error) setPin('');
  }, [error]);

  const enterDigit = (digit) => {
    if (busy || pin.length >= 4) return;
    const next = pin + String(digit);
    setPin(next);
    if (next.length === 4) window.setTimeout(() => onSubmit(next), 80);
  };

  const keyClass = "flex min-h-0 items-center justify-center border-b border-r border-[var(--pos-gate-border)] bg-transparent font-body text-2xl font-medium text-[var(--pos-gate-text)] transition-colors hover:bg-[var(--pos-gate-hover)] active:bg-[var(--pos-gate-active)] disabled:cursor-not-allowed disabled:opacity-55 sm:text-[27px]";

  return (
    <main className="fixed inset-0 z-[9999] flex h-[100dvh] w-screen flex-col items-center overflow-y-auto bg-[var(--pos-gate-bg)] px-4 py-5 font-body text-[var(--pos-gate-text)] sm:justify-center sm:px-6 sm:py-6">
      <header className="mb-5 flex w-full max-w-[760px] shrink-0 items-center justify-center sm:mb-6">
        <div className="rounded-xl bg-[var(--surface)] px-4 py-2 shadow-sm"><BrandLogo className="h-9 w-auto max-w-[158px] object-contain" /></div>
      </header>

      <section className="flex w-full max-w-[760px] flex-col items-center">
        <div className="mb-4 flex shrink-0 flex-col items-center text-center sm:mb-5">
          <h1 className="font-heading text-lg font-semibold tracking-tight sm:text-xl">Enter your PIN</h1>
          <p className="mt-1 max-w-[80vw] truncate text-xs text-[var(--pos-gate-muted)] sm:text-[13px]">{propertyName || 'POS Access'}</p>
          <div className="mt-3 flex items-center justify-center gap-3" aria-label={`${pin.length} of 4 PIN digits entered`}>
            {Array.from({ length: 4 }, (_, index) => (
              <span key={index} className={`h-5 w-5 rounded-full border-2 border-[var(--pos-gate-accent)] transition-colors sm:h-[22px] sm:w-[22px] ${index < pin.length ? 'bg-[var(--pos-gate-accent)]' : 'bg-transparent'}`} />
            ))}
          </div>
          {error && <p role="alert" className="mt-2 text-xs font-semibold text-[var(--danger-text)]">{error}</p>}
          {busy && <p aria-live="polite" className="mt-2 text-xs text-[var(--pos-gate-muted)]">Verifying PIN…</p>}
        </div>

        <div className="grid h-[min(49vh,440px)] min-h-[300px] w-full grid-cols-3 grid-rows-4 overflow-hidden rounded-lg border-l border-t border-[var(--pos-gate-border)] bg-[var(--pos-gate-surface)] shadow-[var(--shadow-overlay)] sm:h-[min(52vh,480px)] sm:min-h-[340px]">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
            <button key={digit} type="button" onClick={() => enterDigit(digit)} disabled={busy || pin.length >= 4} className={keyClass}>
              {digit}
            </button>
          ))}
          <div className="border-b border-r border-[var(--pos-gate-border)]" aria-hidden="true" />
          <button type="button" onClick={() => enterDigit(0)} disabled={busy || pin.length >= 4} className={keyClass}>0</button>
          <button type="button" onClick={() => setPin('')} disabled={busy || !pin.length}
            className="flex min-h-0 items-center justify-center border-b border-r border-[var(--pos-gate-border)] bg-transparent font-body text-base font-semibold text-[var(--pos-gate-accent)] transition-colors hover:bg-[var(--pos-gate-hover)] active:bg-[var(--pos-gate-active)] disabled:cursor-not-allowed disabled:opacity-40 sm:text-lg">
            Clear
          </button>
        </div>

        <div className="mt-3 flex w-full items-center justify-between px-1 text-[10px] text-[var(--pos-gate-muted)] sm:text-xs">
          <span className="truncate">{propertyName || 'OliTechs POS'}</span>
          {canManagePin
            ? <button type="button" onClick={onAdminReset} className="font-semibold text-[var(--pos-gate-accent)] underline underline-offset-4">Reset POS PIN</button>
            : <span className="text-right">Need a PIN? Ask your property administrator to set or reset it.</span>}
        </div>
      </section>
    </main>
  );
}

export { POS_ACCESS_KEY };
