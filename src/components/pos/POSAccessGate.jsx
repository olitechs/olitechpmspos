import React, { useEffect, useState } from 'react';

const POS_ACCESS_KEY = 'olitech_pos_window_access_v1';

function OliTechsBrand() {
  return (
    <div className="flex items-center gap-3" aria-label="OliTechs Point of Sale">
      <svg viewBox="0 0 56 56" className="h-11 w-11 shrink-0 sm:h-12 sm:w-12" role="img" aria-label="OliTechs logo">
        <path d="M8 8h16v16H8zM32 8h16v16H32zM8 32h16v16H8zM32 32h16v16H32z" fill="none" stroke="var(--pos-gate-accent)" strokeWidth="4" strokeLinejoin="round"/>
        <path d="M24 16h8M16 24v8M40 24v8M24 40h8" stroke="var(--pos-gate-accent)" strokeWidth="3" strokeLinecap="round"/>
      </svg>
      <div className="leading-none">
        <div className="font-display text-[27px] font-extrabold tracking-[-.055em] text-[var(--pos-gate-text)] sm:text-[31px]">OliTechs</div>
        <div className="mt-1.5 text-[9px] font-semibold uppercase tracking-[.34em] text-[var(--pos-gate-accent)] sm:text-[10px]">Point of Sale</div>
      </div>
    </div>
  );
}

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
        <OliTechsBrand />
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

        <div className="grid h-[min(49vh,440px)] min-h-[300px] w-full grid-cols-3 grid-rows-4 overflow-hidden rounded-lg border-l border-t border-[var(--pos-gate-border)] bg-[var(--pos-gate-surface)] shadow-[0_18px_48px_rgba(0,0,0,.22)] sm:h-[min(52vh,480px)] sm:min-h-[340px]">
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
          {canManagePin && <button type="button" onClick={onAdminReset} className="font-semibold text-[var(--pos-gate-accent)] underline underline-offset-4">Reset POS PIN</button>}
        </div>
      </section>
    </main>
  );
}

export { POS_ACCESS_KEY };
