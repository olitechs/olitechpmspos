import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock3, LockKeyhole } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { evaluateSubscriptionAccess } from '@/lib/subscriptionAccess';
import { breakdownRemaining, formatSubscriptionDate } from '@/lib/subscriptionCountdown';

const URGENT_SECONDS = 48 * 60 * 60;
const TICK_MS = 60_000;

// Persistent trial countdown. It only presents the server entitlement; the
// database remains authoritative for whether the workspace is allowed.
export default function TrialBanner() {
  const { user } = useAuth();
  const access = evaluateSubscriptionAccess(user);
  const ent = user?.entitlement || {};
  const trialEndsAt = ent.trial_ends_at || user?.subscription?.trial_ends_at || null;
  const isTrial = !access.blocked
    && ['trial', 'expiring_soon'].includes(access.state)
    && Boolean(trialEndsAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isTrial) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [isTrial]);

  const seconds = useMemo(() => {
    const serverSeconds = Number(ent.seconds_remaining);
    if (Number.isFinite(serverSeconds) && serverSeconds >= 0) {
      const evaluatedAt = new Date(ent.evaluated_at).getTime();
      const elapsed = Number.isFinite(evaluatedAt) ? Math.max(0, (now - evaluatedAt) / 1000) : 0;
      return Math.max(0, Math.floor(serverSeconds - elapsed));
    }
    const end = new Date(trialEndsAt).getTime();
    return Number.isFinite(end) ? Math.max(0, Math.floor((end - now) / 1000)) : 0;
  }, [ent.seconds_remaining, ent.evaluated_at, trialEndsAt, now]);

  if (!isTrial) return null;

  const remaining = breakdownRemaining(seconds);
  const urgent = seconds <= URGENT_SECONDS;
  const label = remaining.days > 0
    ? `${remaining.days}d ${remaining.hours}h left`
    : remaining.hours > 0
      ? `${remaining.hours}h ${remaining.minutes}m left`
      : `${remaining.minutes}m left`;
  const canManageBilling = user?.isPlatformOwner
    || ['owner', 'admin'].includes(String(user?.propertyRole || '').toLowerCase());

  return (
    <div
      role="status"
      className={[
        'flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2 text-xs sm:px-4',
        urgent
          ? 'border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger-text)]'
          : 'border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning-text)]',
      ].join(' ')}
    >
      <span className="inline-flex items-center gap-2 font-bold">
        {urgent ? <LockKeyhole size={15} aria-hidden="true" /> : <Clock3 size={15} aria-hidden="true" />}
        {urgent ? 'Trial expires soon' : 'Free trial'}
      </span>
      <span className="min-w-0 flex-1">
        Your Professional trial ends on <strong>{formatSubscriptionDate(trialEndsAt)}</strong>.
        {urgent ? ' Subscribe now to avoid interruption.' : ' Subscribe before it ends to keep every module.'}
      </span>
      <span className={[
        'rounded-full px-2.5 py-1 font-bold',
        urgent ? 'bg-[var(--danger)] text-[var(--white)]' : 'bg-[var(--warning)] text-[var(--white)]',
      ].join(' ')}>
        {label}
      </span>
      {canManageBilling ? (
        <Link
          to="/backoffice/settings/billing"
          className="rounded-md bg-[var(--brand-primary)] px-3 py-1.5 font-bold text-[var(--white)] hover:opacity-90"
        >
          {urgent ? 'Subscribe now' : 'Upgrade now'}
        </Link>
      ) : (
        <span className="font-semibold">Ask your administrator to renew</span>
      )}
    </div>
  );
}
