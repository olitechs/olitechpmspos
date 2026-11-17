// Full-screen manager authorization.
//
// This is deliberately a dedicated full-viewport screen — NOT a modal dialog —
// so a restricted employee always understands that a privileged action is
// pending an approval, and nothing of the underlying screen remains
// interactive while it is open.
//
// Two approval paths, both verified server-side:
//   * the approving manager's own 6-digit PIN -> fn_verify_manager_authorization
//     (bcrypt-hashed credentials, rate limited: 5 failures / 10 min -> 5 min lock)
//   * the approving manager's email + password -> the manager-authorize edge
//     function (Supabase Auth verifies the password) which writes a single-use,
//     90-second ticket redeemed by fn_redeem_manager_authorization_ticket.
//
// A manager can never approve a permission they do not hold, and nobody can
// approve with their own PIN. Every attempt is written to employee_access_audit.

import React, { useEffect, useState } from 'react';
import { LockKeyhole, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { employeeService } from '@/services/employeeService';

const PIN_LENGTH = 6;

export default function ManagerAuthorizationScreen({
  title = 'Manager authorization required',
  description,
  permissionCode,
  permissionLabel,
  durationMinutes = 60,
  onAuthorized,
  onClose,
}) {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [mode, setMode] = useState('pin'); // 'pin' | 'password'
  const [pin, setPin] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attemptsRemaining, setAttemptsRemaining] = useState(null);
  const [lockSeconds, setLockSeconds] = useState(0);

  // Countdown for the server-imposed lock so the UI cannot retry early.
  useEffect(() => {
    if (lockSeconds <= 0) return undefined;
    const timer = setInterval(() => setLockSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [lockSeconds]);

  const applyFailure = (err) => {
    const reason = err?.reason || '';
    if (reason === 'locked') {
      setLockSeconds(Number(err.retry_after_seconds || 300));
      setError('Too many failed attempts. Authorization is locked — try again later.');
      return;
    }
    if (reason === 'wrong_pin') {
      setAttemptsRemaining(Number.isFinite(err.attempts_remaining) ? err.attempts_remaining : null);
      setError(`Incorrect manager PIN.${Number.isFinite(err.attempts_remaining) ? ` ${err.attempts_remaining} attempt(s) remaining before a temporary lock.` : ''}`);
      return;
    }
    if (reason === 'manager_not_authorized') {
      setError('The approving manager is not authorized to grant this permission.');
      return;
    }
    if (reason === 'no_manager_pin') {
      setError('No manager has set an authorization PIN yet. Use the manager email & password option, or set a PIN in Back Office → Employees → PIN & Security.');
      return;
    }
    setError(err?.message || 'Manager authorization failed.');
  };

  const submitPin = async (e) => {
    e.preventDefault();
    if (busy || lockSeconds > 0) return;
    if (!/^\d{6}$/.test(pin)) {
      setError('Enter the manager’s 6-digit PIN.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await employeeService.authorizeWithPin(propertyId, permissionCode, pin, durationMinutes);
      if (result?.ok) {
        toast.success(`Authorized by ${result.manager?.name || 'a manager'} until ${new Date(result.grant?.expires_at).toLocaleTimeString()}`);
        onAuthorized?.(result);
      } else {
        applyFailure({ reason: result?.reason, ...result });
      }
    } catch (err) {
      applyFailure(err);
    } finally {
      setPin('');
      setBusy(false);
    }
  };

  const submitPassword = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!managerEmail.trim() || !managerPassword) {
      setError('Enter the manager’s email and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await employeeService.authorizeWithPassword(propertyId, permissionCode, {
        managerEmail: managerEmail.trim(),
        managerPassword,
      }, durationMinutes);
      if (result?.ok) {
        toast.success('Manager authorization granted.');
        onAuthorized?.(result);
      } else {
        applyFailure({ reason: result?.reason, ...result });
      }
    } catch (err) {
      if (err.reason === 'wrong_credentials') setError('Manager email or password is incorrect.');
      else applyFailure(err);
    } finally {
      setManagerPassword('');
      setBusy(false);
    }
  };

  const inputClass = 'w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] outline-none focus:border-[var(--brand-primary)]';

  return (
    <div className="fixed inset-0 z-[300] flex flex-col overflow-y-auto bg-[var(--canvas)]" role="dialog" aria-modal="true" aria-label={title}>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4">
        <div className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
          OliTechs PMS + POS
        </div>
        <button type="button" onClick={onClose} className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-xs font-bold text-[var(--text)] hover:bg-[var(--primary-soft)]" aria-label="Cancel authorization">
          <X size={15} /> Cancel
        </button>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-[var(--shadow)]">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--primary-soft)] text-[var(--primary)]">
            <LockKeyhole size={28} />
          </div>
          <h1 className="mt-5 text-2xl font-black text-[var(--text)]">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
            {description || 'This action needs an approving manager. Authorization is logged and time-limited.'}
          </p>
          {permissionLabel && (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-[var(--canvas)] px-3 py-2.5 text-sm text-[var(--text)]">
              <ShieldCheck size={16} className="text-[var(--primary)]" aria-hidden="true" />
              <span className="font-semibold">{permissionLabel}</span>
            </div>
          )}

          <div className="mt-5 flex gap-1 rounded-xl bg-[var(--canvas)] p-1" role="tablist" aria-label="Approval method">
            <button type="button" role="tab" aria-selected={mode === 'pin'}
              onClick={() => { setMode('pin'); setError(''); }}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold transition ${mode === 'pin' ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow)]' : 'text-[var(--text-muted)]'}`}>
              Manager PIN
            </button>
            <button type="button" role="tab" aria-selected={mode === 'password'}
              onClick={() => { setMode('password'); setError(''); }}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold transition ${mode === 'password' ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow)]' : 'text-[var(--text-muted)]'}`}>
              Email &amp; password
            </button>
          </div>

          {error && (
            <p role="alert" className="mt-4 rounded-xl bg-[var(--danger-soft)] px-3 py-2.5 text-sm font-medium text-[var(--danger-text)]">{error}</p>
          )}

          {mode === 'pin' ? (
            <form onSubmit={submitPin} className="mt-4">
              <label htmlFor="manager-auth-pin" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Manager PIN</label>
              <input
                id="manager-auth-pin"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
                placeholder={`${PIN_LENGTH} digits`}
                className={`mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-center text-2xl font-bold tracking-[0.5em] text-[var(--text)] outline-none focus:border-[var(--brand-primary)]`}
                disabled={busy || lockSeconds > 0}
              />
              <button type="submit" disabled={busy || lockSeconds > 0 || pin.length !== PIN_LENGTH}
                className="mt-3 min-h-12 w-full rounded-xl bg-[var(--primary)] px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">
                {busy ? 'Verifying…' : lockSeconds > 0 ? `Locked — retry in ${lockSeconds}s` : 'Authorize'}
              </button>
            </form>
          ) : (
            <form onSubmit={submitPassword} className="mt-4">
              <label htmlFor="manager-auth-email" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Manager email</label>
              <input id="manager-auth-email" type="email" autoComplete="email" value={managerEmail}
                onChange={(e) => setManagerEmail(e.target.value)}
                className={`mt-1 ${inputClass}`} disabled={busy} />
              <label htmlFor="manager-auth-password" className="mt-3 block text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Manager password</label>
              <input id="manager-auth-password" type="password" autoComplete="current-password" value={managerPassword}
                onChange={(e) => setManagerPassword(e.target.value)}
                className={`mt-1 ${inputClass}`} disabled={busy} />
              <button type="submit" disabled={busy}
                className="mt-3 min-h-12 w-full rounded-xl bg-[var(--primary)] px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">
                {busy ? 'Verifying…' : 'Authorize'}
              </button>
            </form>
          )}

          <p className="mt-5 text-[11px] leading-5 text-[var(--text-muted)]">
            The approving manager must hold this permission. PINs are hashed server-side, attempts are rate-limited, and the approval is recorded in the access history with an expiry.
          </p>
        </div>
      </main>
    </div>
  );
}
