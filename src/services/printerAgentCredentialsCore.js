// Turns a print_agent_credentials row into something a manager can act on.
//
// Deliberately pure: the settings page renders these labels, and the tests can
// pin the wording (and the clock-skew handling) without a browser or database.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function formatElapsed(ms) {
  const minutes = Math.max(0, Math.floor(ms / MINUTE));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return `${Math.floor(days / 7)} wk ago`;
}

/**
 * @param {{revoked_at?: string|null, last_seen_at?: string|null}} row
 * @param {number} [now] epoch milliseconds, injectable for tests
 */
export function workstationPresence(row, now = Date.now()) {
  if (!row) return { state: 'unknown', label: 'Unknown', tone: 'muted' };
  if (row.revoked_at) return { state: 'revoked', label: 'Revoked', tone: 'muted' };
  if (!row.last_seen_at) return { state: 'never', label: 'Never checked in', tone: 'warning' };

  const seen = new Date(row.last_seen_at).getTime();
  if (!Number.isFinite(seen)) return { state: 'unknown', label: 'Unknown', tone: 'muted' };

  // A workstation whose clock is a little ahead is still simply online.
  const elapsed = now - seen;
  if (elapsed <= 2 * MINUTE) return { state: 'online', label: 'Online now', tone: 'success' };
  if (elapsed > 7 * 24 * HOUR) return { state: 'stale', label: `Not seen for ${formatElapsed(elapsed).replace(' ago', '')}`, tone: 'warning' };
  return { state: 'seen', label: `Last seen ${formatElapsed(elapsed)}`, tone: 'muted' };
}

/** Only workstations that still hold a usable credential can print. */
export function activeWorkstations(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row && !row.revoked_at);
}
