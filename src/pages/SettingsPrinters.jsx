import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Printer, Wifi, Play, X, RefreshCw, CheckCircle2, AlertCircle, CircleOff, Network, ChevronRight } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getPrinters, getAssignments, testPrint, connectPrinter, printTestOrder, printTestReceipt, printCutCalibrationTest } from '@/services/printService';
import { getPrinterPrintSettings, savePrinterPrintSettings } from '@/services/printerPrintSettings';
import { supabase } from '@/lib/supabaseClient';

const normalizeNetworkEndpoint = (value, fallbackPort = 9100) => {
  let host = String(value || '').trim();
  let port = Number(fallbackPort || 9100);
  try {
    if (/^https?:\/\//i.test(host)) {
      const parsed = new URL(host);
      host = parsed.hostname;
      if (parsed.port) port = Number(parsed.port);
    } else if (/^[0-9.]+:\d+$/.test(host)) {
      const parts = host.split(':');
      host = parts[0];
      port = Number(parts[1]);
    }
  } catch (_) {}
  return { host, port };
};

const normalizeAgentUrl = (value = 'http://127.0.0.1:8631') => {
  let base = String(value || '').trim().replace(/\/+$/, '');
  if (!base) base = 'http://127.0.0.1:8631';
  base = base.replace(/\/(?:api|print-agent)$/i, '');
  return base.replace(/\/+$/, '');
};

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
  character_width:null,
  feedLinesBeforeCut:2,
  feedDotsBeforeCut:100,
  cutCommand:'gs_v_66',
  extraFeedAfterCut:0,
  is_online:false,
  is_default:false,
  last_status:'disconnected',
  open_drawer_after_sale:false,
};

