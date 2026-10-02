import React,{useEffect,useState}from'react';import{CreditCard,RefreshCw}from'lucide-react';import{useAuth}from'@/lib/AuthContext';import{pmsService}from'@/services/pmsService';

const BILLING_MODULE={cashier:'pos'};

function isApprovedWorkspace(user){
 const property=user?.property;
 return property?.status==='active'&&property?.package&&property.package!=='none';
}

export default function PaywallGuard({module,children}){
 const{user}=useAuth();const[id,setId]=useState(0);const[loading,setLoading]=useState(true);const[access,setAccess]=useState(null);
 const accessModule=BILLING_MODULE[module]||module;
 useEffect(()=>{let live=true;(async()=>{
   if(!user||user.isPlatformOwner||!user.property?.id){setAccess({allowed:true});setLoading(false);return}
   try{
     setLoading(true);
     const x=await pmsService.getSubscriptionAccess(user.property.id,accessModule);
     if(!live)return;
     if(x?.allowed){setAccess(x);return}

     // Backward-compatible approval fallback: older deployments may still
     // run a pre-0042 RPC that returns "active/professional" but incorrectly
     // denies access because of stale billing dates. The Platform Admin's
     // active property + package state is authoritative for an approved
     // workspace. If the subscription overview has no explicit module
     // overrides, allow the package entitlements to reach the existing app.
     if(isApprovedWorkspace(user)&&x?.status==='active'){
       try{
         const overview=await pmsService.getMySubscriptionOverview();
         const explicitModules=Array.isArray(overview?.enabled_modules)?overview.enabled_modules:[];
         if(overview?.property_status==='active'&&overview?.subscription_status==='active'&&explicitModules.length===0){
           setAccess({...x,allowed:true,reason:'active_package'});
           return;
         }
       }catch{}
     }
     setAccess(x||{allowed:false});
   }catch(e){
     // Do not turn a live approved property into a paywall solely because
     // the access RPC is from an older migration. Core approval remains
     // active/property-scoped; explicit subscription suspension still wins.
     if(isApprovedWorkspace(user)){
       try{
         const overview=await pmsService.getMySubscriptionOverview();
         const explicitModules=Array.isArray(overview?.enabled_modules)?overview.enabled_modules:[];
         if(overview?.property_status==='active'&&overview?.subscription_status==='active'&&explicitModules.length===0){
           if(live)setAccess({allowed:true,status:'active',plan_code:overview.plan_code||user.property.package,reason:'active_package'});
           return;
         }
       }catch{}
     }
     if(live)setAccess({allowed:false,reason:e.message});
   }finally{if(live)setLoading(false)}
 })();return()=>{live=false}},[user,accessModule,id]);

 if(loading)return <div className="flex h-full items-center justify-center bg-[#F8F8F7]"><RefreshCw className="animate-spin"/></div>;
 if(access?.allowed)return children;
 return <div className="flex h-full items-center justify-center bg-[#F8F8F7] p-6"><div className="max-w-md rounded-2xl border bg-white p-8 text-center shadow-sm"><div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#FFD300]"><CreditCard size={22}/></div><h2 className="text-xl font-black text-[#090C11]">Subscription required</h2><p className="mt-2 text-sm text-[#757B81]">This workspace is unavailable until the property subscription is active.</p><div className="mt-5 rounded-xl bg-[#F2F2F2] p-3 text-left text-xs"><div><b>Status:</b> {access?.status||'Not configured'}</div><div><b>Plan:</b> {access?.plan_code||'—'}</div></div><button onClick={()=>setId(x=>x+1)} className="mt-5 rounded-xl bg-[#FFD300] px-4 py-2 text-sm font-black">Check subscription again</button></div></div>
}