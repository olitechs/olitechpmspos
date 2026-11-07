import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Delete, Eye, EyeOff, Lock, X } from 'lucide-react';

export default function PinPad({
  onSubmit,
  title = 'Enter PIN',
  staffName = '',
  error = '',
  onClose,
  autoSubmit = false,
  fullscreen = false,
  pinLength = 6,
  subtitle = '',
  helperText = '',
  brandLogo = null,
  busy = false,
  footerAction = null,
}) {
  const [pin, setPin] = useState('');
  const [show, setShow] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    setPin('');
  }, [staffName]);

  useEffect(() => {
    if (!fullscreen || typeof document === 'undefined') return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [fullscreen]);

  useEffect(() => {
    if (!error) return undefined;
    setShake(true);
    const timer = window.setTimeout(() => setShake(false), 450);
    return () => window.clearTimeout(timer);
  }, [error]);

  const append = (digit) => {
    if (pin.length >= pinLength) return;
    const next = `${pin}${digit}`;
    setPin(next);
    // Four-, five- and six-digit PINs are all supported. Do not submit at
    // digit four: that would make valid five/six-digit PINs impossible to enter.
    if (autoSubmit && next.length === pinLength) window.setTimeout(() => onSubmit(next), 80);
  };

  const pad = (
    <div
      className={fullscreen
        ? 'fixed left-0 top-0 z-[9999] flex h-[100dvh] w-[100vw] items-center justify-center overflow-y-auto bg-[var(--canvas)] p-3 sm:p-5'
        : 'fixed inset-0 z-[300] flex items-center justify-center bg-[var(--overlay-scrim)] p-4'
      }
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={`flex max-h-full w-full flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl ${fullscreen ? 'max-w-md' : 'max-w-sm'} ${shake ? 'animate-[shake_.45s_ease-in-out]' : ''}`}>
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)]">{brandLogo ? <img src={brandLogo} alt="" className="h-full w-full object-contain"/> : <Lock size={18}/>}</div>
            <div className="min-w-0"><div className="font-black text-[var(--text)]">{title}</div>{staffName && <div className="truncate text-xs text-[var(--text-muted)]">{staffName}</div>}</div>
          </div>
          {onClose && <button type="button" onClick={onClose} className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--canvas)]" aria-label="Back to staff list"><X size={18}/></button>}
        </div>
        <div className="min-h-0 overflow-y-auto p-5">
          {subtitle && <p className="mb-4 text-center text-sm leading-6 text-[var(--text-muted)]">{subtitle}</p>}
          <div className="mb-4 flex min-h-14 items-center justify-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-4 py-3" aria-label="PIN entry">
            {Array.from({ length: pinLength }).map((_, i) => (
              <span key={i} className={`flex h-9 w-9 items-center justify-center rounded-lg border text-base font-bold ${i < pin.length ? 'border-[var(--primary)] bg-[var(--surface)] text-[var(--text)]' : 'border-[var(--border)] bg-[var(--surface)] text-transparent'}`}>
                {i < pin.length ? (show ? pin[i] : <span className="h-2.5 w-2.5 rounded-full bg-[var(--primary)]" />) : '•'}
              </span>
            ))}
            <button type="button" onClick={() => setShow((v) => !v)} className="ml-2 shrink-0 text-[var(--text-muted)] hover:text-[var(--text)]" title={show ? 'Hide PIN' : 'Show PIN'} aria-label={show ? 'Hide PIN' : 'Show PIN'}>{show ? <EyeOff size={16}/> : <Eye size={16}/>}</button>
          </div>
          {error && <div role="alert" className="mb-3 rounded-xl bg-[var(--danger-soft)] px-3 py-2 text-center text-xs font-bold text-[var(--danger-text)]">{error}</div>}
          <div className="grid grid-cols-3 gap-2">
            {[1,2,3,4,5,6,7,8,9].map((n) => <button type="button" key={n} onClick={() => append(n)} disabled={busy || pin.length >= pinLength} className="h-14 rounded-xl bg-[var(--primary)] text-xl font-black text-[var(--primary-foreground)] hover:hover:brightness-95 active:scale-95 disabled:opacity-50">{n}</button>)}
            <button type="button" onClick={() => setPin('')} disabled={busy} className="h-14 rounded-xl border border-[var(--border)] bg-[var(--canvas)] text-xs font-black text-[var(--text)]">Clear</button>
            <button type="button" onClick={() => append(0)} disabled={busy || pin.length >= pinLength} className="h-14 rounded-xl bg-[var(--primary)] text-xl font-black text-[var(--primary-foreground)] hover:hover:brightness-95 active:scale-95 disabled:opacity-50">0</button>
            <button type="button" onClick={() => setPin((v) => v.slice(0, -1))} disabled={busy || !pin.length} className="h-14 rounded-xl border border-[var(--border)] bg-[var(--canvas)] text-[var(--text)] disabled:opacity-50" aria-label="Delete last digit"><Delete className="mx-auto" size={19}/></button>
          </div>
          <button type="button" onClick={() => (pinLength === 6 ? pin.length >= 4 : pin.length === pinLength) && !busy && onSubmit(pin)} disabled={busy || (pinLength === 6 ? pin.length < 4 : pin.length !== pinLength)} className="mt-3 w-full rounded-xl bg-[var(--surface)] py-3 text-sm font-black text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40">{busy ? 'Verifying…' : 'Submit PIN'}</button>
          <div className="mt-3 text-center text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{helperText || (pinLength === 4 ? '4-digit property POS access PIN' : '4–6 digit secure staff PIN')}</div>
          {footerAction && <div className="mt-3 text-center">{footerAction}</div>}
        </div>
      </div>
    </div>
  );

  // Render outside the application shell so its module navigation, stacking
  // contexts and transformed parents can never appear above the locked screen.
  if (fullscreen && typeof document !== 'undefined') return createPortal(pad, document.body);
  return pad;
}
