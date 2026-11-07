import React, { useEffect, useState } from 'react';

const POS_ACCESS_KEY = 'olitech_pos_window_access_v1';

export default function POSAccessGate({ propertyName, logoUrl, error, busy, canManagePin, onAdminReset, onSubmit }) {
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

  return (
    <main className="fixed inset-0 z-[9999] flex h-[100dvh] w-screen flex-col overflow-hidden bg-[var(--pos-gate-bg)] text-[var(--pos-gate-text)]">
      <header className="relative flex min-h-[88px] items-center justify-center px-5 py-4 sm:min-h-[116px]">
        <div className="flex items-center gap-3" aria-label={propertyName || 'OliTechs POS'}>
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-14 max-w-[150px] object-contain sm:h-20 sm:max-w-[190px]" />
          ) : (
            <>
              <div className="grid h-12 w-12 grid-cols-2 gap-1 text-[var(--pos-gate-accent)] sm:h-16 sm:w-16">
                <span className="rounded-sm border-[4px] border-current" />
                <span className="rounded-sm border-[4px] border-current" />
                <span className="rounded-sm border-[4px] border-current" />
                <span className="rounded-sm border-[4px] border-current" />
              </div>
              <div className="leading-none">
                <div className="text-3xl font-black tracking-tight text-[var(--pos-gate-accent)] sm:text-5xl">OLITECHS</div>
                <div className="mt-2 text-[9px] font-semibold tracking-[.48em] text-[var(--pos-gate-accent)] sm:text-xs">POINT OF SALE</div>
              </div>
            </>
          )}
        </div>
      </header>

      <section className="flex min-h-0 flex-1 flex-col items-center px-3 pb-3 sm:px-6">
        <div className="mb-5 flex shrink-0 flex-col items-center text-center sm:mb-8">
          <h1 className="text-xl font-medium tracking-wide sm:text-2xl">Enter PIN</h1>
          <p className="mt-1 max-w-[80vw] truncate text-xs text-[var(--pos-gate-muted)] sm:text-sm">{propertyName || 'POS Access'}</p>
          <div className="mt-4 flex items-center justify-center gap-3 sm:mt-5 sm:gap-4" aria-label={`${pin.length} of 4 PIN digits entered`}>
            {Array.from({ length: 4 }, (_, index) => (
              <span key={index} className={`h-7 w-7 rounded-full border-[3px] border-[var(--pos-gate-accent)] sm:h-8 sm:w-8 ${index < pin.length ? 'bg-[var(--pos-gate-accent)]' : 'bg-transparent'}`} />
            ))}
          </div>
          {error && <p role="alert" className="mt-3 text-sm font-semibold text-[var(--danger-text)]">{error}</p>}
          {busy && <p aria-live="polite" className="mt-2 text-xs text-[var(--pos-gate-muted)]">Verifying PIN…</p>}
        </div>

        <div className="grid w-full max-w-[1200px] flex-1 grid-cols-3 grid-rows-4 overflow-hidden border-l-2 border-t-2 border-[var(--pos-gate-border)] sm:w-[84vw]">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
            <button key={digit} type="button" onClick={() => enterDigit(digit)} disabled={busy || pin.length >= 4}
              className="flex min-h-0 items-center justify-center border-b-2 border-r-2 border-[var(--pos-gate-border)] bg-transparent text-3xl font-normal text-[var(--pos-gate-text)] transition-colors hover:bg-[var(--pos-gate-hover)] active:bg-[var(--pos-gate-active)] disabled:cursor-not-allowed disabled:opacity-60 sm:text-4xl">
              {digit}
            </button>
          ))}
          <div className="border-b-2 border-r-2 border-[var(--pos-gate-border)]" aria-hidden="true" />
          <button type="button" onClick={() => enterDigit(0)} disabled={busy || pin.length >= 4}
            className="flex min-h-0 items-center justify-center border-b-2 border-r-2 border-[var(--pos-gate-border)] bg-transparent text-3xl font-normal text-[var(--pos-gate-text)] transition-colors hover:bg-[var(--pos-gate-hover)] active:bg-[var(--pos-gate-active)] disabled:cursor-not-allowed disabled:opacity-60 sm:text-4xl">
            0
          </button>
          <button type="button" onClick={() => setPin('')} disabled={busy || !pin.length}
            className="flex min-h-0 items-center justify-center border-b-2 border-r-2 border-[var(--pos-gate-border)] bg-transparent text-2xl font-medium text-[var(--pos-gate-text)] transition-colors hover:bg-[var(--pos-gate-hover)] active:bg-[var(--pos-gate-active)] disabled:cursor-not-allowed disabled:opacity-60 sm:text-3xl">
            Clear
          </button>
        </div>
        <div className="mt-2 flex w-full max-w-[1200px] items-center justify-between px-1 text-[10px] text-[var(--pos-gate-muted)] sm:w-[84vw]">
          <span>{propertyName || 'OliTechs POS'}</span>
          {canManagePin && <button type="button" onClick={onAdminReset} className="text-xs font-semibold text-[#59c568] underline underline-offset-4">Reset POS PIN</button>}
        </div>
      </section>
    </main>
  );
}

export { POS_ACCESS_KEY };
