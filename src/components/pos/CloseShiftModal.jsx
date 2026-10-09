import React,{useEffect,useMemo,useState}from'react';
import{Download,X,LockKeyhole,AlertTriangle}from'lucide-react';
import{toast}from'sonner';
import{useAuth}from'@/lib/AuthContext';
import{authService,getSessionStaff}from'@/services/authService';
import{shiftService,exportShiftToExcel}from'@/services/shiftService';
import{getPrinters,getAssignments,printShiftReport}from'@/services/printService';
import PinPad from'@/components/auth/PinPad';

const money=n=>Number(n||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
export function OpenShiftModal({propertyId,onOpened}){const[cash,setCash]=useState('');const[notes,setNotes]=useState('');const[busy,setBusy]=useState(false);const[error,setError]=useState('');const staff=getSessionStaff();const open=async()=>{setBusy(true);setError('');try{const s=await shiftService.openShift({propertyId,openingCash:Number(cash||0),notes});onOpened?.(s);}catch(e){setError(e.message||'Unable to open shift.')}finally{setBusy(false)}};return <div className="fixed inset-0 z-[270] flex items-center justify-center bg-black/70 p-4"><div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"><div className="text-xl font-black">Open Shift</div><p className="mt-1 text-sm text-slate-500">Start today’s POS cashier shift before taking payments.</p><div className="mt-5 space-y-3"><div><label className="text-xs font-black uppercase text-slate-500">Opening Cash (Float)</label><input autoFocus value={cash} onChange={e=>setCash(e.target.value)} type="number" min="0" placeholder="5000" className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-lg font-black"/></div><div className="rounded-xl bg-slate-50 p-3 text-xs"><b>Cashier:</b> {staff?.full_name||'Current staff'}<br/><b>Date:</b> {new Date().toLocaleDateString('en-KE')}</div><textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Opening notes (optional)" className="min-h-20 w-full rounded-xl border border-slate-300 p-3 text-sm"/>{error&&<div className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}<button disabled={busy} onClick={open} className="w-full rounded-xl bg-[#090C11] p-3.5 text-sm font-black text-white">{busy?'Opening…':'Open Shift'}</button></div></div></div>}

export default function CloseShiftModal({shift,onClosed,onClose}){
 const{user}=useAuth();const propertyId=user?.property?.id;const[report,setReport]=useState(null);const[counted,setCounted]=useState('');const[notes,setNotes]=useState('');const[busy,setBusy]=useState(false);const[error,setError]=useState('');const[pinOpen,setPinOpen]=useState(false);const[pinError,setPinError]=useState('');
 const staff=getSessionStaff();const[managerApproved,setManagerApproved]=useState(false);
 
 useEffect(()=>{if(!shift)return;shiftService.getShiftReport(shift.id).then(setReport).catch(e=>setError(e.message));},[shift]);
 const variance=useMemo(()=>report?Number(counted||0)-Number(report.expectedCash||0):0,[counted,report]);
 const doClose=async(approved=managerApproved)=>{
   setBusy(true);setError('');
   try{
    const closed=await shiftService.closeShift({shiftId:shift.id,countedCash:Number(counted||0),notes,managerApproved:approved});
    const fresh=await shiftService.getShiftReport(shift.id);
    fresh.countedCash=Number(counted||0);fresh.variance=Number(closed?.variance||0);fresh.propertyId=propertyId;fresh.openedBy=staff?.full_name||user?.name||'Staff';fresh.closedBy=staff?.full_name||user?.name||'Staff';
    const settingsRow=await (async()=>{const {data}=await import('@/lib/supabaseClient').then(m=>m.supabase.from('property_settings').select('*').eq('property_id',propertyId).maybeSingle());return data||null;})().catch(()=>null);
    fresh.settings=settingsRow;
    const [printers,assignments]=await Promise.all([getPrinters(propertyId),getAssignments(propertyId)]);
    const targets=assignments.filter(a=>a.assignment_type==='shift_reports'||a.assignment_type==='reports').map(a=>printers.find(p=>p.id===a.printer_id)).filter(Boolean);
    const printer=targets[0];
    if(printer){const printed=await printShiftReport(fresh,printer);if(!printed.ok)toast.warning('Shift closed, but one or more shift report copies failed to print.');}
    else toast.warning('Shift closed, but no Shift Closing Reports printer is assigned.');
    localStorage.removeItem(`olitech_pos_shift_${propertyId}`);
    onClosed?.(fresh);toast.success('Shift closed successfully.');
   }catch(e){setError(e.message||'Unable to close shift.');}finally{setBusy(false);}
 };
 const submitPin=async(pin)=>{
   setPinError('');
   try{const result=await authService.verifyStaffPin({propertyId,module:'pos',pin});const r=String(result?.staff?.role||'').toLowerCase().replace(/\s+/g,'_');if(!result?.ok||!managerRoles.has(r)){setPinError('Manager, cashier or administrator PIN required.');return;}setPinOpen(false);setManagerApproved(true);await doClose(true);}catch(e){setPinError(e.message||'PIN verification failed.');}
 };
 if(pinOpen)return <PinPad title="Manager PIN Required" staffName="Manager approval" error={pinError} onSubmit={submitPin} onClose={()=>setPinOpen(false)}/>;
 return <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/65 p-4"><div className="w-full max-w-xl overflow-hidden rounded-3xl bg-white shadow-2xl">
  <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><div className="text-lg font-black">Close Shift</div><div className="text-xs text-slate-500">{shift?.shift_no} · {shift?.date}</div></div><button onClick={onClose} className="rounded-xl p-2 hover:bg-slate-100"><X size={18}/></button></div>
  <div className="max-h-[72vh] overflow-y-auto p-5">
   {error&&<div className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
   {report&&<><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[['Opening Cash',report.shift.opening_cash],['Cash Sales',report.payments.cash.amount],['M-Pesa',report.payments.mpesa.amount],['Card',report.payments.card.amount],['Bank',report.payments.bank.amount],['Room Charge',report.payments.room_charge.amount],['Total Sales',report.totalSales]].map(([l,v])=><div key={l} className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase text-slate-500">{l}</div><div className="mt-1 font-mono text-sm font-black">KES {money(v)}</div></div>)}</div>
   <div className="mt-4 rounded-2xl border border-slate-200 p-4"><div className="flex justify-between text-sm"><span>Expected cash in drawer</span><b>KES {money(report.expectedCash)}</b></div><div className="mt-3"><label className="text-xs font-black uppercase text-slate-500">Actual Cash Counted</label><input autoFocus value={counted} onChange={e=>setCounted(e.target.value)} type="number" min="0" className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-lg font-black outline-none focus:border-[#0E7482]"/></div><div className={`mt-3 rounded-xl p-3 text-sm font-black ${Math.abs(variance)>500?'bg-red-50 text-red-700':'bg-slate-50 text-slate-800'}`}>{Math.abs(variance)>500&&<AlertTriangle size={15} className="mr-1 inline"/>}Variance: KES {money(variance)}</div></div>
   <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Closing notes (optional)" className="mt-4 min-h-20 w-full rounded-xl border border-slate-300 p-3 text-sm"/>
   </>}
  </div>
  <div className="flex flex-wrap justify-between gap-2 border-t border-slate-200 px-5 py-4"><button disabled={!report||busy} onClick={()=>{const r={...report,countedCash:Number(counted||0),variance};exportShiftToExcel(r)}} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold disabled:opacity-40"><Download size={16}/>Export Excel</button><div className="flex gap-2"><button onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold">Cancel</button><button disabled={!report||busy||counted===''} onClick={()=>Math.abs(variance)>500?setPinOpen(true):doClose()} className="inline-flex items-center gap-2 rounded-xl bg-[#090C11] px-5 py-2.5 text-sm font-black text-white disabled:opacity-40"><LockKeyhole size={16}/>{busy?'Closing…':Math.abs(variance)>500?'Manager PIN · Print & Close':'Print & Close Shift'}</button></div></div>
 </div></div>;
}