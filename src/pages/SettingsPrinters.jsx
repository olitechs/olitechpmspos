import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Printer, Wifi, Play, X, RefreshCw, CheckCircle2, AlertCircle, CircleOff, Network, ChevronRight } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getPrinters, getAssignments, testPrint, connectPrinter } from '@/services/printService';
import { supabase } from '@/lib/supabaseClient';

const TYPES = [
  ['receipt_80mm','Receipt Printer'],
  ['kitchen','Kitchen Printer'],
  ['bar','Bar Printer'],
  ['label','Label Printer'],
];

const ASSIGNMENTS = [
  ['food_orders','Food Orders','Kitchen'],
  ['drinks_orders','Drinks Orders','Bar'],
  ['void_food_orders','Food Void Slips','Kitchen'],
  ['void_drinks_orders','Drinks Void Slips','Bar'],
  ['unsettled_bills','Unsettled Bills','Front Office'],
  ['final_receipts','Final Receipts','Front Office'],
  ['reports','Reports','Back Office'],
  ['shift_reports','Shift Closing Reports','Back Office'],
];

const blank = {
  name:'',
  type:'receipt_80mm',
  connection_type:'network_ip',
  ip_address:'',
  port:9100,
  windows_printer_name:'',
  agent_url:'http://127.0.0.1:8631',
  baud_rate:9600,
  device_name:'',
  device_address:'',
  paper_width:'80mm',
  is_online:false,
  is_default:false,
  last_status:'disconnected',
};

const statusMeta = printer => {
  if (printer?.is_online && printer?.last_status === 'connected') {
    return {label:'Connected', Icon:CheckCircle2, cls:'bg-emerald-50 text-emerald-700 border-emerald-100', dot:'bg-emerald-500'};
  }
  if (printer?.last_status === 'testing') {
    return {label:'Testing…', Icon:RefreshCw, cls:'bg-amber-50 text-amber-700 border-amber-100', dot:'bg-amber-500'};
  }
  if (printer?.last_status === 'failed' || printer?.last_status === 'offline') {
    return {label:'Offline', Icon:AlertCircle, cls:'bg-red-50 text-red-700 border-red-100', dot:'bg-red-500'};
  }
  return {label:'Not verified', Icon:CircleOff, cls:'bg-slate-50 text-slate-600 border-slate-200', dot:'bg-slate-400'};
};

