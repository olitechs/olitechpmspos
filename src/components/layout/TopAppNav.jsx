import React from 'react';
import { ExternalLink, LockKeyhole } from 'lucide-react';
import { MAIN_NAV, canAccessApp, normalizeAppRole } from '@/data/modules/navArchitecture';
import { useAuth } from '@/lib/AuthContext';
import { getSessionStaff, normalizeStaffRole } from '@/services/authService';

const STAFF_SESSION_KEY = 'olitech_active_staff_v2';

function openWorkspaceTab(workspace) {
  // Do not pass popup dimensions/features: browsers then open a normal tab
  // in the current browser window (subject to the user's browser preferences).
  const tab = window.open(`${window.location.origin}${workspace.path}`, '_blank');
  if (!tab) return;

  // Same-origin window.open starts the new tab with a copy of sessionStorage.
  // Refresh the staff PIN identity explicitly in case the current tab changed.
  try {
    const staffSession = sessionStorage.getItem(STAFF_SESSION_KEY);
    if (staffSession) tab.sessionStorage.setItem(STAFF_SESSION_KEY, staffSession);
    else tab.sessionStorage.removeItem(STAFF_SESSION_KEY);
  } catch {
    // The destination's normal PIN gate handles an unavailable handoff.
  }

  try {
    tab.opener = null;
    tab.focus();
  } catch {
    // Browser policies may prevent focus changes; the tab is already opening.
  }
}

export default function TopAppNav({ workspace = 'backoffice' }) {
  const { user } = useAuth();
  // Back Office is the main workspace and can launch the other workspaces.
  // Each workspace opens as a tab in the same browser window, never a popup.
  if (workspace !== 'backoffice') return null;
  const s = getSessionStaff();
  const raw = s?.role || user?.staff?.role || user?.propertyRole || user?.role;
  const role = normalizeAppRole(normalizeStaffRole(raw));
  const packageName = user?.property?.package;
  const workspaces = MAIN_NAV.filter((a) => canAccessApp(role, a.id, packageName));
  const propertyRole = String(user?.propertyRole || '').toLowerCase();
  const isPropertyAdmin = !!user?.isPlatformOwner
    || ['owner', 'admin', 'manager'].includes(propertyRole)
    || ['owner', 'admin'].includes(role)
    || ['hotel_admin', 'super_admin'].includes(normalizeStaffRole(user?.staff?.role));
  const showLock = !!user && !isPropertyAdmin && !!s;
  const lockWorkspace = () => {
    // The active staff identity is server-side too, so RouteGuard clears both
    // browser access and the server session before returning to the PIN wall.
    window.dispatchEvent(new CustomEvent('olitech:lock-workspace', { detail: { module: 'all' } }));
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-2 shadow-[var(--shadow)]">
      <nav className="flex h-full min-w-0 items-stretch gap-1 overflow-x-auto" aria-label="Workspaces">
        {workspaces.map((a) => {
          const I = a.icon;
          const isCurrent = window.location.pathname === a.path
            || (a.id !== 'pos' && window.location.pathname.startsWith(a.path + '/'));
          return (
            <button key={a.id} type="button" onClick={() => openWorkspaceTab(a)}
              aria-label={`Open ${a.label} in a new tab`}
              title={`Open ${a.label} in a new tab`}
              className={[
                'flex min-w-[142px] shrink-0 items-center justify-center gap-2 rounded-md px-5 text-[13px] font-semibold transition-colors',
                isCurrent ? 'bg-[var(--bg)] text-[var(--text)] shadow-[inset_0_-3px_0_var(--brand-primary)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]',
              ].join(' ')}>
              <I size={17}/><span>{a.label}</span><ExternalLink size={13} className="text-[var(--text-muted)]" aria-hidden="true"/>
            </button>
          );
        })}
      </nav>
      {showLock && (
        <button type="button" onClick={lockWorkspace}
          className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-xs font-bold text-[var(--text)] transition hover:bg-[var(--bg)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"
          aria-label="Lock workspace and return to PIN login" title="Lock workspace">
          <LockKeyhole size={15}/><span className="hidden sm:inline">Lock</span>
        </button>
      )}
    </header>
  );
}
