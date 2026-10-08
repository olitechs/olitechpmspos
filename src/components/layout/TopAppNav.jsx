import React from 'react';
import { NavLink } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { MAIN_NAV, canAccessApp, normalizeAppRole } from '@/data/modules/navArchitecture';
import { useAuth } from '@/lib/AuthContext';
import { getSessionStaff, normalizeStaffRole } from '@/services/authService';

export default function TopAppNav(){
 const {user}=useAuth();
 const s=getSessionStaff();
 const raw=s?.role||user?.staff?.role||user?.propertyRole||user?.role;
 const role=normalizeAppRole(normalizeStaffRole(raw));
 const packageName=user?.property?.package;
 const workspaces=MAIN_NAV.filter(a=>canAccessApp(role,a.id,packageName));

 return <header className="flex h-14 shrink-0 items-center border-b border-[var(--border)] bg-[var(--surface)] px-2 shadow-[var(--shadow)]">
  <nav className="flex h-full min-w-0 items-stretch gap-1" aria-label="Workspaces">
   {workspaces.map(a=>{
    const I=a.icon;
    return <NavLink
     key={a.id}
     to={a.path}
     target="_blank"
     rel="noopener noreferrer"
     title={`Open ${a.label} in a new tab`}
     className={({isActive})=>[
      'group flex min-w-[142px] items-center justify-center gap-2 rounded-md px-5 text-[13px] font-semibold transition-colors',
      isActive
       ? 'bg-[var(--bg)] text-[var(--text)] shadow-[inset_0_-3px_0_var(--brand-primary)]'
       : 'text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]'
     ].join(' ')}
    >
     <I size={17}/>
     <span>{a.label}</span>
     <ExternalLink size={13} className="opacity-45 transition-opacity group-hover:opacity-100" aria-hidden="true"/>
    </NavLink>;
   })}
  </nav>
 </header>;
}