export default function SettingsPrinters() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [printers,setPrinters] = useState([]);
  const [assignments,setAssignments] = useState([]);
  const [editing,setEditing] = useState(null);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [testingId,setTestingId] = useState(null);
  const [loading,setLoading] = useState(true);

  const load = async (silent=false) => {
    if (!propertyId) return;
    if (!silent) setLoading(true);
    try {
      const [p,a] = await Promise.all([getPrinters(propertyId),getAssignments(propertyId)]);
      setPrinters(p);
      setAssignments(a);
      setError('');
    } catch (e) {
      setError(e.message || 'Unable to load printer settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(()=>{ load(); },[propertyId]);

  const openNew = () => {
    setError(''); setNotice('');
    setEditing({...blank,assignmentTypes:[]});
  };

  const openEdit = printer => {
    setError(''); setNotice('');
    setEditing({
      ...printer,
      connection_type:printer.connection_type || 'network_ip',
      port:printer.port || 9100,
      windows_printer_name:printer.windows_printer_name || '',
      agent_url:printer.agent_url || 'http://127.0.0.1:8631',
      baud_rate:printer.baud_rate || 9600,
      device_name:printer.device_name || '',
      device_address:printer.device_address || '',
      assignmentTypes:assignments.filter(a=>a.printer_id===printer.id).map(a=>a.assignment_type),
    });
  };

  const save = async () => {
    if (!editing?.name?.trim()) return setError('Printer name is required.');
    const type = editing.connection_type || 'network_ip';
    const port = Number(editing.port || 9100);
    if (type === 'network_ip') {
      if (!editing.ip_address?.trim()) return setError('Enter the printer IP address.');
      if (!Number.isInteger(port) || ![9100,9101,9102].includes(port)) return setError('Use TCP port 9100, 9101 or 9102.');
    }
    if (type === 'windows_printer' && !editing.windows_printer_name?.trim()) return setError('Enter the Windows installed printer name.');
    if (type === 'serial' && ![9600,19200,38400,57600,115200].includes(Number(editing.baud_rate || 9600))) return setError('Select a supported serial baud rate.');

    setError(''); setNotice('');
    const {assignmentTypes=[],...printerFields} = editing;
    const payload = {
      ...printerFields,
      property_id:propertyId,
      connection_type:type,
      port,
      is_online:false,
      last_status:'testing',
      last_error:null,
    };

    const result = editing.id
      ? await supabase.from('property_printers').update(payload).eq('id',editing.id).eq('property_id',propertyId).select().single()
      : await supabase.from('property_printers').insert(payload).select().single();

    if (result.error) return setError(result.error.message);

    const printerId=result.data.id;
    const deleted=await supabase.from('printer_assignments').delete().eq('printer_id',printerId).eq('property_id',propertyId);
    if (deleted.error) return setError(deleted.error.message);
    if (assignmentTypes.length) {
      const inserted=await supabase.from('printer_assignments').insert(assignmentTypes.map(type=>({property_id:propertyId,printer_id:printerId,assignment_type:type})));
      if (inserted.error) return setError(inserted.error.message);
    }

    setEditing(null);
    await load(true);
    await verify(printerId,result.data);
  };

  const verify = async (id, printerOverride=null) => {
    const printer=printerOverride || printers.find(p=>p.id===id);
    if (!printer) return;

    setError('');
    setNotice('');
    setTestingId(id);

    // Never leave the card/button stuck in "Testing…" if a transport,
    // Supabase request, browser fetch, or unexpected exception fails.
    const timeout = new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error('Printer verification timed out. Check the local OliTechs Print Agent and printer network connection.')), 12000);
    });

    try {
      let result;
      if (['usb','bluetooth','serial','windows_printer'].includes(printer.connection_type)) {
        result = await connectPrinter(printer, propertyId);
        if (result?.ok) result = await testPrint(printer, propertyId);
      } else {
        result = await Promise.race([testPrint(printer, propertyId), timeout]);
      }

      if (result?.ok) {
        setNotice(`Connection verified. Test ticket sent directly to ${printer.name}.`);
      } else {
        setError(result?.friendlyError || 'The printer is offline or unreachable.');
      }
    } catch (e) {
      setError(e?.message || 'Printer verification failed.');
    } finally {
      setTestingId(null);
      // Always refresh the persisted status after the test, including failures.
      await load(true).catch(() => {});
    }
  };

  const remove = async id => {
    if (!window.confirm('Delete this printer and its routing assignments?')) return;
    const result=await supabase.from('property_printers').delete().eq('id',id).eq('property_id',propertyId);
    if (result.error) setError(result.error.message);
    else setNotice('Printer removed.');
    await load(true);
  };

  const removeAssignment = async assignment => {
    const result=await supabase.from('printer_assignments').delete().eq('id',assignment.id).eq('property_id',propertyId);
    if (result.error) setError(result.error.message);
    await load(true);
  };

  const addAssignment = async (printerId,type) => {
    if (!printerId) return;
    const exists=assignments.some(a=>a.printer_id===printerId && a.assignment_type===type);
    if (exists) return;
    const result=await supabase.from('printer_assignments').insert({property_id:propertyId,printer_id:printerId,assignment_type:type});
    if (result.error) setError(result.error.message);
    else setNotice('Printer routing updated.');
    await load(true);
  };

  const connectedCount=printers.filter(p=>p.is_online && p.last_status==='connected').length;
  const assignedCount=assignments.length;

  const grouped=useMemo(()=>ASSIGNMENTS.reduce((acc,row)=>{
    const group=row[2];
    (acc[group] ||= []).push(row);
    return acc;
  },{}),[]);

  return (
    <div className="min-h-full bg-[#F7F8FA]">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-5 lg:px-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                <Network size={14}/> Property Operations / Printing
              </div>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Printer Management</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">Manage physical thermal printers from OliTechs. Jobs are sent through the platform over TCP — no Windows print dialog or tablet printer is used.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={()=>load()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"><RefreshCw size={15}/>Refresh</button>
              <button onClick={openNew} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-amber-300 shadow-sm hover:bg-slate-800"><Plus size={16}/>Add Printer</button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label="Configured" value={printers.length} icon={Printer}/>
            <Stat label="Connected" value={connectedCount} icon={Wifi}/>
            <Stat label="Routing rules" value={assignedCount} icon={ChevronRight} className="hidden md:flex"/>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-6 px-5 py-6 lg:px-7">
        {error && <Alert type="error" text={error}/>}
        {notice && <Alert type="success" text={notice}/>}
        {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading printer configuration…</div> :
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]">
            <section>
              <div className="mb-3 flex items-end justify-between">
                <div><h2 className="text-sm font-black uppercase tracking-wide text-slate-900">Physical Printers</h2><p className="mt-1 text-xs text-slate-500">Only a verified connection is shown as Connected.</p></div>
              </div>
              <div className="space-y-3">
                {printers.map(p=><PrinterCard key={p.id} printer={p} assignments={assignments.filter(a=>a.printer_id===p.id)} testing={testingId===p.id} onTest={()=>verify(p.id)} onEdit={()=>openEdit(p)} onDelete={()=>remove(p.id)} onRemoveAssignment={removeAssignment}/>)}
                {!printers.length && <Empty onAdd={openNew}/>}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5">
                <h2 className="font-black text-slate-950">Print Routing</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">Choose where each operational job goes. One job can be routed to multiple physical printers.</p>
              </div>
              <div className="divide-y divide-slate-100">
                {Object.entries(grouped).map(([group,rows])=><div key={group} className="p-5">
                  <div className="mb-3 text-[11px] font-black uppercase tracking-wider text-slate-400">{group}</div>
                  <div className="space-y-3">
                    {rows.map(([type,label])=>{
                      const current=assignments.filter(a=>a.assignment_type===type);
                      return <div key={type} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div><div className="text-sm font-bold text-slate-800">{label}</div><div className="mt-0.5 text-[11px] text-slate-400">{current.length ? `${current.length} printer${current.length===1?'':'s'} assigned` : 'No printer assigned'}</div></div>
                          <select value="" onChange={e=>addAssignment(e.target.value,type)} className="max-w-[150px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600">
                            <option value="">Add printer</option>
                            {printers.filter(p=>!current.some(a=>a.printer_id===p.id)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {current.map(a=>{const p=printers.find(x=>x.id===a.printer_id); return <span key={a.id} className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200">{p?.name || 'Unknown printer'}<button onClick={()=>removeAssignment(a)} className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Remove routing"><X size={12}/></button></span>})}
                        </div>
                      </div>;
                    })}
                  </div>
                </div>)}
              </div>
            </section>
          </div>}
      </div>

      {editing && <PrinterModal form={editing} setForm={setEditing} onClose={()=>setEditing(null)} onSave={save}/>}
    </div>
  );
}

