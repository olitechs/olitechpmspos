// Public invitation acceptance screen.
//
// Supabase's built-in invite email verifies its own token_hash and redirects
// back to this page with a session (not our application token in the query
// string). The employee-invite Edge Function stores our one-time claim token
// in auth user_metadata, so resolve it from the verified Supabase user when
// the email link is used. Manual fallback links continue to use ?token=.

import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, MailX } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { employeeService } from '@/services/employeeService';
import BrandLogo from '@/components/ui/BrandLogo';

export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const queryToken = params.get('token') || '';
  const [token, setToken] = useState(queryToken);
  const { user, isLoadingAuth } = useAuth();
  const [status, setStatus] = useState(queryToken ? 'pending' : 'resolving'); // resolving | pending | signin | ok | already | error | invalid
  const [message, setMessage] = useState('');
  const [propertyId, setPropertyId] = useState(null);
  const [busy, setBusy] = useState(false);

  // Supabase invite links carry a Supabase verification token, then establish
  // a session and redirect here. The separate employee claim token is in the
  // invited user's metadata; it is deliberately not exposed in the email URL.
  useEffect(() => {
    let cancelled = false;
    if (token || isLoadingAuth) return undefined;

    (async () => {
      try {
        const { data: { user: authUser }, error } = await supabase.auth.getUser();
        if (error) throw error;
        const metadataToken = authUser?.user_metadata?.invitation_token;
        if (typeof metadataToken === 'string' && metadataToken.length >= 16) {
          if (!cancelled) {
            setToken(metadataToken);
            setStatus('pending');
          }
          return;
        }
        if (!cancelled) setStatus('invalid');
      } catch (error) {
        if (!cancelled) {
          setMessage(error?.message || 'We could not verify this invitation. Please ask your administrator to resend it.');
          setStatus('error');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [token, isLoadingAuth]);

  useEffect(() => {
    if (!token || status !== 'pending' || isLoadingAuth || busy) return;
    if (!user) {
      // Preserve a manual claim token through the sign-in flow. Supabase
      // email invitations normally establish the session before this page.
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
              {status === 'invalid' ? 'This invitation link is missing its token or the invitation session could not be verified.' : message}
            </p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">Ask your administrator to resend the invitation.</p>
            <Link to="/signin" className="mt-6 inline-flex min-h-11 items-center rounded-xl border border-[var(--border)] px-6 text-sm font-bold text-[var(--text)]">Go to sign in</Link>
          </>
        )}
        {(status === 'pending' || status === 'resolving') && <p className="mt-6 text-sm text-[var(--text-muted)]">Validating your invitation…</p>}
      </div>
    </div>
  );
}
