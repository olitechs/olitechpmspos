import React,{useEffect,useState} from 'react';
import {Globe2} from 'lucide-react';
import {useAuth} from '@/lib/AuthContext';
import {pmsService} from '@/services/pmsService';
const B='var(--border)',S='var(--surface)',S2='var(--sidebar)',T='var(--text)',M='var(--text-muted)';
// Configuration and policy preview for the property's direct booking engine.
// The guest-facing booking page is not published yet, so this screen does not
// simulate a search or a booking flow. See docs/OPEN_QUESTIONS.md.
export default function BookingEngine(){
  const{user}=useAuth(),propertyId=user?.property?.id;
  const[d,setD]=useState(null),[error,setError]=useState('');
  useEffect(()=>{if(propertyId)pmsService.getBookingEngineConfig(propertyId).then(setD).catch(e=>setError(e.message))},[propertyId]);
  return <div className="flex-1 overflow-y-auto p-4" style={{background:'var(--canvas)'}}><div className="max-w-5xl mx-auto rounded-2xl p-6" style={{background:S,border:'1px solid '+B}}>
    <div className="flex items-center gap-2"><Globe2 size={20}/><h1 className="text-lg font-black">{d?.name||'Direct Booking Engine'}</h1></div>
    <p className="text-sm mt-2" style={{color:M}}>Configuration shown here is what the direct booking channel uses. Availability and rates remain controlled by the PMS inventory.</p>
    {error&&<p role="alert" className="mt-4 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-xs text-[var(--danger-text)]">{error}</p>}
    {d&&<div className="grid sm:grid-cols-2 gap-3 mt-6">
      <div className="p-4 rounded-xl" style={{background:S2}}><div className="text-xs font-bold" style={{color:T}}>Currency</div><div className="mt-1 text-sm" style={{color:M}}>{d.currency||'Not configured'}</div></div>
      <div className="p-4 rounded-xl" style={{background:S2}}><div className="text-xs font-bold" style={{color:T}}>Cancellation policy</div><div className="mt-1 text-sm whitespace-pre-line" style={{color:M}}>{d.cancellation_policy||'Not configured'}</div></div>
      <div className="p-4 rounded-xl" style={{background:S2}}><div className="text-xs font-bold" style={{color:T}}>Booking terms</div><div className="mt-1 text-sm whitespace-pre-line" style={{color:M}}>{d.terms||'Not configured'}</div></div>
      <div className="p-4 rounded-xl" style={{background:S2}}><div className="text-xs font-bold" style={{color:T}}>Payment instructions</div><div className="mt-1 text-sm whitespace-pre-line" style={{color:M}}>{d.payment_instructions||'Not configured'}</div></div>
    </div>}
    <div className="mt-6 p-4 rounded-xl text-xs" style={{background:S2,color:M}}>The guest-facing booking page is not published yet. When it goes live, guests will book from this property's booking link; this screen shows the configuration that page will use.</div>
  </div></div>;
}
