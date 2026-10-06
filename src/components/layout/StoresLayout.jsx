import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Settings, Store, Printer, MonitorCog, LayoutGrid } from 'lucide-react';
import TopAppNav from './TopAppNav';
import { STORES_NAV } from '@/data/modules/navArchitecture';
const icons={store:Store,settings:Settings,devices:MonitorCog,printers:Printer,kds:LayoutGrid};
export default function StoresLayout(){return <div className="flex h-screen flex-col overflow-hidden bg-[#F5F5F5]"><TopAppNav/><div className="flex min-h-0 flex-1"><aside className="w-[250px] shrink-0 border-r border-[#E0E0E0] bg-white p-2">{STORES_NAV.map(([label,path,id])=>{const I=icons[id];return <NavLink key={path} to={path} end={path==='/stores'} className={({isActive})=>['flex items-center gap-3 rounded-md px-4 py-3 text-sm',isActive?'bg-[#F1F1F1] font-medium text-[#212121]':'text-[#616161] hover:bg-[#FAFAFA]'].join(' ')}><I size={18}/>{label}</NavLink>})}</aside><main className="min-w-0 flex-1 overflow-auto"><Outlet/></main></div></div>;}
