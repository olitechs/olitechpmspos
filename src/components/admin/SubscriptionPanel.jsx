import React,{useCallback,useEffect,useState}from'react';
import{Building2,CalendarDays,CheckCircle2,CreditCard,RefreshCw,ShieldCheck,Users,Hotel,AlertCircle}from'lucide-react';
import{useAuth}from'@/lib/AuthContext';
import{pmsService}from'@/services/pmsService';

const STATUS={
 trial:{label:'Trial',className:'bg-amber-50 text-amber-700 border-amber-200'},
 active:{label:'Active',className:'bg-emerald-50 text-emerald-700 border-emerald-200'},
 past_due:{label:'Past due',className:'bg-orange-50 text-orange-700 border-orange-200'},
 suspended:{label:'Suspended',className:'bg-red-50 text-red-700 border-red-200'},
 cancelled:{label:'Cancelled',className:'bg-slate-100 text-slate-600 border-slate-200'},
};

const MODULE_LABELS={
 dashboard:'Dashboard',front_office:'Front Office',pms:'PMS',pos:'POS',
 inventory:'Inventory',housekeeping:'Housekeeping',maintenance:'Maintenance',
 purchasing:'Purchasing',laundry:'Laundry',transfers:'Stock Transfers',
 booking_engine:'Booking Engine',channels:'Channel Manager',reports:'Reports',
 kitchen:'Kitchen Display',payments:'Payments',
};

function formatDate(value){
 if(!value)return'—';
 const d=new Date(value);
 return Number.isNaN(d.getTime())?'—':d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
}

function StatusBadge({status}){
 const meta=STATUS[status]||{label:status||'Not configured',className:'bg-slate-100 text-slate-600 border-slate-200'};
 return <span className={'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold '+meta.className}>
   <span className="h-1.5 w-1.5 rounded-full bg-current"/>{meta.label}
 </span>;
}

function Stat({icon:Icon,label,value,sub}){
 return <div className="rounded-2xl border border-[#E5E5E5] bg-white p-4">
   <div className="flex items-center gap-2 text-xs font-semibold text-[#757B81]"><Icon size={15}/>{label}</div>
   <div className="mt-2 text-lg font-black text-[#090C11]">{value}</div>
   {sub&&<div className="mt-1 text-xs text-[#757B81]">{sub}</div>}
 </div>;
}

