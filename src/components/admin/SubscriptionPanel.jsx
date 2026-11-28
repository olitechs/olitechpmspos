import React,{useCallback,useEffect,useState}from'react';
import{Building2,CalendarDays,CheckCircle2,CreditCard,RefreshCw,ShieldCheck,Users,Hotel,AlertCircle}from'lucide-react';
import{useAuth}from'@/lib/AuthContext';
import{pmsService}from'@/services/pmsService';
import{employeeService}from'@/services/employeeService';
import{SUBSCRIPTION_SUPPORT_EMAILS,evaluateSubscriptionAccess,subscriptionRenewalMailto}from'@/lib/subscriptionAccess';
import{formatSubscriptionDate}from'@/lib/subscriptionCountdown';

const STATUS={
 trial:{label:'Trial',className:'bg-[var(--warning-soft)] text-[var(--warning-text)] border-[var(--warning)]'},
 active:{label:'Active',className:'bg-[var(--success-soft)] text-[var(--success-text)] border-[var(--success)]'},
 expired:{label:'Expired',className:'bg-[var(--danger-soft)] text-[var(--danger-text)] border-[var(--danger)]'},
 expiring_soon:{label:'Expiring soon',className:'bg-[var(--warning-soft)] text-[var(--warning-text)] border-[var(--warning)]'},
 grace_period:{label:'Grace period',className:'bg-[var(--warning-soft)] text-[var(--warning-text)] border-[var(--warning)]'},
 manually_extended:{label:'Manually extended',className:'bg-[var(--success-soft)] text-[var(--success-text)] border-[var(--success)]'},
 unavailable:{label:'Verification unavailable',className:'bg-[var(--danger-soft)] text-[var(--danger-text)] border-[var(--danger)]'},
 past_due:{label:'Past due',className:'bg-[var(--warning-soft)] text-[var(--warning-text)] border-[var(--warning)]'},
 suspended:{label:'Suspended',className:'bg-[var(--danger-soft)] text-[var(--danger-text)] border-[var(--danger)]'},
 cancelled:{label:'Cancelled',className:'bg-secondary text-muted-foreground border-border'},
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
 const meta=STATUS[status]||{label:status||'Not configured',className:'bg-secondary text-muted-foreground border-border'};
 return <span className={'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold '+meta.className}>
   <span className="h-1.5 w-1.5 rounded-full bg-current"/>{meta.label}
 </span>;
}

