// Secure employee invitation acceptance.
// Supabase Auth verifies the email action link and establishes the session.
// New users set their own password before the one-time database claim is used.
import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, MailX, LockKeyhole } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { employeeService } from '@/services/employeeService';
import BrandLogo from '@/components/ui/BrandLogo';

export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const queryToken = params.get('token') || '';
  const queryInvitationId = params.get('invitation_id') || '';
  const [token, setToken] = useState(queryToken);
  const [invitationId, setInvitationId] = useState(queryInvitationId);
  const { user, isLoadingAuth } = useAuth();
  const [status, setStatus] = useState(queryToken ? 'pending' : 'resolving');
  const [message, setMessage] = useState('');
  const [propertyId, setPropertyId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const processing = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (token || isLoadingAuth || !user) return undefined;
    (async () => {
      try {
        const { data: { user: authUser }, error } = await supabase.auth.getUser();
        if (error) throw error;
        const metadata = authUser?.user_metadata || {};
        if (typeof metadata.invitation_token === 'string' && metadata.invitation_token.length >= 16) {
          if (!cancelled) {
            setToken(metadata.invitation_token);
            setInvitationId(String(metadata.invitation_id || ''));
            setStatus('pending');
          }
        } else if (!cancelled) {
          setStatus('invalid');
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error?.message || 'We could not verify this invitation. Ask your administrator to resend it.');
          setStatus('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token, isLoadingAuth, user]);

  const finishAcceptance = async () => {
    if (processing.current || !token) return;
    processing.current = true;
    setBusy(true);
    try {
      const result = await employeeService.acceptInvitation(token);
      setPropertyId(result?.property_id || null);
      if (invitationId) {
        try { await employeeService.notifyInvitationAccepted(invitationId); }
        catch (notificationError) { console.warn('[invite] Notification queued for retry:', notificationError?.message); }
      }
      setStatus(result?.already_member ? 'already' : 'ok');
    } catch (error) {
      processing.current = false;
      setMessage(error?.message || 'This invitation could not be accepted.');
      setStatus('error');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!token || status !== 'pending' || isLoadingAuth || busy) return;
    if (!user) { setStatus('signin'); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data: { user: authUser }, error } = await supabase.auth.getUser();
        if (error) throw error;
        const metadata = authUser?.user_metadata || {};
        if (metadata.invitation_setup_required === true) {
          if (!cancelled) setStatus('setup_password');
          return;
        }
        if (!cancelled) await finishAcceptance();
      } catch (error) {
        if (!cancelled) {
          setMessage(error?.message || 'Could not verify your invitation session.');
          setStatus('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token, status, isLoadingAuth, user, busy]);

  const createPassword = async (event) => {
    event.preventDefault();
    if (password.length < 8) { setMessage('Use a password with at least 8 characters.'); return; }
    if (password !== confirmPassword) { setMessage('The passwords do not match.'); return; }
    setBusy(true);
    setMessage('');
    try {
      const { data: { user: authUser }, error: getUserError } = await supabase.auth.getUser();
      if (getUserError || !authUser) throw getUserError || new Error('Your verified invitation session has expired. Open the invitation email again.');
      const metadata = { ...(authUser.user_metadata || {}), invitation_setup_required: false };
      const { error } = await supabase.auth.updateUser({ password, data: metadata });
      if (error) throw error;
      await finishAcceptance();
    } catch (error) {
      setMessage(error?.message || 'Your password could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const signinHref = `/signin?redirect=${encodeURIComponent(`/accept-invite?token=${encodeURIComponent(token)}&invitation_id=${encodeURIComponent(invitationId)}`)}`;
  const homeHref = propertyId ? '/backoffice' : '/';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--canvas)] p-6">
      <div className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-[var(--shadow)]">
        <BrandLogo className="mx-auto h-10 w-auto object-contain" />
        {status === 'setup_password' && (
          <>
            <LockKeyhole size={38} className="mx-auto mt-6 text-[var(--primary)]" />
            <h1 className="mt-3 text-2xl font-black text-[var(--text)]">Secure your employee account</h1>
            <p className="mt-2 text-sm text-[var(--text-muted)]">Your email has been verified. Create a password to finish joining your property.</p>
            <form onSubmit={createPassword} className="mt-5 space-y-3 text-left">
              <label className="block text-xs font-bold text-[var(--text-muted)]">Create password
                <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-sm text-[var(--text)]" />
              </label>
              <label className="block text-xs font-bold text-[var(--text-muted)]">Confirm password
                <input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-sm text-[var(--text)]" />
              </label>
              {message && <p className="text-sm text-[var(--danger)]">{message}</p>}
              <button disabled={busy} className="w-full rounded-xl bg-[var(--primary)] px-5 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50">{busy ? 'Securing account…' : 'Create password and accept invitation'}</button>
            </form>
          </>
        )}
        {status === 'ok' && (
          <>
            <CheckCircle2 size={40} className="mx-auto mt-6 text-[var(--success-text)]" />
            <h1 className="mt-3 text-2xl font-black text-[var(--text)]">Welcome to the team</h1>
            <p className="mt-2 text-sm text-[var(--text-muted)]">Your employee account is active for this property. Your administrator controls your assigned workspaces.</p>
            <Link to={homeHref} className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-[var(--primary)] px-6 text-sm font-bold text-primary-foreground">Open OliTechs</Link>
          </>
        )}
        {status === 'already' && (
          <>
            <CheckCircle2 size={40} className="mx-auto mt-6 text-[var(--success-text)]" />
            <h1 className="mt-3 text-2xl font-black text-[var(--text)]">Invitation already accepted</h1>
            <p className="mt-2 text-sm text-[var(--text-muted)]">This account is already a member of the invited property.</p>
            <Link to={homeHref} className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-[var(--primary)] px-6 text-sm font-bold text-primary-foreground">Open OliTechs</Link>
          </>
        )}
        {status === 'signin' && (
          <>
            <MailX size={40} className="mx-auto mt-6 text-[var(--text-muted)]" />
            <h1 className="mt-3 text-2xl font-black text-[var(--text)]">Sign in to accept</h1>
            <p className="mt-2 text-sm text-[var(--text-muted)]">Sign in using the exact email address the invitation was sent to. Your existing password will remain unchanged.</p>
            <Link to={signinHref} className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-[var(--primary)] px-6 text-sm font-bold text-primary-foreground">Sign in</Link>
          </>
        )}
        {(status === 'error' || status === 'invalid') && (
          <>
            <MailX size={40} className="mx-auto mt-6 text-[var(--danger)]" />
            <h1 className="mt-3 text-2xl font-black text-[var(--text)]">Invitation unavailable</h1>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{status === 'invalid' ? 'This invitation link is missing its secure token or verified session.' : message}</p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">Ask your property administrator to resend the invitation.</p>
            <Link to="/signin" className="mt-6 inline-flex min-h-11 items-center rounded-xl border border-[var(--border)] px-6 text-sm font-bold text-[var(--text)]">Go to sign in</Link>
          </>
        )}
        {(status === 'pending' || status === 'resolving') && <p className="mt-6 text-sm text-[var(--text-muted)]">Verifying your invitation…</p>}
        {busy && status !== 'setup_password' && <p className="mt-4 text-xs text-[var(--text-muted)]">Please wait…</p>}
      </div>
    </div>
  );
}
