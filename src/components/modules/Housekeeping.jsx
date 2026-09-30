import React from 'react';
import { Check, ClipboardCheck, Play, RefreshCw, Sparkles, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';

const btn='inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50';
const input='w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200';

export default function Housekeeping(){
 const {user}=useAuth(); const propertyId=user?.property?.id;
 const [tasks,setTasks]=React.useState([]),[dash,setDash]=React.useState({}),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
 const [selected,setSelected]=React.useState(null),[notes,setNotes]=React.useState('');
 const load=React.useCallback(async()=>{if(!propertyId)return;setError('');try{const [t,d]=await Promise.all([pmsService.listHousekeepingTasks(propertyId),pmsService.getHousekeepingDashboard(propertyId)]);setTasks(t);setDash(d)}catch(e){setError(e.message||'Unable to load housekeeping.')}},[propertyId]);
 React.useEffect(()=>{load()},[load]);
 const run=async(fn)=>{setBusy(true);setError('');try{await fn();setSelected(null);setNotes('');await load()}catch(e){setError(e.message||'Operation failed.')}finally{setBusy(false)}};
 const action=(task,status)=>run(()=>pmsService.updateHousekeepingTask({taskId:task.id,status,notes:notes.trim()||null}));
 const inspect=(task,pass)=>run(()=>pmsService.inspectHousekeepingTask({taskId:task.id,pass,notes:notes.trim()||null}));
 const createForRoom=(roomId,type='checkout_clean')=>run(()=>pmsService.createHousekeepingTask({propertyId,roomId,taskType:type,priority:type==='checkout_clean'?'high':'normal'}));
 const cols=[
  ['pending','Pending'],['in_progress','Cleaning'],['completed','Ready for inspection'],['rejected','Re-clean required']
 ];
 return <div className="flex-1 overflow-y-auto bg-[#f8f8f7] p-4 lg:p-6"><div className="mx-auto max-w-[1500px] space-y-4">
  <header className="flex items-center justify-between"><div><div className="flex items-center gap-2"><Sparkles size={18}/><h1 className="text-xl font-bold">Housekeeping 2.0</h1></div><p className="mt-1 text-sm text-slate-500">Live room readiness, cleaning tasks and supervisor inspection.</p></div><button className={btn+' border border-slate-200 bg-white'} onClick={load} disabled={busy}><RefreshCw size={15}/> Refresh</button></header>
  {error&&<div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Dirty" value={dash.rooms?.dirty||0}/><Metric label="Cleaning" value={dash.rooms?.cleaning||0}/><Metric label="Available" value={dash.rooms?.available||0}/><Metric label="Pending tasks" value={dash.tasks?.pending||0}/><Metric label="Inspection queue" value={dash.tasks?.completed||0}/></div>
  <div className="grid gap-4 xl:grid-cols-4">{cols.map(([status,label])=><section key={status} className="min-h-[300px] rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-200 p-4"><h2 className="font-bold">{label}</h2><p className="mt-1 text-xs text-slate-500">{tasks.filter(t=>t.status===status).length} task(s)</p></div><div className="space-y-2 p-3">
   {tasks.filter(t=>t.status===status).map(t=><TaskCard key={t.id} task={t} onStart={()=>action(t,'in_progress')} onComplete={()=>action(t,'completed')} onPass={()=>inspect(t,true)} onFail={()=>inspect(t,false)} onSelect={()=>setSelected(t)}/>)}
   {!tasks.some(t=>t.status===status)&&<div className="py-10 text-center text-xs text-slate-400">No tasks</div>}
  </div></section>)}</div>
  <section className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><ClipboardCheck size={17}/><h2 className="font-bold">Supervisor actions</h2></div><p className="mt-1 text-xs text-slate-500">Inspection pass makes a room available. Inspection failure sends it back to dirty for re-cleaning.</p>{selected&&<div className="mt-3 grid gap-3 md:grid-cols-[1fr_2fr_auto]"><div className="rounded-lg bg-slate-50 p-3 text-sm"><strong>Room {selected.room_number}</strong><div className="text-xs text-slate-500">{selected.task_type.replace('_',' ')} · {selected.status}</div></div><textarea className={input} rows="2" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Cleaning or inspection notes"/><div className="flex gap-2">{selected.status==='completed'&&<><button className={btn+' bg-emerald-600 text-white'} disabled={busy} onClick={()=>inspect(selected,true)}><Check size={15}/> Pass</button><button className={btn+' bg-red-600 text-white'} disabled={busy} onClick={()=>inspect(selected,false)}><X size={15}/> Fail</button></>}</div></div>}</section>
  <section className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="font-bold">Operational notes</h2><p className="mt-1 text-sm text-slate-500">Checkout rooms automatically enter the high-priority cleaning queue. Supervisors can inspect completed work and send failed rooms back for re-cleaning.</p></section>
 </div></div>
}
function TaskCard({task,onStart,onComplete,onPass,onFail,onSelect}){return <button onClick={onSelect} className="block w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-left hover:border-slate-400"><div className="flex justify-between"><strong>Room {task.room_number}</strong><span className="text-[10px] uppercase">{task.priority}</span></div><div className="mt-1 text-xs text-slate-500">{task.task_type.replace('_',' ')}{task.guest_name?' · '+task.guest_name:''}</div><div className="mt-3 flex gap-2">{task.status==='pending'&&<span onClick={e=>{e.stopPropagation();onStart()}} className="rounded bg-slate-900 px-2 py-1 text-[11px] font-bold text-white"><Play size={11} className="inline"/> Start</span>}{task.status==='in_progress'&&<span onClick={e=>{e.stopPropagation();onComplete()}} className="rounded bg-amber-400 px-2 py-1 text-[11px] font-bold"><Check size={11} className="inline"/> Complete</span>}{task.status==='completed'&&<span className="rounded bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">Inspect</span>}{task.status==='rejected'&&<span onClick={e=>{e.stopPropagation();onStart()}} className="rounded bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700">Re-clean</span>}</div></button>}
function Metric({label,value}){return <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-lg font-bold">{value}</div></div>}