import React from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import {Settings as SettingsIcon,ChevronRight} from 'lucide-react';
import {SYSTEM_SETTINGS_NAV,navPath,slugFromPath} from '@/components/settings/systemSettingsNav';
export default function SystemSettingsLayout({children}){
 const location=useLocation(),navigate=useNavigate(),active=slugFromPath(location.pathname);
 return <div className="min-h-full bg-[#F5F5F5]"><div className="mx-auto flex min-h-[calc(100vh-80px)] max-w-6xl bg-white shadow-sm">
  <aside className="w-[240px] shrink-0 border-r border-[#E0E0E0] bg-[#FAFAFA]"><div className="flex items-center gap-3 border-b border-[#E0E0E0] px-5 py-5"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#90A4AE] text-white"><SettingsIcon size={20}/></span><div><h1 className="text-[20px] font-normal text-[#212121]">Settings</h1><p className="text-[12px] text-[#757575]">System settings</p></div></div>
  <nav className="p-2">{SYSTEM_SETTINGS_NAV.map(item=><button key={item.slug} type="button" onClick={()=>navigate(navPath(item))} className={`flex w-full items-center justify-between rounded-[2px] px-3 py-3 text-left text-[14px] ${active===item.slug?'bg-[#E8F5E9] font-medium text-[#2E7D32]':'text-[#616161] hover:bg-[#F0F0F0]'}`}><span>{item.label}</span>{active===item.slug&&<ChevronRight size={15}/>}</button>)}</nav></aside>
  <main className="min-w-0 flex-1 p-6">{children}</main>
 </div></div>;
}