import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Building2, BedDouble, CalendarDays, ReceiptText, Sparkles, ClipboardList } from 'lucide-react';
import TopAppNav from './TopAppNav';
import { FRONT_OFFICE_NAV, normalizeAppRole } from '@/data/modules/navArchitecture';
import { useAuth } from '@/lib/AuthContext';
import { getSessionStaff, normalizeStaffRole } from '@/services/authService';

const icons={dashboard:Building2,'room-planner':BedDouble,rooms:BedDouble,reservations:CalendarDays,folio:ReceiptText,housekeeping:Sparkles,'night-audit':ClipboardList};
export default function FrontOfficeLayout(){
 const {user}=useAuth(); const s=getSessionStaff(); const raw=s?.role||user?.staff?.role||user?.propertyRole||user?.role; const role=normalizeAppRole(raw);
 return <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg)]"><TopAppNav/><div className="flex min-h-0 flex-1"><aside className="w-[250px] shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] p-2">{FRONT_OFFICE_NAV.filter(x=>x[3].includes(role)).map(([label,path,id])=>{const I=icons[id];return <NavLink key={path} to={path} end={path==='/frontoffice'} className={({isActive})=>['flex items-center gap-3 rounded-md px-4 py-3 text-sm',isActive?'bg-[var(--bg)] font-medium text-[var(--text)]':'text-[var(--muted)] hover:bg-[var(--bg)]'].join(' ')}><I size={18}/>{label}</NavLink>})}</aside><main className="min-w-0 flex-1 overflow-auto"><Outlet/></main></div></div>;
}
