import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, LifeBuoy, LogOut, Mail, RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import SubscriptionPanel from '@/components/admin/SubscriptionPanel';
import SubscriptionRequestModal from '@/components/subscription/SubscriptionRequestModal';
import { formatSubscriptionDate, describeRemaining } from '@/lib/subscriptionCountdown';
import { SUBSCRIPTION_SUPPORT_EMAILS, evaluateSubscriptionAccess } from '@/lib/subscriptionAccess';

// Full-page subscription lockout screen.
//
// Rendered by PublicRoute/ProtectedRoute for expired, suspended or cancelled
// properties across all four workspaces. Operational navigation and actions
// are intentionally absent — the owner keeps only renewal, billing and support.
// The database entitlement is authoritative; this screen shows the computed
// decision beside the stored status so an expired row marked `active` is
// unambiguous.
export default function SubscriptionSuspendedScreen() {
  const { user, logout } = useAuth();
  const ent = user?.entitlement || {};
  const access = evaluateSubscriptionAccess(user);
  const state = access.state || 'expired';
  const graceSeconds = Number(ent.seconds_of_grace_remaining || 0);
  const [requestOpen, setRequestOpen] = useState(false);

  const storedStatus = ent.subscription_status
    || user?.subscription?.status
    || user?.subscription?.subscription_status
    || user?.property?.status
    || '—';
  const periodEndsAt = access.periodEndsAt || ent.period_ends_at;
  const graceEndsAt = access.graceEndsAt || ent.grace_ends_at;
  const datesElapsed = ['server_dates', 'subscription_dates'].includes(access.source);
  const canManageBilling = ['owner', 'admin'].includes(String(user?.propertyRole || '').toLowerCase());
  const planName = ent.plan_code || ent.package || user?.property?.package || 'professional';

  const heading = state === 'unavailable'
    ? 'Subscription status could not be verified.'
    : state === 'grace_period'
    ? 'Your subscription has expired. You are currently in the grace period.'
    : state === 'suspended' || state === 'cancelled'
      ? 'Your property access is currently suspended.'
      : 'Your OliTechs subscription has expired.';

  const detail = state === 'unavailable'
    ? 'Operational access is locked until OliTechs can verify the subscription status. Please retry later or contact support.'
    : state === 'grace_period'
    ? 'Your property can still operate during the configured grace period, but renewal is required to continue after it ends.'
    : datesElapsed
      ? 'Your subscription and grace period have ended. Operational access is locked until the subscription is renewed. Your data is preserved.'
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
            <dd className="mt-0.5 font-semibold capitalize">{planName}</dd>
          </div>
          <div className="rounded-xl border border-[var(--border)] p-3">
            <dt className="text-xs font-medium text-muted-foreground">Subscription expiry</dt>
            <dd className="mt-0.5 font-semibold">{formatSubscriptionDate(periodEndsAt)}</dd>
          </div>
          <div className="rounded-xl border border-[var(--border)] p-3">
            <dt className="text-xs font-medium text-muted-foreground">Grace period ends</dt>
            <dd className="mt-0.5 font-semibold">
              {formatSubscriptionDate(graceEndsAt)}
              {graceSeconds > 0 && <span className="ml-1 font-normal text-muted-foreground">({describeRemaining(graceSeconds)} remaining)</span>}
            </dd>
          </div>
          <div className="rounded-xl border border-[var(--border)] p-3">
            <dt className="text-xs font-medium text-muted-foreground">Computed access status</dt>
            <dd className="mt-0.5 font-semibold capitalize">{state.replace(/_/g, ' ')}</dd>
          </div>
          <div className="rounded-xl border border-[var(--border)] p-3">
            <dt className="text-xs font-medium text-muted-foreground">Stored subscription status</dt>
            <dd className="mt-0.5 font-semibold capitalize">{String(storedStatus).replaceAll('_', ' ')}</dd>
          </div>
        </dl>

        {datesElapsed && (
          <p className="mt-4 rounded-xl border border-[var(--warning)] bg-[var(--warning-soft)] p-3 text-xs leading-5 text-[var(--warning-text)]">
            A stored <strong>active</strong> status does not override the subscription expiry and grace dates. The elapsed dates are authoritative.
          </p>
        )}

        <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--brand-primary)]/5 p-4 text-sm">
          <p className="font-semibold">To restore access</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted-foreground">
            <li>Submit the renewal form below so the platform team receives your request and package details.</li>
            <li>Once the platform confirms the renewal, access is restored automatically — no data is lost.</li>
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">Support: {SUBSCRIPTION_SUPPORT_EMAILS.join(' and ')}</p>
        </div>

        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Need to renew your subscription?</p>
              <p className="mt-1 text-xs text-muted-foreground">Send a renewal request directly to the OliTechs Platform team.</p>
            </div>
            {canManageBilling ? (
              <button
                type="button"
                onClick={() => setRequestOpen(true)}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--white)] hover:opacity-90"
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
                Renew Subscription
              </button>
            ) : (
              <span className="shrink-0 rounded-lg border border-[var(--border)] bg-canvas px-3 py-2 text-xs font-semibold text-muted-foreground">Ask your administrator to renew</span>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            to="/backoffice/settings/billing"
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-[var(--white)] hover:opacity-90"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Open Billing &amp; Subscriptions
          </Link>
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
      {canManageBilling && (
        <SubscriptionRequestModal
          open={requestOpen}
          onOpenChange={setRequestOpen}
          requestKind="renewal"
          packageName={planName}
        />
      )}
    </main>
  );
}

// Minimal billing-only shell for a blocked property. Used instead of the
// workspace layout on the exempted renewal path so the owner keeps billing
// and support access WITHOUT operational navigation being rendered.
export function SubscriptionBillingOnlyScreen() {
  const { user, logout } = useAuth();
  const state = evaluateSubscriptionAccess(user).state || 'expired';
  const [requestOpen, setRequestOpen] = useState(false);
  const canManageBilling = ['owner', 'admin'].includes(String(user?.propertyRole || '').toLowerCase());
  const planName = user?.property?.package || user?.entitlement?.plan_code || 'professional';
  return (
    <main className="flex min-h-screen flex-col bg-[var(--canvas)] text-[var(--text)]">
      <header className="flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 sm:px-6">
        <div className="h-8 w-8 rounded-lg bg-[var(--brand-primary)]/15" />
        <span className="text-sm font-bold tracking-wide">OliTechs</span>
        <span className="ml-2 hidden rounded-full border border-[var(--warning)] bg-[var(--warning-soft)] px-2.5 py-1 text-xs font-bold text-[var(--warning-text)] sm:inline">
          Billing access only — subscription {state.replace(/_/g, ' ')}
        </span>
        <div className="ml-auto flex items-center gap-3">
          {canManageBilling ? (
            <button
              type="button"
              onClick={() => setRequestOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--surface)]"
            >
              <LifeBuoy className="h-4 w-4" aria-hidden="true" />
              Subscribe / Renew
            </button>
          ) : (
            <span className="text-xs font-semibold text-muted-foreground">Administrator only</span>
          )}
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
      {canManageBilling && (
        <SubscriptionRequestModal
          open={requestOpen}
          onOpenChange={setRequestOpen}
          requestKind="renewal"
          packageName={planName}
        />
      )}
    </main>
  );
}
