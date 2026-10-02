import React from 'react';
import { CreditCard } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

function isApprovedWorkspace(user){
 const property=user?.property;
 return property?.status==='active'&&property?.package&&property.package!=='none';
}

export default function PaywallGuard({children}){
 const{user}=useAuth();

 // Property approval controls whether the workspace is available.
 // Module/staff access is enforced by RouteGuard, so an approved property
 // must not be blocked by subscription-module allowlists.
 if(user?.isPlatformOwner||isApprovedWorkspace(user)) return children;

 return <div className="flex h-full items-center justify-center bg-[#F8F8F7] p-6">
   <div className="max-w-md rounded-2xl border bg-white p-8 text-center shadow-sm">
     <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#FFD300]"><CreditCard size={22}/></div>
     <h2 className="text-xl font-black text-[#090C11]">Subscription required</h2>
     <p className="mt-2 text-sm text-[#757B81]">This workspace is unavailable until the property is approved and activated.</p>
   </div>
 </div>;
}
