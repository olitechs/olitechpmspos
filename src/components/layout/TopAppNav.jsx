import React from 'react';
import { ExternalLink, LockKeyhole } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { MAIN_NAV, canAccessApp, normalizeAppRole } from '@/data/modules/navArchitecture';
import { useAuth } from '@/lib/AuthContext';
import { getSessionStaff, normalizeStaffRole } from '@/services/authService';

export default function TopAppNav() {
  const { user } = useAuth();
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
          return (
            <NavLink key={a.id} to={a.path} end={a.id==='pos'}
              className={({ isActive }) => [
                'flex min-w-[142px] shrink-0 items-center justify-center gap-2 rounded-md px-5 text-[13px] font-semibold transition-colors',
                isActive ? 'bg-[var(--bg)] text-[var(--text)] shadow-[inset_0_-3px_0_var(--brand-primary)]' : 'text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]',
              ].join(' ')}>
              <I size={17}/><span>{a.label}</span><ExternalLink size={13} className="opacity-45" aria-hidden="true"/>
            </NavLink>
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
