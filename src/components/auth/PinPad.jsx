import React, { useEffect, useState } from 'react';
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
}) {
  const [pin, setPin] = useState('');
  const [show, setShow] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    setPin('');
  }, [staffName]);

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

  return (
    <div className={fullscreen
      ? 'fixed inset-0 z-[300] flex min-h-screen items-center justify-center overflow-y-auto bg-canvas p-4'
      : 'fixed inset-0 z-[300] flex items-center justify-center bg-[var(--overlay-scrim)] p-4'
    } role="dialog" aria-modal="true" aria-label={title}>
      <div className={`w-full max-w-sm overflow-hidden rounded-3xl bg-surface shadow-2xl ${shake ? 'animate-[shake_.45s_ease-in-out]' : ''}`}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-primary text-primary-foreground">{brandLogo ? <img src={brandLogo} alt="" className="h-full w-full object-contain"/> : <Lock size={18}/>}</div>
            <div><div className="font-black text-foreground">{title}</div>{staffName && <div className="text-xs text-foreground/55">{staffName}</div>}</div>
          </div>
          {onClose && <button type="button" onClick={onClose} className="rounded-lg p-2 text-foreground/60 hover:bg-secondary hover:text-foreground" aria-label="Back to staff list"><X size={18}/></button>}
        </div>
        <div className="p-5">
          {subtitle && <p className="mb-4 text-center text-sm leading-6 text-foreground/65">{subtitle}</p>}
          <div className="mb-4 flex items-center justify-center gap-3 rounded-2xl bg-surface px-4 py-4">
            {Array.from({ length: pinLength }).map((_, i) => <span key={i} className={`h-3 w-3 rounded-full border-2 border-border ${i < pin.length ? 'bg-surface' : 'bg-transparent'}`} />)}
            <button type="button" onClick={() => setShow((v) => !v)} className="ml-2 text-foreground/55 hover:text-foreground" title={show ? 'Hide PIN' : 'Show PIN'} aria-label={show ? 'Hide PIN' : 'Show PIN'}>{show ? <EyeOff size={16}/> : <Eye size={16}/>}</button>
          </div>
          {show && pin && <div className="mb-3 text-center font-mono text-sm font-black tracking-[.4em] text-foreground">{pin}</div>}
          {error && <div role="alert" className="mb-3 rounded-xl bg-[var(--danger-soft)] px-3 py-2 text-center text-xs font-bold text-[var(--danger-text)]">{error}</div>}
          <div className="grid grid-cols-3 gap-2">
            {[1,2,3,4,5,6,7,8,9].map((n) => <button type="button" key={n} onClick={() => append(n)} disabled={busy || pin.length >= pinLength} className="h-14 rounded-xl bg-primary text-xl font-black text-foreground hover:brightness-95 active:scale-95">{n}</button>)}
            <button type="button" onClick={() => setPin('')} disabled={busy} className="h-14 rounded-xl border border-border bg-secondary text-xs font-black text-foreground hover:bg-secondary">Clear</button>
            <button type="button" onClick={() => append(0)} disabled={busy || pin.length >= pinLength} className="h-14 rounded-xl bg-primary text-xl font-black text-foreground hover:brightness-95 active:scale-95">0</button>
            <button type="button" onClick={() => setPin((v) => v.slice(0, -1))} disabled={busy || !pin.length} className="h-14 rounded-xl border border-border bg-secondary text-foreground hover:bg-secondary" aria-label="Delete last digit"><Delete className="mx-auto" size={19}/></button>
          </div>
          <button type="button" onClick={() => (pinLength === 6 ? pin.length >= 4 : pin.length === pinLength) && !busy && onSubmit(pin)} disabled={busy || (pinLength === 6 ? pin.length < 4 : pin.length !== pinLength)} className="mt-3 w-full rounded-xl bg-surface py-3 text-sm font-black text-foreground disabled:cursor-not-allowed disabled:opacity-40">{busy ? 'Verifying…' : 'Submit PIN'}</button>
          <div className="mt-3 text-center text-[10px] font-semibold uppercase tracking-widest text-foreground/35">{helperText || (pinLength === 4 ? '4-digit property POS access PIN' : '4–6 digit secure staff PIN')}</div>
        </div>
      </div>
    </div>
  );
}
