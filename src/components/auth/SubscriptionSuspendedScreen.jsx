import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, LifeBuoy, LogOut, Mail, RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import SubscriptionPanel from '@/components/admin/SubscriptionPanel';
import { pmsService } from '@/services/pmsService';
import { formatSubscriptionDate, describeRemaining } from '@/lib/subscriptionCountdown';

// Full-page subscription suspension screen (Phase 4/6).
//
// Rendered by ProtectedRoute for every blocked entitlement across all four
// workspaces. Operational navigation and actions are intentionally absent —
// the owner keeps exactly the renewal, billing and support routes.
// The server-computed entitlement remains authoritative; this screen only
// presents the values the database returned.
export default function SubscriptionSuspendedScreen() {
  const { user, logout } = useAuth();
  const ent = user?.entitlement || {};
  const state = String(ent.state || 'expired');
  const graceSeconds = Number(ent.seconds_of_grace_remaining || 0);
  const [requesting, setRequesting] = useState(false);
  const [requestStatus, setRequestStatus] = useState(null);
  const [requestError, setRequestError] = useState('');

  const requestRenewal = async () => {
    if (!user?.property?.id || requesting || requestStatus?.notification_status === 'sent') return;
    setRequesting(true);
    setRequestError('');
    try {
      const result = await pmsService.requestSubscriptionRenewal(user.property.id);
      setRequestStatus(result);
    } catch (error) {
      setRequestError(error?.message || 'Could not send the renewal request. Please contact OliTechs support.');
    } finally {
      setRequesting(false);
    }
  };

  const heading = state === 'grace_period'
    ? 'Your subscription has expired. You are currently in the grace period.'
    : state === 'suspended' || state === 'cancelled'
      ? 'Your property access is currently suspended.'
      : 'Your OliTechs subscription has expired.';

  const detail = state === 'grace_period'
    ? 'Your property can still operate during the configured grace period, but renewal is required to continue after it ends.'
    : 'Your property\'s access to operational modules has been temporarily suspended because the subscription and grace period have ended. Your data is preserved.';

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-4 py-10 text-[var(--text)]">
      <div className="w-full max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm sm:p-8">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-lg bg-[var(--warning-soft)] p-2 text-[var(--warning-text)]">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-bold leading-snug sm:text-xl">{heading}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
          </div>
        </div>

        <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] p-3">
            <dt className="text-xs font-medium text-muted-foreground">Property</dt>
            <dd className="mt-0.5 font-semibold">{user?.property?.name || user?.property?.business_name || '—'}</dd>
          </div>
          <div className="rounded-xl border border-[var(--border)] p-3">
            <dt className="text-xs font-medium text-muted-foreground">Package</dt>
            <dd className="mt-0.5 font-semibold capitalize">{ent.plan_code || ent.package || user?.property?.package || '—'}</dd>
          </div>
          <div className="rounded-xl border border-[var(--border)] p-3">
            <dt className="text-xs font-medium text-muted-foreground">Subscription expiry</dt>
            <dd className="mt-0.5 font-semibold">{formatSubscriptionDate(ent.period_ends_at)}</dd>
          </div>
          <div className="rounded-xl border border-[var(--border)] p-3">
            <dt className="text-xs font-medium text-muted-foreground">Grace period ends</dt>
            <dd className="mt-0.5 font-semibold">
              {formatSubscriptionDate(ent.grace_ends_at)}
              {graceSeconds > 0 && <span className="ml-1 font-normal text-muted-foreground">({describeRemaining(graceSeconds)} remaining)</span>}
            </dd>
          </div>
          <div className="rounded-xl border border-[var(--border)] p-3 sm:col-span-2">
            <dt className="text-xs font-medium text-muted-foreground">Current status</dt>
            <dd className="mt-0.5 font-semibold capitalize">{state.replace(/_/g, ' ')}</dd>
          </div>
        </dl>

        <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--brand-primary)]/5 p-4 text-sm">
          <p className="font-semibold">To restore access</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted-foreground">
            <li>Open Billing &amp; Subscriptions and confirm the renewal with the OliTechs platform team.</li>
            <li>Once the platform confirms the renewal, access is restored automatically — no data is lost.</li>
          </ol>
        </div>

        <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Need to renew your subscription?</p>
              <p className="mt-1 text-xs text-muted-foreground">Send a renewal request directly to the OliTechs Platform team.</p>
            </div>
            <button
              type="button"
              onClick={requestRenewal}
              disabled={requesting || requestStatus?.notification_status === 'sent'}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--white)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {requesting ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
              {requesting ? 'Sending request…' : requestStatus?.notification_status === 'sent' ? 'Request sent' : 'Renew Subscription'}
            </button>
          </div>
          {requestStatus?.notification_status === 'sent' && (
            <p className="mt-3 flex items-start gap-2 text-sm text-[var(--success-text)]">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Your renewal request has been emailed to info@olitechs.co.ke and olitechs2025@gmail.com. The platform team must confirm renewal before access is restored.
            </p>
          )}
          {requestError && <p role="alert" className="mt-3 text-sm text-[var(--danger-text)]">{requestError}</p>}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            to="/backoffice/settings/billing"
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-[var(--white)] hover:opacity-90"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Open Billing &amp; Subscriptions
          </Link>
          <a
            href="mailto:support@olitechs.com?subject=Subscription%20renewal"
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--surface)]"
          >
            <LifeBuoy className="h-4 w-4" aria-hidden="true" />
            Contact support
          </a>
          <button
            type="button"
            onClick={() => logout?.()}
            className="ml-auto inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-[var(--text)]"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}

// Minimal billing-only shell for a blocked property. Used instead of the
// workspace layout on the exempted renewal path so the owner keeps billing
// and support access WITHOUT operational navigation being rendered.
export function SubscriptionBillingOnlyScreen() {
  const { user, logout } = useAuth();
  const state = String(user?.entitlement?.state || 'expired');
  return (
    <main className="flex min-h-screen flex-col bg-[var(--canvas)] text-[var(--text)]">
      <header className="flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 sm:px-6">
        <div className="h-8 w-8 rounded-lg bg-[var(--brand-primary)]/15" />
        <span className="text-sm font-bold tracking-wide">OliTechs</span>
        <span className="ml-2 hidden rounded-full border border-[var(--warning)] bg-[var(--warning-soft)] px-2.5 py-1 text-xs font-bold text-[var(--warning-text)] sm:inline">
          Billing access only — subscription {state.replace(/_/g, ' ')}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <a
            href="mailto:support@olitechs.com?subject=Subscription%20renewal"
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--surface)]"
          >
            <LifeBuoy className="h-4 w-4" aria-hidden="true" />
            Support
          </a>
          <button
            type="button"
            onClick={() => logout?.()}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-[var(--text)]"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        <SubscriptionPanel />
      </div>
    </main>
  );
}
