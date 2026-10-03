import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Printer, Wifi, Play, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getPrinters, getAssignments, testPrint } from '@/services/printService';
import { supabase } from '@/lib/supabaseClient';

const TYPES = [['receipt_80mm','Receipt 80mm'],['kitchen','Kitchen'],['bar','Bar'],['label','Label']];
const CONNECTIONS = [['network_ip','Direct Network IP (TCP)']];
const ASSIGNMENTS = [
  ['food_orders','Food Orders'],
  ['drinks_orders','Drinks Orders'],
  ['void_food_orders','Food Void Slips'],
  ['void_drinks_orders','Drinks Void Slips'],
  ['unsettled_bills','Unsettled Bills'],
  ['final_receipts','Final Receipts'],
  ['reports','Reports'],
  ['shift_reports','Shift Closing Reports'],
];

export default function SettingsPrinters() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [printers,setPrinters] = useState([]);
  const [assignments,setAssignments] = useState([]);
  const [editing,setEditing] = useState(null);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [testingId,setTestingId] = useState(null);

  const blank = {
    name:'',
    type:'receipt_80mm',
    connection_type:'network_ip',
    ip_address:'',
    port:9100,
    paper_width:'80mm',
    is_online:false,
    is_default:false,
    last_status:'disconnected'
  };

  const load = async () => {
    if (!propertyId) return;
    try {
      const [p,a] = await Promise.all([getPrinters(propertyId),getAssignments(propertyId)]);
      setPrinters(p);
      setAssignments(a);
    } catch (e) {
      setError(e.message || 'Unable to load printer settings.');
    }
  };

  useEffect(()=>{ load(); },[propertyId]);

  const openNew = () => {
    setError('');
    setNotice('');
    setEditing({...blank,assignmentTypes:[]});
  };

  const openEdit = (printer) => {
    setError('');
    setNotice('');
    setEditing({
      ...printer,
      connection_type:'network_ip',
      port:printer.port || 9100,
      assignmentTypes:assignments.filter(a=>a.printer_id===printer.id).map(a=>a.assignment_type)
    });
  };

  const save = async () => {
    if (!editing?.name?.trim()) return setError('Printer name is required.');
    if (!editing.ip_address?.trim()) return setError('Printer IP address is required.');
    const port = Number(editing.port || 9100);
    if (!Number.isInteger(port) || ![9100,9101,9102].includes(port)) {
      return setError('Thermal printers must use TCP port 9100, 9101 or 9102.');
    }

    setError('');
    setNotice('');

    const {assignmentTypes=[],...printerFields} = editing;
    const payload = {
      ...printerFields,
      property_id:propertyId,
      connection_type:'network_ip',
      port,
      is_online:false,
      last_status:'disconnected',
      last_error:null
    };

    const result = editing.id
      ? await supabase.from('property_printers').update(payload).eq('id',editing.id).eq('property_id',propertyId).select().single()
      : await supabase.from('property_printers').insert(payload).select().single();

    if (result.error) return setError(result.error.message);

    const printerId = result.data.id;
    const deleted = await supabase.from('printer_assignments').delete().eq('printer_id',printerId).eq('property_id',propertyId);
    if (deleted.error) return setError(deleted.error.message);

    if (assignmentTypes.length) {
      const inserted = await supabase.from('printer_assignments').insert(
        assignmentTypes.map(type=>({property_id:propertyId,printer_id:printerId,assignment_type:type}))
      );
      if (inserted.error) return setError(inserted.error.message);
    }

    setEditing(null);
    await load();

    setTestingId(printerId);
    const test = await testPrint(result.data,propertyId);
    setTestingId(null);
    await load();

    if (test.ok) {
      setNotice('Printer connected successfully. A real test ticket was sent directly to the thermal printer.');
    } else {
      setError(test.friendlyError || 'Printer connection failed. The printer remains offline.');
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this printer?')) return;
    const result = await supabase.from('property_printers').delete().eq('id',id).eq('property_id',propertyId);
    if (result.error) setError(result.error.message);
    await load();
  };

  const toggleAssignment = async (printerId,type) => {
    const exists = assignments.find(a=>a.printer_id===printerId&&a.assignment_type===type);
    const result = exists
      ? await supabase.from('printer_assignments').delete().eq('id',exists.id)
      : await supabase.from('printer_assignments').insert({property_id:propertyId,printer_id:printerId,assignment_type:type});
    if (result.error) setError(result.error.message);
    await load();
  };

  const assigned = type => assignments.filter(a=>a.assignment_type===type);
  const assignmentText = type =>
    assigned(type).map(a=>printers.find(p=>p.id===a.printer_id)?.name).filter(Boolean).join(' + ') || 'Not assigned';

  return (
    <div className="min-h-full bg-[#F6F7F8] p-5">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-950">Printers</h2>
          <p className="text-sm text-slate-500">Direct network thermal printing. No Windows print dialog, browser printer or tablet printer is used.</p>
        </div>
        <button onClick={openNew} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-amber-300">
          <Plus size={16}/>Add Printer
        </button>
      </div>

      {error && <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{notice}</div>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section className="space-y-3">
          {printers.map(p=>{
            const connected = p.is_online && p.last_status === 'connected';
            return (
              <div key={p.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3">
                    <div className="rounded-xl bg-slate-100 p-2.5"><Printer size={18}/></div>
                    <div>
                      <div className="font-black">{p.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="rounded-full bg-slate-100 px-2 py-1">{p.type}</span>
                        <span className="inline-flex items-center gap-1"><Wifi size={12}/>{p.ip_address}:{p.port || 9100}</span>
                      </div>
                      {p.last_error && !connected && <div className="mt-2 max-w-md text-xs font-semibold text-red-600">{p.last_error}</div>}
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${connected?'bg-emerald-50 text-emerald-700':'bg-red-50 text-red-700'}`}>
                    <span className={`h-2 w-2 rounded-full ${connected?'bg-emerald-500':'bg-red-500'}`}/>
                    {connected?'Connected':'Offline'}
                  </span>
                </div>

                <div className="mt-3 flex gap-2">
                  <button disabled={testingId===p.id} onClick={async()=>{
                    setError('');setNotice('');setTestingId(p.id);
                    const result=await testPrint(p,propertyId);
                    setTestingId(null);await load();
                    if(result.ok)setNotice(`Direct connection verified and test ticket sent to ${p.name}.`);
                    else setError(result.friendlyError||'Printer is offline or unreachable.');
                  }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold disabled:opacity-50">
                    <Play size={12} className="mr-1 inline"/>{testingId===p.id?'Testing…':'Test Connection & Print'}
                  </button>
                  <button onClick={()=>openEdit(p)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold"><Pencil size={12} className="mr-1 inline"/>Edit</button>
                  <button onClick={()=>remove(p.id)} className="rounded-lg border border-red-100 px-3 py-1.5 text-xs font-bold text-red-600"><Trash2 size={12} className="mr-1 inline"/>Delete</button>
                </div>
              </div>
            );
          })}
          {!printers.length && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No printers configured yet.</div>}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3">
            <h3 className="font-black">Assignment Matrix</h3>
            <p className="text-xs text-slate-500">Assignments route jobs to physical printers. A printer must be connected before a job is sent.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-slate-500">
                <tr><th className="p-3">Order Type</th><th className="p-3">Assigned Printers</th><th className="p-3">Action</th></tr>
              </thead>
              <tbody>
                {ASSIGNMENTS.map(([type,label])=><tr key={type} className="border-b last:border-0">
                  <td className="p-3 font-bold">{label}</td>
                  <td className="p-3">{assignmentText(type)}</td>
                  <td className="p-3">
                    <select className="rounded-lg border border-slate-200 bg-white p-2 text-xs" value="" onChange={e=>{if(e.target.value)toggleAssignment(e.target.value,type)}}>
                      <option value="">Assign printer…</option>
                      {printers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {editing && <PrinterModal form={editing} setForm={setEditing} onClose={()=>setEditing(null)} onSave={save}/>}
    </div>
  );
}

function PrinterModal({form,setForm,onClose,onSave}) {
  const selected=form.assignmentTypes||[];
  const toggle=type=>setForm({...form,assignmentTypes:selected.includes(type)?selected.filter(x=>x!==type):[...selected,type]});

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div><h3 className="text-lg font-black">{form.id?'Edit':'Add'} Printer</h3><p className="text-xs text-slate-500">The platform connects to the printer over TCP; Windows printing is not used.</p></div>
          <button onClick={onClose}><X size={18}/></button>
        </div>
        <div className="grid gap-3">
          <label className="text-sm font-bold">Printer Name<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className="mt-1 w-full rounded-xl border p-2.5"/></label>
          <label className="text-sm font-bold">Type<select value={form.type} onChange={e=>setForm({...form,type:e.target.value})} className="mt-1 w-full rounded-xl border p-2.5">{TYPES.map(x=><option key={x[0]} value={x[0]}>{x[1]}</option>)}</select></label>
          <label className="text-sm font-bold">Connection<select value="network_ip" disabled className="mt-1 w-full rounded-xl border bg-slate-50 p-2.5">{CONNECTIONS.map(x=><option key={x[0]} value={x[0]}>{x[1]}</option>)}</select></label>
          <label className="text-sm font-bold">Printer IP Address<input value={form.ip_address||''} onChange={e=>setForm({...form,ip_address:e.target.value})} placeholder="192.168.1.50" className="mt-1 w-full rounded-xl border p-2.5 font-mono"/></label>
          <label className="text-sm font-bold">TCP Port<input type="number" value={form.port||9100} onChange={e=>setForm({...form,port:e.target.value})} className="mt-1 w-full rounded-xl border p-2.5 font-mono"/><span className="mt-1 block text-xs font-normal text-slate-500">Use 9100 for most ESC/POS Ethernet/Wi-Fi thermal printers.</span></label>
          <label className="text-sm font-bold">Paper Width<select value={form.paper_width||'80mm'} onChange={e=>setForm({...form,paper_width:e.target.value})} className="mt-1 w-full rounded-xl border p-2.5"><option>80mm</option><option>58mm</option></select></label>
          <div>
            <div className="mb-2 text-sm font-bold">Assign to</div>
            <div className="mb-2 text-xs text-slate-500">After saving, OliTechs immediately verifies the connection and sends a real test ticket.</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {ASSIGNMENTS.map(([type,label])=><label key={type} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(type)} onChange={()=>toggle(type)}/><span>{label}</span></label>)}
            </div>
          </div>
          <button onClick={onSave} className="mt-2 rounded-xl bg-slate-950 px-4 py-3 font-black text-amber-300">Save, Connect & Test Print</button>
        </div>
      </div>
    </div>
  );
}
