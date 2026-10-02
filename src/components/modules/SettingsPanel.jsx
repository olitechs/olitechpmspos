import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Building2, Users, ReceiptText, Printer, Percent, Plug, ChevronLeft } from 'lucide-react';
import { SAND, NAVY, MUTED, BORDER, SURFACE, TEAL, TEAL_DARK } from '@/data/themePalette';
import StaffAdmin from '@/components/admin/StaffAdmin';
import SubscriptionPanel from '@/components/admin/SubscriptionPanel';
import SettingsPrinters from '@/pages/SettingsPrinters';
import ReceiptSettings from '@/components/settings/ReceiptSettings';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { useAuth } from '@/lib/AuthContext';

const SECTIONS = [
  { id:'general', icon:Building2, label:'General', desc:'Business identity, branch and operational details', disabled:true },
  { id:'users', icon:Users, label:'Users & Roles', desc:'Manage staff accounts, roles and granular permissions' },
  { id:'taxes', icon:Percent, label:'Taxes & Fees', desc:'Configure tax and service-charge rules', disabled:true },
  { id:'printers', icon:Printer, label:'Printers', desc:'Receipt, kitchen and bar printers plus assignment matrix' },
  { id:'receipt', icon:ReceiptText, label:'Receipt Customization', desc:'Company header, footer, logo and live receipt preview' },
  { id:'integrations', icon:Plug, label:'Integrations', desc:'Payment, accounting and online-ordering integrations', disabled:true },
];

function Breadcrumb({label,onBack}) {
  return <div className="flex items-center gap-2 border-b px-4 py-3" style={{borderColor:BORDER,background:SURFACE}}>
    <button onClick={onBack} className="flex items-center gap-1 text-xs font-semibold" style={{color:TEAL_DARK}}><ChevronLeft size={14}/>Settings</button>
    <span style={{color:MUTED}}>/</span><span className="text-xs font-bold uppercase tracking-widest" style={{color:NAVY}}>{label}</span>
  </div>;
}

export default function SettingsPanel(){
 const location=useLocation(); const navigate=useNavigate();
 const initialView=location.pathname==='/settings/printers'?'printers':location.pathname==='/settings/receipt'?'receipt':'list';
 const [view,setView]=React.useState(initialView);
 React.useEffect(()=>{if(location.pathname==='/settings/printers')setView('printers');else if(location.pathname==='/settings/receipt')setView('receipt');},[location.pathname]);
 const {user}=useAuth();
 const canSubscription=Boolean(user?.property?.id||user?.propertyRole||user?.staff?.role);
 if(view==='printers') return <div className="flex-1 overflow-y-auto" style={{background:SAND}}><Breadcrumb label="Printers" onBack={()=>{setView('list');navigate('/backoffice?module=settings')}}/><ErrorBoundary label="Printer settings"><SettingsPrinters/></ErrorBoundary></div>;
 if(view==='receipt') return <div className="flex-1 overflow-y-auto" style={{background:SAND}}><Breadcrumb label="Receipt Customization" onBack={()=>setView('list')}/><ErrorBoundary label="Receipt settings"><ReceiptSettings/></ErrorBoundary></div>;
 if(view==='users') return <div className="flex-1 overflow-y-auto" style={{background:SAND}}><Breadcrumb label="Users & Roles" onBack={()=>setView('list')}/><StaffAdmin/></div>;
 if(view==='subscription') return <div className="flex-1 overflow-y-auto" style={{background:SAND}}><Breadcrumb label="Subscription" onBack={()=>setView('list')}/><SubscriptionPanel/></div>;
 return <div className="flex-1 overflow-y-auto p-4" style={{background:SAND}}>
   <div className="mb-5"><h2 className="text-xl font-black" style={{color:NAVY}}>Settings</h2><p className="mt-1 text-sm" style={{color:MUTED}}>Configure your property, team, receipts and printing workflow.</p></div>
   <div className="grid max-w-4xl gap-3 md:grid-cols-2">
    {SECTIONS.map(s=>{const Icon=s.icon;return <button key={s.id} disabled={s.disabled} onClick={()=>!s.disabled&&setView(s.id)} className="flex items-center gap-4 rounded-2xl p-4 text-left transition" style={{background:SURFACE,border:`1px solid ${BORDER}`,opacity:s.disabled?.58:1,cursor:s.disabled?'default':'pointer'}}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{background:`${TEAL}14`}}><Icon size={19} style={{color:TEAL_DARK}}/></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-bold" style={{color:NAVY}}>{s.label}</span><span className="mt-1 block text-xs" style={{color:MUTED}}>{s.desc}</span></span>
      <span className="rounded-lg border px-2 py-1 text-[10px] font-bold" style={{borderColor:BORDER,color:s.disabled?MUTED:TEAL_DARK}}>{s.disabled?'Coming soon':'Configure →'}</span>
    </button>})}
   </div>
   {canSubscription&&<button onClick={()=>setView('subscription')} className="mt-4 rounded-xl border px-4 py-3 text-xs font-bold" style={{borderColor:BORDER,color:MUTED,background:SURFACE}}>Subscription & Paywall →</button>}
 </div>;
}