function Stat({label,value,icon:Icon,className=''}) {
  return <div className={`flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5 ${className}`}><div className="rounded-lg bg-slate-100 p-2 text-slate-700"><Icon size={15}/></div><div><div className="text-lg font-black text-slate-950">{value}</div><div className="text-[11px] font-semibold text-slate-400">{label}</div></div></div>;
}

function Alert({type,text}) {
  return <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm font-semibold ${type==='error'?'border-red-100 bg-red-50 text-red-700':'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>{type==='error'?<AlertCircle size={17}/>:<CheckCircle2 size={17}/>}<span>{text}</span></div>;
}

function PrinterCard({printer,assignments,testing,onTest,onEdit,onDelete,onRemoveAssignment}) {
  const meta=statusMeta(printer);
  const Icon=meta.Icon;
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 gap-3">
        <div className="rounded-xl bg-slate-950 p-3 text-amber-300"><Printer size={19}/></div>
        <div className="min-w-0">
          <h3 className="truncate font-black text-slate-950">{printer.name}</h3>
          <div className="mt-1 text-xs font-semibold text-slate-500">{TYPES.find(x=>x[0]===printer.type)?.[1] || printer.type}</div>
        </div>
      </div>
      <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${meta.cls}`}><span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`}/><Icon size={12}/>{meta.label}</span>
    </div>

    <div className="mt-4 grid grid-cols-2 gap-2">
      <div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Network</div><div className="mt-1 font-mono text-xs font-bold text-slate-700">{printer.ip_address || 'IP not set'}</div></div>
      <div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">TCP Port</div><div className="mt-1 font-mono text-xs font-bold text-slate-700">{printer.port || 9100}</div></div>
    </div>

    {printer.last_error && <div className="mt-3 rounded-xl border border-red-100 bg-red-50 p-3 text-xs font-semibold leading-5 text-red-700">{printer.last_error}</div>}

    <div className="mt-3 flex flex-wrap gap-1.5">
      {assignments.length ? assignments.map(a=><span key={a.id} className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">{ASSIGNMENTS.find(x=>x[0]===a.assignment_type)?.[1] || a.assignment_type}</span>) : <span className="text-[11px] text-slate-400">No routing assigned</span>}
    </div>

    <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
      <button disabled={testing} onClick={onTest} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-amber-300 disabled:opacity-50"><Play size={13}/>{testing?'Testing…':'Test & Print'}</button>
      <button onClick={onEdit} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"><Pencil size={13}/>Edit</button>
      <button onClick={onDelete} className="inline-flex items-center gap-1.5 rounded-lg border border-red-100 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50"><Trash2 size={13}/>Delete</button>
      {printer.last_tested_at && <span className="ml-auto self-center text-[10px] text-slate-400">Tested {new Date(printer.last_tested_at).toLocaleString('en-KE')}</span>}
    </div>
  </article>;
}

function Empty({onAdd}) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100"><Printer size={20} className="text-slate-500"/></div><h3 className="mt-3 font-black text-slate-900">No printers configured</h3><p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">Add a network thermal printer with its LAN IP. OliTechs will verify the connection and print a test ticket before marking it connected.</p><button onClick={onAdd} className="mt-4 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-amber-300">Add your first printer</button></div>;
}

function PrinterModal({form,setForm,onClose,onSave}) {
  const selected=form.assignmentTypes||[];
  const toggle=type=>setForm({...form,assignmentTypes:selected.includes(type)?selected.filter(x=>x!==type):[...selected,type]});
  return <div className="fixed inset-0 z-[80] overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm">
    <div className="mx-auto my-6 w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">
      <div className="flex items-start justify-between border-b border-slate-200 p-5">
        <div><div className="flex items-center gap-2"><div className="rounded-lg bg-slate-950 p-2 text-amber-300"><Printer size={16}/></div><h3 className="text-lg font-black text-slate-950">{form.id?'Edit printer':'Add printer'}</h3></div><p className="mt-2 text-xs leading-5 text-slate-500">LAN and Windows-driver printers use the OliTechs Local Print Agent. USB, Bluetooth and serial printers use browser device APIs. Every connection is tested before it is marked Connected.</p></div>
        <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={18}/></button>
      </div>
      <div className="grid gap-5 p-5 md:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Printer name<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Kitchen Epson 01" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-900"/></label>
          <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Printer type<select value={form.type} onChange={e=>setForm({...form,type:e.target.value})} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">{TYPES.map(x=><option key={x[0]} value={x[0]}>{x[1]}</option>)}</select></label>
          <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Connection type
            <select value={form.connection_type || 'network_ip'} onChange={e=>setForm({...form,connection_type:e.target.value})} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
              <option value="network_ip">LAN / Network IP</option>
              <option value="windows_printer">Windows installed printer (USB / Bluetooth driver)</option>
              <option value="usb">USB direct (WebUSB)</option>
              <option value="bluetooth">Bluetooth direct (Web Bluetooth)</option>
              <option value="serial">USB / Bluetooth Serial (COM)</option>
            </select>
          </label>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Transport</div><p className="mt-1 text-[11px] leading-5 text-slate-500">LAN and Windows-driver printers use the OliTechs Print Agent. USB, Bluetooth and serial printers use the browser's native device connection.</p></div>
          {form.connection_type === 'network_ip' && <>
            <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Printer IP address<input value={form.ip_address||''} onChange={e=>setForm({...form,ip_address:e.target.value})} placeholder="192.168.1.50" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm outline-none focus:border-slate-900"/></label>
            <label className="block text-xs font-black uppercase tracking-wide text-slate-500">TCP port<input type="number" value={form.port||9100} onChange={e=>setForm({...form,port:e.target.value})} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm"/><span className="mt-1 block text-[11px] font-normal normal-case tracking-normal text-slate-400">9100 is the standard raw ESC/POS port for many network thermal printers.</span></label>
          </>}
          {form.connection_type === 'windows_printer' && <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Windows printer name<input value={form.windows_printer_name||''} onChange={e=>setForm({...form,windows_printer_name:e.target.value})} placeholder="EPSON TM-T20III" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"/></label>}
          {form.connection_type === 'serial' && <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Baud rate<select value={form.baud_rate||9600} onChange={e=>setForm({...form,baud_rate:Number(e.target.value)})} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">{[9600,19200,38400,57600,115200].map(rate=><option key={rate} value={rate}>{rate} baud</option>)}</select></label>}
          <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Paper width<select value={form.paper_width||'80mm'} onChange={e=>setForm({...form,paper_width:e.target.value})} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option>80mm</option><option>58mm</option></select></label>
        </div>
        <div>
          <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Print routing</div>
          <p className="mb-3 text-xs leading-5 text-slate-500">Select every job this physical printer should receive. You can also change routing later without editing the printer.</p>
          <div className="space-y-2">
            {ASSIGNMENTS.map(([type,label,group])=><label key={type} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50"><input type="checkbox" checked={selected.includes(type)} onChange={()=>toggle(type)} className="mt-0.5 h-4 w-4"/><span><span className="block text-sm font-bold text-slate-800">{label}</span><span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{group}</span></span></label>)}
          </div>
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 p-5 sm:flex-row sm:justify-end">
        <button onClick={onClose} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">Cancel</button>
        <button onClick={onSave} className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-black text-amber-300">Save & verify connection</button>
      </div>
    </div>
  </div>;
}
