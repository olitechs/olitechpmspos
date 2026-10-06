import React from 'react';
import { NavLink } from 'react-router-dom';
import { MAIN_NAV } from '@/data/modules/navArchitecture';
import { useAuth } from '@/lib/AuthContext';
import { getSessionStaff, normalizeStaffRole } from '@/services/authService';

export default function TopAppNav(){
 const {user}=useAuth(); const s=getSessionStaff(); const raw=s?.role||user?.staff?.role||user?.propertyRole||user?.role;
 const roleMap={hotel_admin:'admin',super_admin:'owner',front_office_manager:'front_desk',receptionist:'front_desk',pos_staff:'pos_staff',waiter:'pos_staff',cashier:'pos_staff',store_manager:'store_manager',fb_manager:'pos_staff',housekeeping_supervisor:'housekeeping'};
 const role=roleMap[normalizeStaffRole(raw)]||normalizeStaffRole(raw);
 return <header className="flex h-12 shrink-0 items-center bg-[#2C3E50] px-2 shadow-sm"><nav className="flex h-full items-stretch">{MAIN_NAV.filter(a=>a.roles.includes(role)).map(a=>{const I=a.icon;return <NavLink key={a.id} to={a.path} className={({isActive})=>['flex min-w-[132px] items-center justify-center gap-2 px-5 text-[13px] font-semibold transition-colors',isActive?'bg-white/15 text-white shadow-[inset_0_-3px_0_#8BC34A]':'text-white/80 hover:bg-white/10 hover:text-white'].join(' ')}><I size={16}/>{a.label}</NavLink>})}</nav></header>;
}
