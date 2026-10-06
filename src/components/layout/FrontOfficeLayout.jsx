import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Building2, BedDouble, CalendarDays, ReceiptText, Sparkles, ClipboardList } from 'lucide-react';
import TopAppNav from './TopAppNav';
import { FRONT_OFFICE_NAV, normalizeAppRole } from '@/data/modules/navArchitecture';
import { useAuth } from '@/lib/AuthContext';
import { getSessionStaff, normalizeStaffRole } from '@/services/authService';

const icons={dashboard:Building2,rooms:BedDouble,reservations:CalendarDays,folio:ReceiptText,housekeeping:Sparkles,'night-audit':ClipboardList};
export default function FrontOfficeLayout(){
 const {user}=useAuth(); const s=getSessionStaff(); const raw=s?.role||user?.staff?.role||user?.propertyRole||user?.role; const role=normalizeAppRole(raw);
 return <div className="flex h-screen flex-col overflow-hidden bg-[#F8FAFC]"><TopAppNav/><div className="flex min-h-0 flex-1"><aside className="w-[250px] shrink-0 overflow-y-auto border-r border-[#E2E8F0] bg-white p-2">{FRONT_OFFICE_NAV.filter(x=>x[3].includes(role)).map(([label,path,id])=>{const I=icons[id];return <NavLink key={path} to={path} end={path==='/frontoffice'} className={({isActive})=>['flex items-center gap-3 rounded-md px-4 py-3 text-sm',isActive?'bg-[#F1F1F1] font-medium text-[#212121]':'text-[#616161] hover:bg-[#FAFAFA]'].join(' ')}><I size={18}/>{label}</NavLink>})}</aside><main className="min-w-0 flex-1 overflow-auto"><Outlet/></main></div></div>;
}
