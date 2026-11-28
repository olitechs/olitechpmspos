import React,{useCallback,useEffect,useState}from'react';
import{
  AlertCircle,ArrowRight,Building2,CalendarDays,CheckCircle2,CreditCard,
  Hotel, Landmark, Mail, Package, RefreshCw, ShieldCheck, Smartphone, Users,
}from'lucide-react';
import{useAuth}from'@/lib/AuthContext';
import{pmsService}from'@/services/pmsService';
import{employeeService}from'@/services/employeeService';
import{SUBSCRIPTION_SUPPORT_EMAILS,evaluateSubscriptionAccess}from'@/lib/subscriptionAccess';
import{formatSubscriptionDate,breakdownRemaining}from'@/lib/subscriptionCountdown';
import SubscriptionRequestModal from '@/components/subscription/SubscriptionRequestModal';

const STATUS={
  trial:{label:'Free trial',className:'bg-[var(--warning-soft)] text-[var(--warning-text)] border-[var(--warning)]'},
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

// Approved display-only preview. Operational access remains property scoped and
// authoritative in the database; these cards describe commercial packages only.
const TRIAL_DAYS=7;
const TRIAL_PROPERTY_ALLOWANCE=3;
const TRIAL_URGENT_SECONDS=48*60*60;
const TICK_MS=60_000;

const PLAN_CARDS=[
  {
    id:'starter',name:'Starter',price:{monthly:3500,annual:2800},properties:'1',
    features:['POS only','2 staff logins','1 property','Basic reports'],
  },
  {
    id:'standard',name:'Standard',price:{monthly:7000,annual:5600},properties:'1',
    features:['PMS + POS','Housekeeping','5 staff logins','1 property'],
  },
  {
    id:'professional',name:'Professional',price:{monthly:14000,annual:11200},properties:'3',
    features:['Full PMS + POS','Storekeeper','Employees','Reports','3 properties','20 staff'],popular:true,
  },
  {
    id:'enterprise',name:'Enterprise',price:{monthly:null,annual:null},properties:'Unlimited',
    features:['Everything in Pro','Unlimited properties','Unlimited staff','API access','Priority SLA'],
  },
];

const PAYMENT_METHODS=[
  {icon:Smartphone,name:'M-Pesa',detail:'Mobile money payment details are supplied by OliTechs support.'},
  {icon:Landmark,name:'Bank Transfer',detail:'Transfer details are supplied when your renewal is approved.'},
  {icon:CreditCard,name:'Card (Stripe)',detail:'Secure online checkout is arranged by the OliTechs team.'},
];

function formatTrialStart(value){
  if(!value)return'—';
  const end=new Date(value).getTime();
  return Number.isFinite(end)?formatSubscriptionDate(new Date(end-TRIAL_DAYS*86400000).toISOString()):'—';
}

function formatTrialPlan(value){
  const name=String(value||'professional').replaceAll('_',' ').trim();
  return 'OliTechs '+name.replace(/\b\w/g,(letter)=>letter.toUpperCase());
}

function StatusBadge({status}){
  const meta=STATUS[status]||{label:status||'Not configured',className:'bg-secondary text-muted-foreground border-border'};
  return <span className={'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wide '+meta.className}>
    <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"/>{meta.label}
  </span>;
}

function Stat({icon:Icon,label,value,sub}){
  return <div className="rounded-2xl border border-border bg-surface p-4">
    <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Icon size={15} aria-hidden="true"/>{label}</div>
    <div className="mt-2 text-lg font-black text-foreground">{value}</div>
    {sub&&<div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
  </div>;
}

function PlanStat({label,value,tone='text-foreground'}){
  return <div className="min-w-[100px] flex-1 rounded-xl border border-border bg-canvas px-3 py-2.5">
    <div className="text-[10px] font-black uppercase tracking-[.08em] text-muted-foreground">{label}</div>
    <div className={'mt-1 text-base font-black '+tone}>{value}</div>
  </div>;
}

export default function SubscriptionPanel(){
  const{user}=useAuth();
  const[overview,setOverview]=useState(null);
  const[entitlement,setEntitlement]=useState(null);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState('');
  const[licence,setLicence]=useState(null);
  const[billingCycle,setBillingCycle]=useState('monthly');
  const[now,setNow]=useState(()=>Date.now());
  const[requestModal,setRequestModal]=useState(null);
  const openRequest=(kind,packageName)=>setRequestModal({kind,packageName});
  const propertyId=user?.property?.id;

  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const[nextOverview,nextEntitlement]=await Promise.all([
        pmsService.getMySubscriptionOverview(),
        pmsService.getMySubscriptionEntitlement(),
      ]);
      setOverview(nextOverview);setEntitlement(nextEntitlement);
    }catch(e){setError(e?.message||'Unable to load subscription details.')}
    finally{setLoading(false)}
  },[]);

  useEffect(()=>{load()},[load]);

  // Countdowns tick locally but always start from the server evaluation time.
  useEffect(()=>{
    if(!['trial','expiring_soon'].includes(String(entitlement?.state||'')))return undefined;
    const timer=window.setInterval(()=>setNow(Date.now()),TICK_MS);
    return()=>window.clearInterval(timer);
  },[entitlement?.state]);

  // Employee licence overview is informational and additive: an older
  // deployment without the employee-management migration simply leaves the
  // section out.
  useEffect(()=>{
    if(!propertyId)return;
    let active=true;
    employeeService.licenceState(propertyId).then(state=>{if(active)setLicence(state)}).catch(()=>{});
    return()=>{active=false};
  },[propertyId]);

  if(loading)return <div className="flex flex-1 items-center justify-center p-8"><RefreshCw className="animate-spin text-muted-foreground" aria-hidden="true"/></div>;

  if(error)return <div className="p-5"><div className="max-w-2xl rounded-2xl border border-[var(--danger)] bg-[var(--danger-soft)] p-5 text-sm text-[var(--danger-text)]"><div className="flex items-center gap-2 font-bold"><AlertCircle size={17} aria-hidden="true"/> Subscription details unavailable</div><p className="mt-2">{error}</p><button onClick={load} className="mt-4 rounded-xl border border-[var(--danger)] bg-surface px-4 py-2 text-xs font-bold">Try again</button></div></div>;

  if(!overview)return <div className="p-5"><div className="max-w-2xl rounded-2xl border border-border bg-surface p-8 text-center"><Building2 className="mx-auto text-muted-foreground" aria-hidden="true"/><h2 className="mt-3 font-black text-foreground">No property assigned</h2><p className="mt-1 text-sm text-muted-foreground">Your account is not currently assigned to a hotel/property. Contact your administrator.</p></div></div>;

  const modules=Array.isArray(overview.enabled_modules)?overview.enabled_modules:[];
  const status=entitlement?.state||overview.subscription_status||'trial';
  const plan=overview.plan_code||overview.property_package||'Not configured';
  const roomLimit=overview.room_limit||'Not configured';
  const userLimit=overview.user_limit||'Not configured';
  const access=evaluateSubscriptionAccess(user);
  const computedState=access.state||'expired';
  const datesElapsed=['server_dates','subscription_dates'].includes(access.source);
  const trialEndsAt=overview.trial_ends_at||entitlement?.trial_ends_at||null;
  const fallbackSeconds=trialEndsAt?Math.floor((new Date(trialEndsAt).getTime()-now)/1000):null;
  const serverSeconds=Number(entitlement?.seconds_remaining);
  const evaluatedAt=new Date(entitlement?.evaluated_at).getTime();
  const trialSeconds=Number.isFinite(serverSeconds)&&serverSeconds>=0&&Number.isFinite(evaluatedAt)
    ?Math.max(0,Math.floor(serverSeconds-(now-evaluatedAt)/1000))
    :fallbackSeconds===null?null:Math.max(0,fallbackSeconds);
  const trialRemaining=trialSeconds===null?null:breakdownRemaining(trialSeconds);
  const usedDays=trialSeconds===null?0:Math.min(TRIAL_DAYS,Math.max(0,TRIAL_DAYS-Math.ceil(trialSeconds/86400000)));
  const trialUsedPercent=trialSeconds===null?0:Math.min(100,Math.round((usedDays/TRIAL_DAYS)*100));
  const urgentTrial=trialSeconds!==null&&trialSeconds<=TRIAL_URGENT_SECONDS;
  const isTrial=computedState==='trial'||computedState==='expiring_soon'||String(status)==='trial';
  const currentPlan=String(plan||'').toLowerCase();
  const canManageBilling=['owner','admin'].includes(String(user?.propertyRole||overview.property_role||'').toLowerCase());

  return <div className="flex-1 overflow-y-auto bg-canvas p-4 md:p-6">
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-black text-foreground">Billing &amp; Subscription</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your OliTechs plan, request a subscription and track access.</p>
      </div>

      <div className="rounded-3xl border border-border bg-surface p-5 md:p-6">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="flex gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary"><Hotel size={22} className="text-primary-foreground" aria-hidden="true"/></div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[.16em] text-muted-foreground">Your property</p>
              <h2 className="mt-1 text-xl font-black text-foreground">{overview.property_name||'Unnamed property'}</h2>
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
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-[var(--primary-hover)]" aria-hidden="true"/>
          <div><div className="font-bold text-foreground">Subscription managed by OliTechs Platform Admin</div><p className="mt-1 text-xs leading-5 text-muted-foreground">Requests are reviewed by OliTechs and activation is applied centrally. All operational access remains server-authoritative.</p></div>
        </div>
      </div>

      <section className="rounded-3xl border border-border bg-surface p-5">
        <div className="flex items-center gap-3">
          <Package size={18} className="text-[var(--primary-hover)]" aria-hidden="true"/>
          <div><h2 className="font-black text-foreground">Current Plan</h2><p className="text-xs text-muted-foreground">Your assigned package and entitlement status.</p></div>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-lg font-black text-foreground">{formatTrialPlan(plan)}</div>
          {isTrial
            ?<span className="inline-flex rounded-full bg-[var(--warning)] px-3 py-1 text-xs font-black tracking-wider text-[var(--white)]">FREE TRIAL</span>
            :<StatusBadge status={status}/>}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <PlanStat label="Trial started" value={formatTrialStart(trialEndsAt)}/>
          <PlanStat label="Trial ends" value={trialEndsAt?formatSubscriptionDate(trialEndsAt):'—'} tone={urgentTrial?'text-[var(--danger-text)]':'text-[var(--warning-text)]'}/>
          <PlanStat label="Days left" value={trialRemaining?trialRemaining.days:'—'} tone={urgentTrial?'text-[var(--danger-text)]':'text-[var(--warning-text)]'}/>
          <PlanStat label="Hours left" value={trialRemaining?trialRemaining.hours:'—'}/>
          <PlanStat label="Properties" value={isTrial?`1 / ${TRIAL_PROPERTY_ALLOWANCE}`:'—'}/>
        </div>

        {isTrial&&trialEndsAt&&<div className="mt-4">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={trialUsedPercent}
            aria-label="Trial days used"
            className="h-2 overflow-hidden rounded-full bg-secondary"
          >
            <div className="h-full rounded-full bg-[var(--brand-primary)]" style={{width:`${trialUsedPercent}%`}}/>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{usedDays} of {TRIAL_DAYS} trial days used</p>
        </div>}

        <div className="mt-5 flex flex-wrap gap-2">
          {canManageBilling
            ?<button type="button" onClick={()=>openRequest('renewal',plan)} className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-bold text-[var(--white)] hover:opacity-90"><RefreshCw size={15} aria-hidden="true"/> Renew / Subscribe</button>
            :<span className="inline-flex items-center rounded-xl border border-border bg-canvas px-4 py-2.5 text-sm font-semibold text-muted-foreground">Ask your administrator to renew</span>}
          <a href="#plans" className="inline-flex items-center gap-2 rounded-xl border border-[var(--brand-primary)] px-4 py-2.5 text-sm font-bold text-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/5"><Package size={15} aria-hidden="true"/> View Plans</a>
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-surface p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h2 className="font-black text-foreground">Computed access status</h2>
            <p className="mt-1 text-xs text-muted-foreground">Stored status: <b className="capitalize text-foreground">{String(status).replaceAll('_',' ')}</b> · Computed status: <b className="capitalize text-foreground">{computedState.replace(/_/g,' ')}</b></p>
            {datesElapsed&&<p className="mt-2 text-xs text-[var(--danger-text)]">A stored <b>active</b> status does not override elapsed subscription or grace dates. Operational access is locked.</p>}
            <p className="mt-2 text-xs text-muted-foreground">Requests are reviewed by <b className="text-foreground">{SUBSCRIPTION_SUPPORT_EMAILS.join(' and ')}</b> before access changes.</p>
          </div>
          {canManageBilling
            ?<button type="button" onClick={()=>openRequest(access.blocked?'renewal':'subscribe',plan)} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-xs font-bold text-foreground"><Mail size={14} aria-hidden="true"/> Send subscription request</button>
            :<span className="shrink-0 rounded-xl border border-border bg-canvas px-4 py-2 text-xs font-bold text-muted-foreground">Administrator only</span>}
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
          <div className="flex items-center gap-3"><CalendarDays size={18} aria-hidden="true"/><div><h2 className="font-black text-foreground">Billing &amp; access dates</h2><p className="text-xs text-muted-foreground">Dates currently assigned to this property.</p></div></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              ['Trial starts',formatTrialStart(trialEndsAt)],
              ['Trial ends',formatSubscriptionDate(trialEndsAt)],
              ['Current period ends',formatSubscriptionDate(overview.current_period_ends_at)],
              ['Grace period ends',formatSubscriptionDate(overview.grace_ends_at)],
            ].map(([label,value])=><div key={label} className="rounded-2xl bg-canvas p-4"><div className="text-xs font-semibold text-muted-foreground">{label}</div><div className="mt-2 font-black text-foreground">{value}</div></div>)}
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-surface p-5">
          <h2 className="font-black text-foreground">Plan limits</h2>
          <p className="mt-1 text-xs text-muted-foreground">Limits are determined by the assigned package.</p>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between border-b border-border pb-3"><span className="text-muted-foreground">Rooms</span><b>{roomLimit}</b></div>
            <div className="flex justify-between border-b border-border pb-3"><span className="text-muted-foreground">Users</span><b>{userLimit}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Status</span><b className="capitalize">{String(status).replaceAll('_',' ')}</b></div>
          </div>
        </section>
      </div>

      <section id="plans" className="scroll-mt-6 rounded-3xl border border-border bg-surface p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div><h2 className="font-black text-foreground">Available Plans</h2><p className="mt-1 text-xs text-muted-foreground">Choose the plan that fits your property. OliTechs reviews and activates requests.</p></div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-muted-foreground">Billing Cycle:</span>
            <div className="flex rounded-xl border border-border bg-canvas p-1" role="group" aria-label="Billing cycle">
              {['monthly','annual'].map(cycle=>(
                <button
                  key={cycle}
                  type="button"
                  aria-pressed={billingCycle===cycle}
                  onClick={()=>setBillingCycle(cycle)}
                  className={'rounded-lg px-3 py-1.5 text-xs font-bold capitalize transition-colors '+(billingCycle===cycle?'bg-[var(--brand-primary)] text-[var(--white)]':'text-muted-foreground hover:text-foreground')}
                >
                  {cycle}{cycle==='annual'&&<span className="ml-1 rounded-full bg-[var(--success-soft)] px-1.5 py-0.5 text-[10px] text-[var(--success-text)]">Save 20%</span>}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {PLAN_CARDS.map(card=>{
            const price=card.price[billingCycle];
            const isCurrent=billingCycle==='monthly'&&currentPlan===card.id&&!isTrial
              ||(isTrial&&card.id==='professional');
            const cta=isCurrent
              ?isTrial?'Current trial':'Current plan'
              :currentPlan===card.id?'Renew this plan':`Request ${card.name}`;
            return <div key={card.id} className={'relative flex flex-col rounded-2xl border p-4 '+(card.popular?'border-[var(--brand-primary)] bg-[var(--brand-primary)]/5':'border-border bg-canvas')+' '+(isCurrent?'ring-2 ring-[var(--success)]':'')}>
              {card.popular&&<span className="absolute -top-3 left-4 rounded-full bg-[var(--brand-primary)] px-2.5 py-1 text-[10px] font-black tracking-wide text-[var(--white)]">POPULAR</span>}
              {isCurrent&&<span className="absolute -top-3 right-4 rounded-full bg-[var(--success)] px-2.5 py-1 text-[10px] font-black tracking-wide text-[var(--white)]">CURRENT{isTrial?' TRIAL':''}</span>}
              <h3 className="mt-2 font-black text-foreground">{card.name}</h3>
              <div className="mt-2 text-xl font-black text-[var(--brand-primary)]">
                {price===null?'Contact sales':<>KES {price.toLocaleString('en-KE')}<span className="text-xs font-semibold text-muted-foreground"> /mo{billingCycle==='annual'?' (annual)':''}</span></>}
              </div>
              <p className="mt-2 text-xs font-bold text-foreground">Properties: {card.properties}</p>
              <ul className="mt-3 flex-1 space-y-1 text-xs text-muted-foreground">
                {card.features.map(feature=><li key={feature} className="flex items-start gap-1.5"><CheckCircle2 size={13} className="mt-0.5 shrink-0 text-[var(--success-text)]" aria-hidden="true"/>{feature}</li>)}
              </ul>
              {isCurrent
                ?<span className="mt-4 inline-flex items-center justify-center rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-muted-foreground">{cta}</span>
                :<button type="button" onClick={()=>openRequest(currentPlan===card.id?'renewal':'upgrade',card.id)} className="mt-4 inline-flex items-center justify-center gap-1 rounded-xl bg-[var(--brand-primary)] px-3 py-2 text-xs font-bold text-[var(--white)] hover:opacity-90">{cta}<ArrowRight size={13} aria-hidden="true"/></button>}
            </div>;
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-surface p-5">
        <div className="flex items-center gap-3"><CreditCard size={18} aria-hidden="true"/><div><h2 className="font-black text-foreground">Payment Methods Accepted</h2><p className="text-xs text-muted-foreground">OliTechs confirms the payment details when reviewing a request.</p></div></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {PAYMENT_METHODS.map(method=>(
            <div key={method.name} className="flex items-start gap-3 rounded-xl border border-border bg-canvas p-4">
              <method.icon size={22} className="shrink-0 text-[var(--primary-hover)]" aria-hidden="true"/>
              <div><div className="text-sm font-bold text-foreground">{method.name}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{method.detail}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-surface p-5">
        <h2 className="font-black text-foreground">Invoice History</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Ref #</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <td className="px-3 py-3 font-semibold">TRIAL-{String(propertyId||'').slice(0,8).toUpperCase()||'PREVIEW'}</td>
                <td className="px-3 py-3">{formatTrialStart(trialEndsAt)}</td>
                <td className="px-3 py-3">{formatTrialPlan(plan)}</td>
                <td className="px-3 py-3">{TRIAL_DAYS}-day trial</td>
                <td className="px-3 py-3">KES 0</td>
                <td className="px-3 py-3"><span className="rounded-full bg-[var(--warning-soft)] px-2.5 py-1 text-xs font-black text-[var(--warning-text)]">TRIAL</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Paid invoices appear here after OliTechs activates the subscription.</p>
      </section>

      <section className="rounded-3xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-black text-foreground">Enabled modules</h2><p className="mt-1 text-xs text-muted-foreground">Modules explicitly enabled for this property.</p></div><span className="rounded-full bg-secondary px-3 py-1 text-xs font-bold">{modules.length} enabled</span></div>
        {modules.length
          ?<div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{modules.map(module=><div key={module} className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-semibold"><CheckCircle2 size={15} className="text-[var(--success-text)]" aria-hidden="true"/>{MODULE_LABELS[module]||String(module).replaceAll('_',' ')}</div>)}</div>
          :<div className="mt-4 rounded-2xl bg-canvas p-4 text-sm text-muted-foreground">No explicit module overrides are recorded. Access follows the package configuration controlled by the Platform Admin.</div>}
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

      <div className="flex justify-end"><button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-xs font-bold text-foreground"><RefreshCw size={14} aria-hidden="true"/> Refresh subscription</button></div>
      <SubscriptionRequestModal
        open={Boolean(requestModal)}
        onOpenChange={(next)=>{if(!next)setRequestModal(null)}}
        requestKind={requestModal?.kind||'subscribe'}
        packageName={requestModal?.packageName||plan}
        billingCycle={billingCycle}
      />
    </div>
  </div>;
}
