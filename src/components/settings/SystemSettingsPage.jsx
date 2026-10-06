import React from 'react';
import {useLocation} from 'react-router-dom';
import SystemSettingsLayout from '@/components/settings/SystemSettingsLayout';
import KitchenPrintersPage from '@/components/settings/KitchenPrintersPage';
import {SYSTEM_SETTINGS_NAV,slugFromPath} from '@/components/settings/systemSettingsNav';
function ComingSoon({label}){return <div className="rounded-[2px] border border-[#E0E0E0] bg-white p-8"><h2 className="text-[20px] font-normal text-[#212121]">{label}</h2><p className="mt-2 text-[14px] text-[#757575]">This System settings section is not enabled in Phase 1.</p></div>;}
export default function SystemSettingsPage(){
 const {pathname}=useLocation();const slug=slugFromPath(pathname);const item=SYSTEM_SETTINGS_NAV.find(x=>x.slug===slug);const label=item?.label||'System settings';
 return <SystemSettingsLayout>{slug==='kitchen-printers'?<KitchenPrintersPage/>:<ComingSoon label={label}/>}</SystemSettingsLayout>;
}