export default function SubscriptionPanel(){
 const{user}=useAuth();
 const[overview,setOverview]=useState(null);
 const[loading,setLoading]=useState(true);
 const[error,setError]=useState('');

 const load=useCallback(async()=>{
   setLoading(true);setError('');
   try{setOverview(await pmsService.getMySubscriptionOverview())}
   catch(e){setError(e?.message||'Unable to load subscription details.')}
   finally{setLoading(false)}
 },[]);

 useEffect(()=>{load()},[load]);

 if(loading)return <div className="flex flex-1 items-center justify-center p-8"><RefreshCw className="animate-spin text-[#757B81]"/></div>;

 if(error)return <div className="p-5"><div className="max-w-2xl rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700"><div className="flex items-center gap-2 font-bold"><AlertCircle size={17}/> Subscription details unavailable</div><p className="mt-2">{error}</p><button onClick={load} className="mt-4 rounded-xl border border-red-200 bg-white px-4 py-2 text-xs font-bold">Try again</button></div></div>;

 if(!overview)return <div className="p-5"><div className="max-w-2xl rounded-2xl border border-[#E5E5E5] bg-white p-8 text-center"><Building2 className="mx-auto text-[#757B81]"/><h2 className="mt-3 font-black text-[#090C11]">No property assigned</h2><p className="mt-1 text-sm text-[#757B81]">Your account is not currently assigned to a hotel/property. Contact your administrator.</p></div></div>;

 const modules=Array.isArray(overview.enabled_modules)?overview.enabled_modules:[];
 const status=overview.subscription_status||'trial';
 const plan=overview.plan_code||overview.property_package||'Not configured';
 const roomLimit=overview.room_limit||'Not configured';
 const userLimit=overview.user_limit||'Not configured';

 return <div className="flex-1 overflow-y-auto p-4 md:p-6" style={{background:'#F8F8F7'}}>
   <div className="mx-auto max-w-5xl space-y-5">
     <div className="rounded-3xl border border-[#E5E5E5] bg-white p-5 md:p-6">
       <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
         <div className="flex gap-4">
           <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#FFD300]"><Hotel size={22}/></div>
           <div>
             <p className="text-[11px] font-black uppercase tracking-[.16em] text-[#757B81]">Your property</p>
             <h1 className="mt-1 text-2xl font-black text-[#090C11]">{overview.property_name||'Unnamed property'}</h1>
             {overview.business_name&&<p className="mt-1 text-sm text-[#757B81]">{overview.business_name}</p>}
             <p className="mt-2 text-xs font-semibold text-[#757B81]">Access role: <span className="capitalize text-[#090C11]">{overview.property_role||user?.propertyRole||'member'}</span></p>
           </div>
         </div>
         <div className="flex flex-col items-start gap-2 md:items-end">
           <StatusBadge status={status}/>
           <span className="rounded-full bg-[#F2F2F2] px-3 py-1 text-xs font-black capitalize text-[#090C11]">{plan} package</span>
         </div>
       </div>
       <div className="mt-5 flex items-start gap-3 rounded-2xl border border-[#DDE7E9] bg-[#F5FAFA] p-4 text-sm">
         <ShieldCheck size={18} className="mt-0.5 shrink-0 text-[#0E5F6B]"/>
         <div><div className="font-bold text-[#090C11]">Subscription managed by OliTechs Platform Admin</div><p className="mt-1 text-xs leading-5 text-[#757B81]">This screen is read-only for hotel users. Package, status, modules, billing dates and limits are controlled centrally.</p></div>
       </div>
     </div>

     <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
       <Stat icon={CreditCard} label="Assigned package" value={String(plan).replaceAll('_',' ')} sub="Platform assignment"/>
       <Stat icon={Hotel} label="Rooms" value={overview.room_count+' / '+roomLimit} sub="Current rooms / limit"/>
       <Stat icon={Users} label="Users" value={overview.user_count+' / '+userLimit} sub="Assigned users / limit"/>
       <Stat icon={CheckCircle2} label="Modules" value={modules.length||'—'} sub={modules.length?'Enabled modules':'Platform controlled'} />
     </div>

     <div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
       <section className="rounded-3xl border border-[#E5E5E5] bg-white p-5">
         <div className="flex items-center gap-3"><CalendarDays size={18}/><div><h2 className="font-black text-[#090C11]">Billing & access dates</h2><p className="text-xs text-[#757B81]">Dates currently assigned to this property.</p></div></div>
         <div className="mt-5 grid gap-3 sm:grid-cols-3">
           {[['Trial ends',overview.trial_ends_at],['Current period ends',overview.current_period_ends_at],['Grace period ends',overview.grace_ends_at]].map(([label,value])=><div key={label} className="rounded-2xl bg-[#F8F8F7] p-4"><div className="text-xs font-semibold text-[#757B81]">{label}</div><div className="mt-2 font-black text-[#090C11]">{formatDate(value)}</div></div>)}
         </div>
       </section>

       <section className="rounded-3xl border border-[#E5E5E5] bg-white p-5">
         <h2 className="font-black text-[#090C11]">Plan limits</h2>
         <p className="mt-1 text-xs text-[#757B81]">Limits are determined by the assigned package.</p>
         <div className="mt-4 space-y-3 text-sm">
           <div className="flex justify-between border-b border-[#E5E5E5] pb-3"><span className="text-[#757B81]">Rooms</span><b>{roomLimit}</b></div>
           <div className="flex justify-between border-b border-[#E5E5E5] pb-3"><span className="text-[#757B81]">Users</span><b>{userLimit}</b></div>
           <div className="flex justify-between"><span className="text-[#757B81]">Status</span><b className="capitalize">{status.replaceAll('_',' ')}</b></div>
         </div>
       </section>
     </div>

     <section className="rounded-3xl border border-[#E5E5E5] bg-white p-5">
       <div className="flex items-center justify-between gap-3"><div><h2 className="font-black text-[#090C11]">Enabled modules</h2><p className="mt-1 text-xs text-[#757B81]">Modules explicitly enabled for this property.</p></div><span className="rounded-full bg-[#F2F2F2] px-3 py-1 text-xs font-bold">{modules.length} enabled</span></div>
       {modules.length?<div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{modules.map(module=><div key={module} className="flex items-center gap-2 rounded-xl border border-[#E5E5E5] bg-[#FAFAFA] px-3 py-2.5 text-sm font-semibold"><CheckCircle2 size={15} className="text-emerald-600"/>{MODULE_LABELS[module]||String(module).replaceAll('_',' ')}</div>)}</div>:<div className="mt-4 rounded-2xl bg-[#F8F8F7] p-4 text-sm text-[#757B81]">No explicit module overrides are recorded. Access follows the package configuration controlled by the Platform Admin.</div>}
     </section>

     <div className="flex justify-end"><button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-[#E5E5E5] bg-white px-4 py-2 text-xs font-bold text-[#090C11]"><RefreshCw size={14}/> Refresh subscription</button></div>
   </div>
 </div>;
}
