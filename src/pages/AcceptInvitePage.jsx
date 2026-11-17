// Public invitation acceptance screen.
//
// The invitee arrives from their email link with a one-time token. They must
// already be signed in with the invited email address (the server verifies
// the match); otherwise they are pointed to sign in / sign up first. The
// token is consumed by fn_accept_employee_invitation, which bcrypt-verifies
// it and binds their auth user to the invited employee identity.

import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, MailX } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { employeeService } from '@/services/employeeService';
import BrandLogo from '@/components/ui/BrandLogo';

export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { user, isLoadingAuth } = useAuth();
  const [status, setStatus] = useState(token ? 'pending' : 'invalid'); // pending | ok | error
  const [message, setMessage] = useState('');
  const [propertyId, setPropertyId] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token || status !== 'pending' || isLoadingAuth || busy) return;
    if (!user) {
      // The invitee has not signed in yet. Preserve the token through the
      // sign-in flow and come straight back here.
      setStatus('signin');
      return;
    }
    setBusy(true);
    employeeService.acceptInvitation(token)
      .then((result) => {
        setPropertyId(result?.property_id || null);
        setStatus(result?.already_member ? 'already' : 'ok');
      })
      .catch((e) => {
        setMessage(e.message || 'This invitation could not be accepted.');
        setStatus('error');
      })
      .finally(() => setBusy(false));
  }, [token, status, isLoadingAuth, user, busy]);

  const signinHref = `/signin?redirect=${encodeURIComponent(`/accept-invite?token=${encodeURIComponent(token)}`)}`;
  const homeHref = propertyId ? '/backoffice' : '/';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--canvas)] p-6">
      <div className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-[var(--shadow)]">
        <BrandLogo className="mx-auto h-10 w-auto object-contain" />
        {status === 'ok' && (
          <>
            <CheckCircle2 size={40} className="mx-auto mt-6 text-[var(--success-text)]" aria-hidden="true" />
            <h1 className="mt-3 text-2xl font-black text-[var(--text)]">Welcome to the team</h1>
            <p className="mt-2 text-sm text-[var(--text-muted)]">Your employee account is now active for this property. Sign-in stays the same.</p>
            <Link to={homeHref} className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-[var(--primary)] px-6 text-sm font-bold text-primary-foreground">Open the app</Link>
          </>
        )}
        {status === 'already' && (
          <>
            <CheckCircle2 size={40} className="mx-auto mt-6 text-[var(--success-text)]" aria-hidden="true" />
            <h1 className="mt-3 text-2xl font-black text-[var(--text)]">You are already a member</h1>
            <p className="mt-2 text-sm text-[var(--text-muted)]">This invitation was already accepted by your account.</p>
            <Link to={homeHref} className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-[var(--primary)] px-6 text-sm font-bold text-primary-foreground">Open the app</Link>
          </>
        )}
        {status === 'signin' && (
          <>
            <MailX size={40} className="mx-auto mt-6 text-[var(--text-muted)]" aria-hidden="true" />
            <h1 className="mt-3 text-2xl font-black text-[var(--text)]">Sign in to accept</h1>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Create your account or sign in with the <b>email address the invitation was sent to</b>, then this page will finish automatically.
            </p>
            <Link to={signinHref} className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-[var(--primary)] px-6 text-sm font-bold text-primary-foreground">Sign in / create account</Link>
          </>
        )}
        {(status === 'error' || status === 'invalid') && (
          <>
            <MailX size={40} className="mx-auto mt-6 text-[var(--danger)]" aria-hidden="true" />
            <h1 className="mt-3 text-2xl font-black text-[var(--text)]">Invitation unavailable</h1>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              {status === 'invalid' ? 'This invitation link is missing its token.' : message}
            </p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">Ask your administrator to resend the invitation.</p>
            <Link to="/signin" className="mt-6 inline-flex min-h-11 items-center rounded-xl border border-[var(--border)] px-6 text-sm font-bold text-[var(--text)]">Go to sign in</Link>
          </>
        )}
        {status === 'pending' && <p className="mt-6 text-sm text-[var(--text-muted)]">Validating your invitation…</p>}
      </div>
    </div>
  );
}