function Stat({icon:Icon,label,value,sub}){
 return <div className="rounded-2xl border border-border bg-surface p-4">
   <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Icon size={15}/>{label}</div>
   <div className="mt-2 text-lg font-black text-foreground">{value}</div>
   {sub&&<div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
 </div>;
}

export default function SubscriptionPanel(){
 const{user}=useAuth();
 const[overview,setOverview]=useState(null);
 const[entitlement,setEntitlement]=useState(null);
 const[loading,setLoading]=useState(true);
 const[error,setError]=useState('');
 const[licence,setLicence]=useState(null);
 const propertyId=user?.property?.id;

 const load=useCallback(async()=>{
   setLoading(true);setError('');
   try{const [nextOverview,nextEntitlement]=await Promise.all([pmsService.getMySubscriptionOverview(),pmsService.getMySubscriptionEntitlement()]);setOverview(nextOverview);setEntitlement(nextEntitlement)}
   catch(e){setError(e?.message||'Unable to load subscription details.')}
   finally{setLoading(false)}
 },[]);

 useEffect(()=>{load()},[load]);

 // Employee licence overview is informational and additive: an older
 // deployment without the employee-management migration simply leaves the
 // section out.
 useEffect(()=>{
   if(!propertyId)return;
   let active=true;
   employeeService.licenceState(propertyId).then(state=>{if(active)setLicence(state)}).catch(()=>{});
   return()=>{active=false};
 },[propertyId]);

 if(loading)return <div className="flex flex-1 items-center justify-center p-8"><RefreshCw className="animate-spin text-muted-foreground"/></div>;

 if(error)return <div className="p-5"><div className="max-w-2xl rounded-2xl border border-[var(--danger)] bg-[var(--danger-soft)] p-5 text-sm text-[var(--danger-text)]"><div className="flex items-center gap-2 font-bold"><AlertCircle size={17}/> Subscription details unavailable</div><p className="mt-2">{error}</p><button onClick={load} className="mt-4 rounded-xl border border-[var(--danger)] bg-surface px-4 py-2 text-xs font-bold">Try again</button></div></div>;

 if(!overview)return <div className="p-5"><div className="max-w-2xl rounded-2xl border border-border bg-surface p-8 text-center"><Building2 className="mx-auto text-muted-foreground"/><h2 className="mt-3 font-black text-foreground">No property assigned</h2><p className="mt-1 text-sm text-muted-foreground">Your account is not currently assigned to a hotel/property. Contact your administrator.</p></div></div>;

 const modules=Array.isArray(overview.enabled_modules)?overview.enabled_modules:[];
 const status=entitlement?.state||overview.subscription_status||'trial';
 const plan=overview.plan_code||overview.property_package||'Not configured';
 const roomLimit=overview.room_limit||'Not configured';
 const userLimit=overview.user_limit||'Not configured';
 const access=evaluateSubscriptionAccess(user);
 const computedState=access.state||'expired';
 const datesElapsed=['server_dates','subscription_dates'].includes(access.source);
 const renewalHref=subscriptionRenewalMailto({
  propertyName:overview.property_name||'',propertyId:overview.property_id||propertyId||'',
  packageName:plan,state:computedState,
  periodEndsAt:formatSubscriptionDate(access.periodEndsAt||overview.current_period_ends_at),
  graceEndsAt:formatSubscriptionDate(access.graceEndsAt||overview.grace_ends_at),
 });

 return <div className="flex-1 overflow-y-auto p-4 md:p-6" style={{background:'var(--canvas)'}}>
   <div className="mx-auto max-w-5xl space-y-5">
     <div className="rounded-3xl border border-border bg-surface p-5 md:p-6">
       <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
         <div className="flex gap-4">
           <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary"><Hotel size={22} className="text-primary-foreground"/></div>
           <div>
             <p className="text-[11px] font-black uppercase tracking-[.16em] text-muted-foreground">Your property</p>
             <h1 className="mt-1 text-2xl font-black text-foreground">{overview.property_name||'Unnamed property'}</h1>
             {overview.business_name&&<p className="mt-1 text-sm text-muted-foreground">{overview.business_name}</p>}
             <p className="mt-2 text-xs font-semibold text-muted-foreground">Access role: <span className="capitalize text-foreground">{overview.property_role||user?.propertyRole||'member'}</span></p>
           </div>
         </div>
         <div className="flex flex-col items-start gap-2 md:items-end">
           <StatusBadge status={status}/>
           <span className="rounded-full bg-secondary px-3 py-1 text-xs font-black capitalize text-foreground">{plan} package</span>
         </div>
       </div>
       <div className="mt-5 flex items-start gap-3 rounded-2xl border border-border bg-canvas p-4 text-sm">
         <ShieldCheck size={18} className="mt-0.5 shrink-0 text-[var(--primary-hover)]"/>
         <div><div className="font-bold text-foreground">Subscription managed by OliTechs Platform Admin</div><p className="mt-1 text-xs leading-5 text-muted-foreground">This screen is read-only for hotel users. Package, status, modules, billing dates and limits are controlled centrally.</p></div>
       </div>
     </div>

     <section className="rounded-3xl border border-border bg-surface p-5">
       <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
         <div className="min-w-0">
           <h2 className="font-black text-foreground">Computed access status</h2>
           <p className="mt-1 text-xs text-muted-foreground">Stored status: <b className="capitalize text-foreground">{status.replaceAll('_',' ')}</b> · Computed status: <b className="capitalize text-foreground">{computedState.replace(/_/g,' ')}</b></p>
           {datesElapsed&&<p className="mt-2 text-xs text-[var(--danger-text)]">A stored <b>active</b> status does not override elapsed subscription or grace dates. Operational access is locked.</p>}
           <p className="mt-2 text-xs text-muted-foreground">Subscribe or renew by emailing <b className="text-foreground">{SUBSCRIPTION_SUPPORT_EMAILS.join(' and ')}</b>.</p>
         </div>
         <a href={renewalHref} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-xs font-bold text-foreground"><RefreshCw size={14}/> Subscribe / Renew by email</a>
       </div>
     </section>

     <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
       <Stat icon={CreditCard} label="Assigned package" value={String(plan).replaceAll('_',' ')} sub="Platform assignment"/>
       <Stat icon={Hotel} label="Rooms" value={overview.room_count+' / '+roomLimit} sub="Current rooms / limit"/>
       <Stat icon={Users} label="Users" value={overview.user_count+' / '+userLimit} sub="Assigned users / limit"/>
       <Stat icon={CheckCircle2} label="Modules" value={modules.length||'—'} sub={modules.length?'Enabled modules':'Platform controlled'} />
     </div>

     <div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
       <section className="rounded-3xl border border-border bg-surface p-5">
         <div className="flex items-center gap-3"><CalendarDays size={18}/><div><h2 className="font-black text-foreground">Billing & access dates</h2><p className="text-xs text-muted-foreground">Dates currently assigned to this property.</p></div></div>
         <div className="mt-5 grid gap-3 sm:grid-cols-3">
           {[['Trial ends',overview.trial_ends_at],['Current period ends',overview.current_period_ends_at],['Grace period ends',overview.grace_ends_at]].map(([label,value])=><div key={label} className="rounded-2xl bg-canvas p-4"><div className="text-xs font-semibold text-muted-foreground">{label}</div><div className="mt-2 font-black text-foreground">{formatDate(value)}</div></div>)}
         </div>
       </section>

       <section className="rounded-3xl border border-border bg-surface p-5">
         <h2 className="font-black text-foreground">Plan limits</h2>
         <p className="mt-1 text-xs text-muted-foreground">Limits are determined by the assigned package.</p>
         <div className="mt-4 space-y-3 text-sm">
           <div className="flex justify-between border-b border-border pb-3"><span className="text-muted-foreground">Rooms</span><b>{roomLimit}</b></div>
           <div className="flex justify-between border-b border-border pb-3"><span className="text-muted-foreground">Users</span><b>{userLimit}</b></div>
           <div className="flex justify-between"><span className="text-muted-foreground">Status</span><b className="capitalize">{status.replaceAll('_',' ')}</b></div>
         </div>
       </section>
     </div>

     <section className="rounded-3xl border border-border bg-surface p-5">
       <div className="flex items-center justify-between gap-3"><div><h2 className="font-black text-foreground">Enabled modules</h2><p className="mt-1 text-xs text-muted-foreground">Modules explicitly enabled for this property.</p></div><span className="rounded-full bg-secondary px-3 py-1 text-xs font-bold">{modules.length} enabled</span></div>
       {modules.length?<div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{modules.map(module=><div key={module} className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-semibold"><CheckCircle2 size={15} className="text-[var(--success-text)]"/>{MODULE_LABELS[module]||String(module).replaceAll('_',' ')}</div>)}</div>:<div className="mt-4 rounded-2xl bg-canvas p-4 text-sm text-muted-foreground">No explicit module overrides are recorded. Access follows the package configuration controlled by the Platform Admin.</div>}
     </section>

     {licence&&<section className="rounded-3xl border border-border bg-surface p-5">
       <div className="flex items-center justify-between gap-3"><div><h2 className="font-black text-foreground">Employee licences</h2><p className="mt-1 text-xs text-muted-foreground">Employee seats included with the plan and additional monthly licences.</p></div><a href="/backoffice/employees/licences" className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-foreground">Manage licences</a></div>
       <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
         <Stat icon={Users} label="Included" value={licence.included_employees} sub={`${licence.plan_code?String(licence.plan_code).toUpperCase():'—'} plan`}/>
         <Stat icon={Users} label="Registered" value={licence.registered_employees} sub={`${licence.pending_invitations} pending invitation(s)`}/>
         <Stat icon={Users} label="Additional licences" value={licence.additional_employees} sub={licence.addon_monthly_price===null?'Price not configured':`KES ${Number(licence.addon_monthly_price).toLocaleString()} / seat / month`}/>
         <Stat icon={CheckCircle2} label="Available" value={licence.available_licences} sub={Number(licence.over_limit||0)>0?`${licence.over_limit} over allowance`:'Within allowance'}/>
       </div>
     </section>}

     <div className="flex justify-end"><button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-xs font-bold text-foreground"><RefreshCw size={14}/> Refresh subscription</button></div>
   </div>
 </div>;
}
