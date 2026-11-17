// Subscription countdown helpers (Phases 3/6).
//
// All authorization decisions come from the server entitlement; these helpers
// only PRESENT server-provided timestamps. Dates render in the property-facing
// timezone (Africa/Nairobi, shared with the rest of the app via PMS_TIME_ZONE)
// while remaining arithmetic uses the raw server timestamps so no browser
// clock or timezone conversion can shift a cutoff.

import { PMS_TIME_ZONE } from '@/lib/pmsDateUtils';

const DAY_MS = 86_400_000;

export function formatSubscriptionDate(value, { withTime = false } = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-KE', {
    timeZone: PMS_TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

// Splits a remaining-seconds value into a display breakdown. Negative or null
// values collapse to zero — the server is authoritative about expiry.
export function breakdownRemaining(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
    totalSeconds: total,
  };
}

// "7 days" / "3 days, 4 hours" / "5 hours, 12 minutes" style summary.
export function describeRemaining(seconds) {
  const { days, hours, minutes, totalSeconds } = breakdownRemaining(seconds);
  if (totalSeconds <= 0) return 'expired';
  if (days >= 1) return days === 1 ? '1 day' : `${days} days`;
  if (hours >= 1) return hours === 1 ? `1 hour${minutes ? `, ${minutes} min` : ''}` : `${hours} hours${minutes ? `, ${minutes} min` : ''}`;
  if (minutes >= 1) return `${minutes} min`;
  return 'less than a minute';
}

// Milliseconds until the next second-boundary tick, so countdown components
// can refresh without polling the server.
export function nextTickDelayMs() {
  const now = new Date();
  return 1_000 - (now.getMilliseconds() || 0);
}

// How stale a locally ticking countdown may get before the UI must insist on
// a server recheck (used by focus/visibility revalidation in Phase 6).
export const COUNTDOWN_MAX_SKEW_MS = 5 * 60 * 1000;
export const COUNTDOWN_TICK_MS = Math.min(30_000, DAY_MS);