const statusMeta = printer => {
  if (printer?.is_online && printer?.last_status === 'connected') {
    return {label:'Connected', Icon:CheckCircle2, cls:'bg-[var(--success-soft)] text-[var(--success-text)] border-[var(--success)]', dot:'bg-[var(--success)]'};
  }
  if (printer?.last_status === 'testing') {
    return {label:'Testing…', Icon:RefreshCw, cls:'bg-[var(--warning-soft)] text-[var(--warning-text)] border-[var(--warning)]', dot:'bg-[var(--warning)]'};
  }
  if (printer?.last_status === 'failed' || printer?.last_status === 'offline') {
    return {label:'Offline', Icon:AlertCircle, cls:'bg-[var(--danger-soft)] text-[var(--danger-text)] border-[var(--danger)]', dot:'bg-[var(--danger)]'};
  }
  return {label:'Not verified', Icon:CircleOff, cls:'bg-secondary text-muted-foreground border-border', dot:'bg-[var(--text-muted)]'};
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
  const [discovering,setDiscovering] = useState(false);
  const [discovered,setDiscovered] = useState([]);
  const [agentError,setAgentError] = useState('');
  const [windowsPrinters,setWindowsPrinters] = useState([]);
  const [templateTests,setTemplateTests] = useState({});

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

  const refreshLocalDevices = async (agentUrl='http://127.0.0.1:8631') => {
    setAgentError('');
    try {
      const base=normalizeAgentUrl(agentUrl);
      const paths=['/health','/api/health','/print-agent/health'];
      let healthy=false;
      for (const path of paths) {
        try {
          const response=await fetch(base+path,{cache:'no-store'});
          const data=await response.json().catch(()=>({}));
          if(response.ok && data.ok){ healthy=true; break; }
        } catch (_) {}
      }
      if(!healthy){
        setWindowsPrinters([]);
        setAgentError('OliTechs Print Agent is not running on this POS computer. Start it with npm run print-agent, then refresh.');
        return;
      }
      const response=await fetch(base+'/windows-printers');
      const data=await response.json().catch(()=>({}));
      if (response.ok && data.ok) setWindowsPrinters(data.printers || []);
      else setWindowsPrinters([]);
    } catch (_) {
      setWindowsPrinters([]);
      setAgentError('OliTechs Print Agent is not reachable on this POS computer.');
    }
  };

  const discoverNetwork = async () => {
    setDiscovering(true); setAgentError(''); setError('');
    try {
      const base=normalizeAgentUrl(editing?.agent_url);
      const response=await fetch(`${base}/discover`);
      const data=await response.json().catch(()=>({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Network discovery failed.');
      setDiscovered(data.printers || []);
      if (!(data.printers || []).length) setNotice('No raw ESC/POS printer ports were found on this workstation LAN. You can still add the printer manually.');
    } catch (e) {
      setAgentError(e?.message || 'Start the OliTechs Print Agent to discover local printers.');
    } finally { setDiscovering(false); }
  };

  const openNew = () => {
    setError(''); setNotice('');
    setEditing({...blank,assignmentTypes:[]});
    setDiscovered([]);
    refreshLocalDevices();
  };

  const openEdit = printer => {
    setError(''); setNotice('');
    setEditing({
      ...printer,
      ...getPrinterPrintSettings(printer),
      connection_type:printer.connection_type || 'network_ip',
      port:printer.port || 9100,
      windows_printer_name:printer.windows_printer_name || '',
      agent_url:printer.agent_url || 'http://127.0.0.1:8631',
      baud_rate:printer.baud_rate || 9600,
      device_name:printer.device_name || '',
      device_address:printer.device_address || '',
      character_width:printer.character_width ?? null,
      assignmentTypes:assignments.filter(a=>a.printer_id===printer.id).map(a=>a.assignment_type),
    });
  };

  const save = async () => {
    if (!editing?.name?.trim()) return setError('Printer name is required.');
    const type = editing.connection_type || 'network_ip';
    const port = Number(editing.port || 9100);
    if (type === 'network_ip') {
      if (!editing.ip_address?.trim()) return setError('Enter the printer IPv4 address.');
      if (!Number.isInteger(port) || ![9100,9101,9102].includes(port)) return setError('Use TCP port 9100, 9101 or 9102.');
    }
    if (type === 'windows_printer' && !editing.windows_printer_name?.trim()) return setError('Enter the Windows installed printer name.');
    if (type === 'serial' && ![9600,19200,38400,57600,115200].includes(Number(editing.baud_rate || 9600))) return setError('Select a supported serial baud rate.');
    const characterWidth = editing.character_width === '' || editing.character_width == null ? null : Number(editing.character_width);
    if (Number(editing.feedLinesBeforeCut ?? 2) < 2 || Number(editing.feedLinesBeforeCut ?? 2) > 255) return setError('Feed lines before cut must be between 2 and 255.');
    if (Number(editing.feedDotsBeforeCut ?? 100) < 0 || Number(editing.feedDotsBeforeCut ?? 100) > 255) return setError('Feed dots before cut must be between 0 and 255.');
    if (Number(editing.extraFeedAfterCut ?? 0) < 0 || Number(editing.extraFeedAfterCut ?? 0) > 255) return setError('Extra feed after cut must be between 0 and 255.');
    if (characterWidth != null && (!Number.isInteger(characterWidth) || characterWidth < 24 || characterWidth > 64)) return setError('Character override must be a whole number from 24 to 64.');

    setError(''); setNotice('');
    const {assignmentTypes=[],feedLinesBeforeCut=2,feedDotsBeforeCut=100,cutCommand='gs_v_66',extraFeedAfterCut=0,paperWidth:ignoredPaperWidth,...printerFields} = editing;
    const endpoint = type === 'network_ip'
      ? normalizeNetworkEndpoint(printerFields.ip_address, port)
      : { host: printerFields.ip_address || '', port };
    if (type === 'network_ip' && !endpoint.host) return setError('Enter the printer IPv4 address.');
    const payload = {
      ...printerFields,
      character_width: characterWidth,
      ip_address: endpoint.host,
      property_id:propertyId,
      connection_type:type,
      port:endpoint.port,
      is_online:false,
      last_status:'testing',
      last_error:null,
    };

    const result = editing.id
      ? await supabase.from('property_printers').update(payload).eq('id',editing.id).eq('property_id',propertyId).select().single()
      : await supabase.from('property_printers').insert(payload).select().single();

    if (result.error) return setError(result.error.message);

    const printerId=result.data.id;
    savePrinterPrintSettings(printerId, { feedLinesBeforeCut:Number(feedLinesBeforeCut), feedDotsBeforeCut:Number(feedDotsBeforeCut), cutCommand, extraFeedAfterCut:Number(extraFeedAfterCut), paperWidth:result.data.paper_width || editing.paper_width || '80mm' });
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

  const runCutCalibration = async () => {
    if (!editing) return;
    setError(''); setNotice('');
    const result = await printCutCalibrationTest(editing, null, editing);
    if (result?.ok) setNotice('Calibration ticket sent. Check all five numbered lines, adjust feed dots, then save the printer settings.');
    else setError(result?.friendlyError || 'Cut calibration test failed.');
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

  const runTemplateTest = async (printer, kind, options = {}) => {
    const key = printer.id + ':' + kind;
    setTemplateTests(prev => ({ ...prev, [key]: { pending: true, text: 'Sending test print…' } }));
    try {
      const result = kind === 'order'
        ? await printTestOrder(printer, assignments.filter(item => item.printer_id === printer.id).map(item => item.assignment_type), propertyId)
        : await printTestReceipt(printer, propertyId, options);
      setTemplateTests(prev => ({
        ...prev,
        [key]: {
          pending: false,
          ok: !!result?.ok,
          text: result?.ok ? 'Test template sent to printer.' : (result?.friendlyError || 'Test print failed.'),
        },
      }));
    } catch (error) {
      setTemplateTests(prev => ({ ...prev, [key]: { pending: false, ok: false, text: error?.message || 'Test print failed.' } }));
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
      <div className="border-b border-border bg-surface">
        <div className="mx-auto max-w-7xl px-5 py-5 lg:px-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                <Network size={14}/> Property Operations / Printing
              </div>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-foreground">Printer Management</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Manage physical thermal printers from OliTechs. Use automatic LAN discovery, Windows-installed drivers, USB, Bluetooth, or serial/COM devices. Every connection must pass a real hardware test before it is marked Connected.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={discoverNetwork} disabled={discovering} className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm font-bold text-foreground hover:bg-secondary disabled:opacity-50"><Network size={15}/>{discovering?'Scanning LAN…':'Find network printers'}</button>
              <button onClick={()=>load()} className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm font-bold text-foreground hover:bg-secondary"><RefreshCw size={15}/>Refresh</button>
              <button onClick={openNew} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-black text-primary-foreground shadow-sm hover:bg-[var(--primary-hover)]"><Plus size={16}/>Add Printer</button>
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
{agentError && <Alert type="error" text={agentError}/>}
{!!discovered.length && <div className="rounded-2xl border border-[var(--primary)] bg-primary-soft p-4"><div className="text-xs font-black uppercase tracking-wide text-primary-text">Network printers discovered</div><div className="mt-2 flex flex-wrap gap-2">{discovered.map(d=><button key={`${d.host}:${d.port}`} onClick={()=>{setEditing({...blank,connection_type:'network_ip',ip_address:d.host,port:d.port,assignmentTypes:[]});setDiscovered([]);}} className="rounded-xl border border-[var(--primary)] bg-surface px-3 py-2 text-xs font-bold text-primary-text hover:bg-primary-soft">{d.label}</button>)}</div></div>}
        {notice && <Alert type="success" text={notice}/>}
        {loading ? <div className="rounded-2xl border border-border bg-surface p-10 text-center text-sm text-muted-foreground">Loading printer configuration…</div> :
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]">
            <section>
              <div className="mb-3 flex items-end justify-between">
                <div><h2 className="text-sm font-black uppercase tracking-wide text-foreground">Physical Printers</h2><p className="mt-1 text-xs text-muted-foreground">Only a verified connection is shown as Connected.</p></div>
              </div>
              <div className="space-y-3">
                {printers.map(p=><PrinterCard key={p.id} printer={p} assignments={assignments.filter(a=>a.printer_id===p.id)} testing={testingId===p.id} onTest={()=>verify(p.id)} onTestOrder={()=>runTemplateTest(p,'order')} onTestReceipt={(vatMode,longReceipt)=>runTemplateTest(p,'receipt',{vatMode,longReceipt})} orderTest={templateTests[p.id+':order']} receiptTest={templateTests[p.id+':receipt']} onEdit={()=>openEdit(p)} onDelete={()=>remove(p.id)} onRemoveAssignment={removeAssignment}/>)}
                {!printers.length && <Empty onAdd={openNew}/>}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-surface shadow-sm">
              <div className="border-b border-border p-5">
                <h2 className="font-black text-foreground">Print Routing</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose where each operational job goes. One job can be routed to multiple physical printers.</p>
              </div>
              <div className="divide-y divide-border">
                {Object.entries(grouped).map(([group,rows])=><div key={group} className="p-5">
                  <div className="mb-3 text-[11px] font-black uppercase tracking-wider text-muted-foreground">{group}</div>
                  <div className="space-y-3">
                    {rows.map(([type,label])=>{
                      const current=assignments.filter(a=>a.assignment_type===type);
                      return <div key={type} className="rounded-xl border border-border bg-secondary/70 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div><div className="text-sm font-bold text-foreground">{label}</div><div className="mt-0.5 text-[11px] text-muted-foreground">{current.length ? `${current.length} printer${current.length===1?'':'s'} assigned` : 'No printer assigned'}</div></div>
                          <select value="" onChange={e=>addAssignment(e.target.value,type)} className="max-w-[150px] rounded-lg border border-border bg-surface px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                            <option value="">Add printer</option>
                            {printers.filter(p=>!current.some(a=>a.printer_id===p.id)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {current.map(a=>{const p=printers.find(x=>x.id===a.printer_id); return <span key={a.id} className="inline-flex items-center gap-1 rounded-lg bg-surface px-2 py-1 text-xs font-semibold text-muted-foreground shadow-sm ring-1 ring-border">{p?.name || 'Unknown printer'}<button onClick={()=>removeAssignment(a)} className="rounded p-0.5 text-muted-foreground hover:bg-[var(--danger-soft)] hover:text-[var(--danger-text)]" title="Remove routing"><X size={12}/></button></span>})}
                        </div>
                      </div>;
                    })}
                  </div>
                </div>)}
              </div>
            </section>
          </div>}
      </div>

      {editing && <PrinterModal form={editing} setForm={setEditing} onClose={()=>setEditing(null)} onSave={save} onCalibration={runCutCalibration} windowsPrinters={windowsPrinters} refreshLocalDevices={refreshLocalDevices}/>} 
    </div>
  );
}

function Stat({label,value,icon:Icon,className=''}) {
  return <div className={`flex items-center gap-3 rounded-xl border border-border bg-surface p-3.5 ${className}`}><div className="rounded-lg bg-secondary p-2 text-foreground"><Icon size={15}/></div><div><div className="text-lg font-black text-foreground">{value}</div><div className="text-[11px] font-semibold text-muted-foreground">{label}</div></div></div>;
}

function Alert({type,text}) {
  return <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm font-semibold ${type==='error'?'border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger-text)]':'border-[var(--success)] bg-[var(--success-soft)] text-[var(--success-text)]'}`}>{type==='error'?<AlertCircle size={17}/>:<CheckCircle2 size={17}/>}<span>{text}</span></div>;
}

function PrinterCard({printer,assignments,testing,onTest,onTestOrder,onTestReceipt,orderTest,receiptTest,onEdit,onDelete,onRemoveAssignment}) {
  const [receiptVatMode, setReceiptVatMode] = useState('off');
  const [longReceipt, setLongReceipt] = useState(false);
  const meta=statusMeta(printer);
  const Icon=meta.Icon;
  return <article className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 gap-3">
        <div className="rounded-xl bg-primary p-3 text-primary-foreground"><Printer size={19}/></div>
        <div className="min-w-0">
          <h3 className="truncate font-black text-foreground">{printer.name}</h3>
          <div className="mt-1 text-xs font-semibold text-muted-foreground">{TYPES.find(x=>x[0]===printer.type)?.[1] || printer.type}</div>
        </div>
      </div>
      <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${meta.cls}`}><span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`}/><Icon size={12}/>{meta.label}</span>
    </div>

    <div className="mt-4 grid grid-cols-2 gap-2">
      {printer.connection_type === 'network_ip' && <>
        <div className="rounded-xl bg-secondary p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Network</div><div className="mt-1 font-mono text-xs font-bold text-foreground">{printer.ip_address || 'IP not set'}</div></div>
        <div className="rounded-xl bg-secondary p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">TCP Port</div><div className="mt-1 font-mono text-xs font-bold text-foreground">{printer.port || 9100}</div></div>
      </>}
      {printer.connection_type === 'windows_printer' && <>
        <div className="col-span-2 rounded-xl bg-secondary p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Windows printer</div><div className="mt-1 text-xs font-bold text-foreground">{printer.windows_printer_name || 'Printer not selected'}</div></div>
      </>}
      {printer.connection_type === 'usb' && <div className="col-span-2 rounded-xl bg-secondary p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Transport</div><div className="mt-1 text-xs font-bold text-foreground">Direct USB / WebUSB</div></div>}
      {printer.connection_type === 'bluetooth' && <div className="col-span-2 rounded-xl bg-secondary p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Transport</div><div className="mt-1 text-xs font-bold text-foreground">Bluetooth / Web Bluetooth</div></div>}
      {printer.connection_type === 'serial' && <div className="col-span-2 rounded-xl bg-secondary p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Serial</div><div className="mt-1 text-xs font-bold text-foreground">{printer.baud_rate || 9600} baud</div></div>}
    </div>

    {printer.last_error && <div className="mt-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-xs font-semibold leading-5 text-[var(--danger-text)]">{printer.last_error}</div>}

    <div className="mt-3 flex flex-wrap gap-1.5">
      {assignments.length ? assignments.map(a=><span key={a.id} className="rounded-md bg-secondary px-2 py-1 text-[10px] font-bold text-muted-foreground">{ASSIGNMENTS.find(x=>x[0]===a.assignment_type)?.[1] || a.assignment_type}</span>) : <span className="text-[11px] text-muted-foreground">No routing assigned</span>}
    </div>

    <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
      <button disabled={testing} onClick={onTest} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-black text-primary-foreground disabled:opacity-50"><Play size={13}/>{testing?'Testing…':'Test Connection'}</button>
      <button disabled={orderTest?.pending} onClick={onTestOrder} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-bold text-foreground disabled:opacity-50"><Printer size={13}/>{orderTest?.pending?'Printing…':'Test Print – Order'}</button>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/60 p-2">
        <select aria-label="Receipt VAT test mode" value={receiptVatMode} onChange={e=>setReceiptVatMode(e.target.value)} className="rounded-md border border-border bg-surface px-2 py-1.5 text-[11px] font-bold text-foreground">
          <option value="off">VAT off</option><option value="exclusive">VAT on - exclusive</option><option value="inclusive">VAT on - inclusive</option>
        </select>
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground"><input type="checkbox" checked={longReceipt} onChange={e=>setLongReceipt(e.target.checked)} className="h-3.5 w-3.5"/>12-item sample</label>
      </div>
      <button disabled={receiptTest?.pending} onClick={()=>onTestReceipt(receiptVatMode,longReceipt)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-bold text-foreground disabled:opacity-50"><Printer size={13}/>{receiptTest?.pending?'Printing…' :'Test Print – Receipt'}</button>
      <button onClick={onEdit} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-bold text-foreground hover:bg-secondary"><Pencil size={13}/>Edit</button>
      <button onClick={onDelete} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--danger)] px-3 py-2 text-xs font-bold text-[var(--danger-text)] hover:bg-[var(--danger-soft)]"><Trash2 size={13}/>Delete</button>
      {printer.last_tested_at && <span className="ml-auto self-center text-[10px] text-muted-foreground">Tested {new Date(printer.last_tested_at).toLocaleString('en-KE')}</span>}
    </div>
    {(orderTest && !orderTest.pending || receiptTest && !receiptTest.pending) && <div className="mt-3 space-y-1 text-[11px] font-semibold">
      {orderTest && !orderTest.pending && <div className={orderTest.ok?'text-[var(--success-text)]':'text-[var(--danger-text)]'}>Order test: {orderTest.text}</div>}
      {receiptTest && !receiptTest.pending && <div className={receiptTest.ok?'text-[var(--success-text)]':'text-[var(--danger-text)]'}>Receipt test: {receiptTest.text}</div>}
    </div>}
  </article>;
}

function Empty({onAdd}) {
  return <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary"><Printer size={20} className="text-muted-foreground"/></div><h3 className="mt-3 font-black text-foreground">No printers configured</h3><p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Add a network thermal printer with its LAN IP. OliTechs will verify the connection and print a test ticket before marking it connected.</p><button onClick={onAdd} className="mt-4 rounded-xl bg-primary px-4 py-2.5 text-sm font-black text-primary-foreground">Add your first printer</button></div>;
}

function PrinterModal({form,setForm,onClose,onSave,onCalibration,windowsPrinters=[],refreshLocalDevices=()=>{}}) {
  const selected=form.assignmentTypes||[];
  const toggle=type=>setForm({...form,assignmentTypes:selected.includes(type)?selected.filter(x=>x!==type):[...selected,type]});
  return <div className="fixed inset-0 z-[80] overflow-y-auto bg-foreground/55 p-4 backdrop-blur-sm">
    <div className="mx-auto my-6 w-full max-w-2xl overflow-hidden rounded-3xl bg-surface shadow-2xl">
      <div className="flex items-start justify-between border-b border-border p-5">
        <div><div className="flex items-center gap-2"><div className="rounded-lg bg-primary p-2 text-primary-foreground"><Printer size={16}/></div><h3 className="text-lg font-black text-foreground">{form.id?'Edit printer':'Add printer'}</h3></div><p className="mt-2 text-xs leading-5 text-muted-foreground">LAN and Windows-driver printers use the OliTechs Local Print Agent. USB, Bluetooth and serial printers use browser device APIs. Every connection is tested before it is marked Connected.</p></div>
        <button onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><X size={18}/></button>
      </div>
      <div className="grid gap-5 p-5 md:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-xs font-black uppercase tracking-wide text-muted-foreground">Printer name<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Kitchen Epson 01" className="mt-1.5 w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)]"/></label>
          <label className="block text-xs font-black uppercase tracking-wide text-muted-foreground">Printer type<select value={form.type} onChange={e=>setForm({...form,type:e.target.value})} className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm">{TYPES.map(x=><option key={x[0]} value={x[0]}>{x[1]}</option>)}</select></label>
          <label className="block text-xs font-black uppercase tracking-wide text-muted-foreground">Connection type
            <select value={form.connection_type || 'network_ip'} onChange={e=>setForm({...form,connection_type:e.target.value})} className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm">
              <option value="network_ip">LAN / Network IP</option>
              <option value="windows_printer">Windows installed printer (USB / Bluetooth driver)</option>
              <option value="usb">USB direct (WebUSB)</option>
              <option value="bluetooth">Bluetooth direct (Web Bluetooth)</option>
              <option value="serial">USB / Bluetooth Serial (COM)</option>
            </select>
          </label>
          <div className="rounded-xl border border-border bg-secondary p-3"><div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Transport</div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">LAN and Windows-driver printers use the OliTechs Print Agent. USB, Bluetooth and serial printers use the browser's native device connection.</p></div>
          {form.connection_type === 'network_ip' && <>
            <label className="block text-xs font-black uppercase tracking-wide text-muted-foreground">Printer IP address<input value={form.ip_address||''} onChange={e=>setForm({...form,ip_address:e.target.value})} placeholder="192.168.1.50" className="mt-1.5 w-full rounded-xl border border-border px-3 py-2.5 font-mono text-sm outline-none focus:border-[var(--primary)]"/></label>
            <label className="block text-xs font-black uppercase tracking-wide text-muted-foreground">TCP port<input type="number" value={form.port||9100} onChange={e=>setForm({...form,port:e.target.value})} className="mt-1.5 w-full rounded-xl border border-border px-3 py-2.5 font-mono text-sm"/><span className="mt-1 block text-[11px] font-normal normal-case tracking-normal text-muted-foreground">9100 is the standard raw ESC/POS port for many network thermal printers.</span></label>
          </>}
          {form.connection_type === 'windows_printer' && <div className="space-y-2"><label className="block text-xs font-black uppercase tracking-wide text-muted-foreground">Windows installed printer<select value={form.windows_printer_name||''} onChange={e=>setForm({...form,windows_printer_name:e.target.value})} onFocus={()=>refreshLocalDevices(form.agent_url)} className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"><option value="">Select installed printer</option>{windowsPrinters.map(p=><option key={p.Name} value={p.Name}>{p.Name}{p.DriverName ? ` — ${p.DriverName}` : ''}</option>)}</select></label><p className="text-[11px] text-muted-foreground">The printer must first be installed and visible in Windows Printers & scanners. OliTechs sends the thermal data through the local print agent.</p></div>}
          {form.connection_type === 'serial' && <label className="block text-xs font-black uppercase tracking-wide text-muted-foreground">Baud rate<select value={form.baud_rate||9600} onChange={e=>setForm({...form,baud_rate:Number(e.target.value)})} className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm">{[9600,19200,38400,57600,115200].map(rate=><option key={rate} value={rate}>{rate} baud</option>)}</select></label>}
          <label className="block text-xs font-black uppercase tracking-wide text-muted-foreground">Paper width<select value={form.paper_width||'80mm'} onChange={e=>setForm({...form,paper_width:e.target.value})} className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"><option>80mm</option><option>58mm</option></select></label>
          <div className="space-y-3 rounded-xl border border-border p-3">
            <div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Thermal feed and cut</div>
            <label className="block text-xs font-black uppercase tracking-wide text-muted-foreground">Blank lines before cut
              <input type="number" min="2" max="255" value={form.feedLinesBeforeCut ?? 2} onChange={e=>setForm({...form,feedLinesBeforeCut:Number(e.target.value)})} className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"/>
            </label>
            <label className="block text-xs font-black uppercase tracking-wide text-muted-foreground">Precise feed before cut (dots)
              <input type="number" min="0" max="255" value={form.feedDotsBeforeCut ?? 100} onChange={e=>setForm({...form,feedDotsBeforeCut:Number(e.target.value)})} className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"/>
            </label>
            <label className="block text-xs font-black uppercase tracking-wide text-muted-foreground">Cut command
              <select value={form.cutCommand || 'gs_v_66'} onChange={e=>setForm({...form,cutCommand:e.target.value})} className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm">
                <option value="gs_v_66">GS V 66 n — feed and partial cut</option>
                <option value="gs_v_1">GS V 1 — partial cut</option>
                <option value="gs_v_0">GS V 0 — full cut</option>
                <option value="esc_i">ESC i — older Xprinter full cut</option>
                <option value="esc_m">ESC m — older Xprinter partial cut</option>
                <option value="none">None — disable cutter</option>
              </select>
            </label>
            <label className="block text-xs font-black uppercase tracking-wide text-muted-foreground">Extra feed after cut (dots)
              <input type="number" min="0" max="255" value={form.extraFeedAfterCut ?? 0} onChange={e=>setForm({...form,extraFeedAfterCut:Number(e.target.value)})} className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"/>
            </label>
            <button type="button" onClick={onCalibration} className="w-full rounded-xl border border-border bg-secondary px-4 py-2.5 text-xs font-black text-foreground">Cut Calibration Test</button>
            <p className="text-[10px] leading-4 text-muted-foreground">Settings are saved per printer on this POS workstation. Start at 100 dots and calibrate with the five numbered lines.</p>
          </div>
          <label className="block text-xs font-black uppercase tracking-wide text-muted-foreground">Characters per line (optional)<input type="number" min="24" max="64" step="1" value={form.character_width ?? ''} onChange={e=>setForm({...form,character_width:e.target.value===''?null:Number(e.target.value)})} placeholder={form.paper_width==='58mm'?'Auto: 32':'Auto: 48'} className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"/><span className="mt-1 block text-[10px] font-normal normal-case tracking-normal text-muted-foreground">Leave blank to use the paper-width default. Set 24–64 to override.</span></label>
          {form.connection_type === 'network_ip' && <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-secondary/60 p-3">
            <input type="checkbox" checked={!!form.open_drawer_after_sale} onChange={e=>setForm({...form,open_drawer_after_sale:e.target.checked})} className="mt-0.5 h-4 w-4"/>
            <span><span className="block text-xs font-black uppercase tracking-wide text-foreground">Open cash drawer after cash sale</span><span className="mt-1 block text-[11px] font-normal normal-case leading-5 tracking-normal text-muted-foreground">Sends an ESC/POS drawer pulse after a completed Cash or cash-containing Split Payment. Requires a drawer connected to this printer's kick port. Disabled by default.</span></span>
          </label>}
        </div>
        <div>
          <div className="mb-2 text-xs font-black uppercase tracking-wide text-muted-foreground">Print routing</div>
          <p className="mb-3 text-xs leading-5 text-muted-foreground">Select every job this physical printer should receive. You can also change routing later without editing the printer.</p>
          <div className="space-y-2">
            {ASSIGNMENTS.map(([type,label,group])=><label key={type} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 hover:bg-secondary"><input type="checkbox" checked={selected.includes(type)} onChange={()=>toggle(type)} className="mt-0.5 h-4 w-4"/><span><span className="block text-sm font-bold text-foreground">{label}</span><span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</span></span></label>)}
          </div>
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-border bg-secondary p-5 sm:flex-row sm:justify-end">
        <button onClick={onClose} className="rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-bold text-foreground">Cancel</button>
        <button onClick={onSave} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-primary-foreground">Save & verify connection</button>
      </div>
    </div>
  </div>;
}
