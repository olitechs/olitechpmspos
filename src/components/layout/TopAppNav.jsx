import React from 'react';
import { ExternalLink, LockKeyhole } from 'lucide-react';
import { MAIN_NAV, canAccessApp, normalizeAppRole } from '@/data/modules/navArchitecture';
import { useAuth } from '@/lib/AuthContext';
import { getSessionStaff, normalizeStaffRole } from '@/services/authService';

const STAFF_SESSION_KEY = 'olitech_active_staff_v2';

function openWorkspaceWindow(workspace) {
  const width = workspace.id === 'pos' ? 1540 : 1440;
  const height = workspace.id === 'pos' ? 960 : 900;
  const left = Math.max(0, Math.round((window.screen.availWidth - width) / 2));
  const top = Math.max(0, Math.round((window.screen.availHeight - height) / 2));
  const popup = window.open(
    `${window.location.origin}${workspace.path}`,
    `olitech-workspace-${workspace.id}`,
    `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
  );

  if (!popup) return;

  // Supabase auth is shared through localStorage. Staff PIN identity is deliberately
  // tab-scoped, so copy only the current staff session into this workspace window.
  // This also refreshes an already-open named workspace if the active staff changed.
  try {
    const staffSession = sessionStorage.getItem(STAFF_SESSION_KEY);
    if (staffSession) popup.sessionStorage.setItem(STAFF_SESSION_KEY, staffSession);
    else popup.sessionStorage.removeItem(STAFF_SESSION_KEY);
  } catch {
    // The destination still opens; its normal PIN gate handles an unavailable handoff.
  }

  try {
    popup.opener = null;
    popup.focus();
  } catch {
    // Browser window policies may prevent focus changes; navigation is already started.
  }
}

export default function TopAppNav({ workspace = 'backoffice' }) {
  const { user } = useAuth();
  // Back Office is the main workspace and the only place that can launch
  // the other workspaces. Front Office, Stores, and POS stay self-contained.
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
            <button key={a.id} type="button" onClick={() => openWorkspaceWindow(a)}
              aria-label={`Open ${a.label} in a separate window`}
              title={`Open ${a.label} in a separate window`}
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
