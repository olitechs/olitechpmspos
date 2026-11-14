import React,{useEffect,useMemo,useState}from'react';
import{X,LockKeyhole,AlertTriangle,RefreshCw,Printer,CheckCircle2}from'lucide-react';
import{toast}from'sonner';
import{useAuth}from'@/lib/AuthContext';
import{authService,getSessionStaff}from'@/services/authService';
import{shiftService}from'@/services/shiftService';
import{getPrinters,getAssignments,printShiftReport,printShiftPreview}from'@/services/printService';
import PinPad from'@/components/auth/PinPad';
import DocumentExportMenu from'@/components/shared/DocumentExportMenu';
import{buildShiftReportDefinition}from'@/services/reportDefinitions';

const money=n=>Number(n||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
const managerRoles = new Set(['hotel_admin','super_admin','fb_manager','owner','admin','manager','property_manager','general_manager']);
export function OpenShiftModal({ propertyId, onOpened }) {
  const [cash, setCash] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const staff = getSessionStaff();
  const openingFloat = Number(cash);
  const validFloat = cash.trim() !== '' && Number.isFinite(openingFloat) && openingFloat > 0;

  const open = async () => {
    if (!validFloat) {
      setError('Enter a starting cash float greater than zero before opening the shift.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const shift = await shiftService.openShift({ propertyId, openingCash: openingFloat, notes });
      onOpened?.(shift);
    } catch (e) {
      setError(e.message || 'Unable to open shift.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[270] flex items-center justify-center bg-[var(--overlay-scrim)] p-4">
      <div className="w-full max-w-md rounded-3xl bg-[var(--surface)] p-6 shadow-2xl">
        <div className="text-xl font-medium">Open Shift</div>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Enter the cash float placed in the drawer before taking payments.</p>
        <div className="mt-5 space-y-3">
          <div>
            <label htmlFor="pos-opening-float" className="text-xs font-medium text-[var(--text-muted)]">Opening Cash Float (KES) <span aria-hidden="true">*</span></label>
            <input id="pos-opening-float" autoFocus required value={cash} onChange={e => setCash(e.target.value)} type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="5000.00" aria-invalid={cash !== '' && !validFloat} className="mt-1 w-full rounded-xl border border-[var(--border)] p-3 text-lg font-medium" />
            <p className="mt-1 text-xs text-[var(--text-muted)]">A positive starting float is required. Zero and blank amounts are not accepted.</p>
          </div>
          <div className="rounded-xl bg-[var(--canvas)] p-3 text-xs"><b>Cashier:</b> {staff?.full_name || 'Current staff'}<br /><b>Date:</b> {new Date().toLocaleDateString('en-KE')}</div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opening notes (optional)" className="min-h-20 w-full rounded-xl border border-[var(--border)] p-3 text-sm" />
          {error && <div role="alert" className="rounded-xl bg-[var(--danger-soft)] p-3 text-sm font-medium text-[var(--danger-text)]">{error}</div>}
          <button disabled={busy || !validFloat} onClick={open} className="w-full rounded-xl bg-[var(--primary)] p-3.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40">{busy ? 'Opening…' : 'Open Shift'}</button>
        </div>
      </div>
    </div>
  );
}

export default function CloseShiftModal({shift,onClosed,onClose}){
 const{user}=useAuth();const propertyId=user?.property?.id;const[report,setReport]=useState(null);const[openTables,setOpenTables]=useState([]);const[tablesLoaded,setTablesLoaded]=useState(false);const[tableLoadError,setTableLoadError]=useState('');const[counted,setCounted]=useState('');const[notes,setNotes]=useState('');const[busy,setBusy]=useState(false);const[error,setError]=useState('');const[pinOpen,setPinOpen]=useState(false);const[pinError,setPinError]=useState('');const[reportLoading,setReportLoading]=useState(true);const[refreshToken,setRefreshToken]=useState(0);const[closedReport,setClosedReport]=useState(null);const[printing,setPrinting]=useState(false);const[previewPrinting,setPreviewPrinting]=useState(false);const[printStatus,setPrintStatus]=useState('pending');
 const staff=getSessionStaff();const canApproveWithoutStaffPin=Boolean(user?.isPlatformOwner||['owner','admin','manager'].includes(String(user?.propertyRole||'').toLowerCase())||['hotel_admin','super_admin'].includes(String(user?.staff?.role||'').toLowerCase()));const[managerApproved,setManagerApproved]=useState(false);
 
 useEffect(()=>{if(!shift)return;let active=true;setReportLoading(true);setTablesLoaded(false);setError('');setTableLoadError('');shiftService.getShiftReport(shift.id).then(data=>{if(active)setReport(data);}).catch(e=>{if(active)setError(e.message||'Could not load the shift summary.');}).finally(()=>{if(active)setReportLoading(false);});shiftService.getOpenTables(propertyId).then(rows=>{if(active)setOpenTables(rows);}).catch(e=>{if(active)setTableLoadError(e.message||'Could not verify open tables.');}).finally(()=>{if(active)setTablesLoaded(true);});return()=>{active=false;};},[shift?.id,propertyId,refreshToken]);
 const variance=useMemo(()=>report?Number(counted||0)-Number(report.expectedCash||0):0,[counted,report]);
 const propertyName=user?.property?.business_name||user?.property?.name||'OliTechs';const generatedBy=user?.full_name||staff?.full_name||user?.email||'Authorized staff';const shiftExportDefinition=useMemo(()=>report?buildShiftReportDefinition({...report,countedCash:counted.trim()===''?report.countedCash:Number(counted),variance:counted.trim()===''?report.variance:variance},{propertyName,generatedBy}):null,[report,counted,variance,propertyName,generatedBy]);
 const finishClosed=()=>{if(!closedReport)return;onClosed?.(closedReport);};
 const sendClosedReport=async(reportData)=>{setPrinting(true);setPrintStatus('printing');try{const[printers,assignments]=await Promise.all([getPrinters(propertyId),getAssignments(propertyId)]);const targets=assignments.filter(a=>a.assignment_type==='shift_reports'||a.assignment_type==='reports').map(a=>printers.find(p=>p.id===a.printer_id)).filter(Boolean);const printer=targets[0];if(!printer){setPrintStatus('unassigned');toast.warning('Shift closed. Assign a printer to Shift Closing Reports to print the report.');return;}const result=await printShiftReport(reportData,printer);if(result.outcome==='already_printed'){setPrintStatus('printed');toast.success('Shift closed. Both report copies were already printed.');}else if(result.outcome==='uncertain'){setPrintStatus('uncertain');toast.warning('Shift closed. The report may already have printed — check the paper before retrying.');}else if(!result.ok){setPrintStatus('failed');toast.warning('Shift closed, but one or more report copies failed. You can retry printing.');}else{setPrintStatus('printed');toast.success('Shift closed and report sent to the assigned printer.');}}catch(e){setPrintStatus('failed');toast.error(e.message||'Shift closed, but report printing failed.');}finally{setPrinting(false);}};
 const printClosedReport=async()=>{if(!closedReport)return;await sendClosedReport(closedReport);};
 const printOpenShiftSummary=async()=>{if(!report)return;setPreviewPrinting(true);try{const[printers,assignments]=await Promise.all([getPrinters(propertyId),getAssignments(propertyId)]);const targets=assignments.filter(a=>a.assignment_type==='shift_reports'||a.assignment_type==='reports').map(a=>printers.find(p=>p.id===a.printer_id)).filter(Boolean);const printer=targets[0];if(!printer){toast.warning('No printer is assigned to Shift Closing Reports.');return;}const data={...report,propertyId,propertyName,settings:report.settings||{property_name:propertyName}};const result=await printShiftPreview(data,printer);if(result.outcome==='uncertain')toast.warning('The live shift summary may have printed — check the paper before printing it again.');else if(!result.ok)toast.error(result.friendlyError||'The live shift summary could not be printed.');else toast.success('Live shift summary sent to the assigned printer.');}catch(e){toast.error(e.message||'Unable to print the live shift summary.');}finally{setPreviewPrinting(false);}};
 const doClose=async(approved=managerApproved)=>{
   if(!tablesLoaded||tableLoadError){setError(tableLoadError||'Checking open tables. Please wait.');return;}
   if(openTables.length){setError('Clear or settle every active table before closing this shift.');return;}
   setBusy(true);setError('');
   try{
    const closed=await shiftService.closeShift({shiftId:shift.id,countedCash:Number(counted||0),notes,managerApproved:approved});
    let fresh;
    try {
      fresh=await shiftService.getShiftReport(shift.id);
    } catch (refreshError) {
      fresh={...report,shift:{...report.shift,status:'closed',closed_at:new Date().toISOString()}};
      toast.warning('Shift closed. The final report refresh failed, so the last loaded sales summary will be used for printing.');
    }
    fresh.shift={...fresh.shift,status:'closed',closed_at:fresh.shift?.closed_at||new Date().toISOString(),counted_cash:Number(counted||0),cash_variance:Number(closed?.variance||0)};
    fresh.countedCash=Number(counted||0);fresh.variance=Number(closed?.variance||0);fresh.propertyId=propertyId;fresh.openedBy=fresh.openedBy||'Staff';fresh.closedBy=fresh.closedBy||staff?.full_name||user?.name||'Staff';
    const settingsRow=await (async()=>{const {data}=await import('@/lib/supabaseClient').then(m=>m.supabase.from('property_settings').select('*').eq('property_id',propertyId).maybeSingle());return data||null;})().catch(()=>null);
    fresh.settings=settingsRow;fresh.propertyName=propertyName;
    localStorage.removeItem(`olitech_pos_shift_${propertyId}`);
    setClosedReport(fresh);setPrintStatus('printing');toast.success('Shift closed successfully. Printing the closing report…');await sendClosedReport(fresh);
   }catch(e){setError(e.message||'Unable to close shift.');}finally{setBusy(false);}
 };
 const submitPin=async(pin)=>{
   setPinError('');
   try{const result=await authService.verifyStaffPin({propertyId,module:'pos',pin});const r=String(result?.staff?.role||'').toLowerCase().replace(/\s+/g,'_');if(!result?.ok||!managerRoles.has(r)){setPinError('Manager or administrator PIN required.');return;}setPinOpen(false);setManagerApproved(true);await doClose(true);}catch(e){setPinError(e.message||'PIN verification failed.');}
 };
 if(closedReport)return <div className="fixed inset-0 z-[280] flex items-center justify-center bg-[var(--overlay-scrim)] p-4"><section role="dialog" aria-modal="true" aria-labelledby="shift-print-prompt-title" className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl"><span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--primary-soft)] text-[var(--primary)]"><CheckCircle2 size={24}/></span><h2 id="shift-print-prompt-title" className="mt-4 text-xl font-bold text-[var(--text)]">Shift closed successfully</h2><p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{printStatus==='printed'?'The closing report was automatically sent to the assigned thermal printer.':printStatus==='uncertain'?'The report may already have printed. Check the paper before retrying, so two copies are not handed to accounts.':printStatus==='printing'?'Sending the closing report to the assigned thermal printer…':printStatus==='unassigned'?'The shift is closed, but no Shift Closing Reports printer is assigned.':'The shift is closed. Automatic printing did not complete; you can retry below.'}</p><div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" disabled={printing} onClick={finishClosed} className="min-h-11 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50">Done</button><button type="button" disabled={printing||printStatus==='printed'} onClick={printClosedReport} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-5 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50">{printing?<RefreshCw size={16} className="animate-spin"/>:<Printer size={16}/>} {printing?'Printing…':'Retry print'}</button></div></section></div>;
 if(pinOpen)return <PinPad title="Manager PIN Required" staffName="Manager approval" error={pinError} onSubmit={submitPin} onClose={()=>setPinOpen(false)}/>;
 return <div className="fixed inset-0 z-[260] flex items-center justify-center bg-[var(--overlay-scrim)] p-4"><div className="w-full max-w-xl overflow-hidden rounded-3xl bg-[var(--surface)] shadow-2xl">
  <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4"><div><div className="text-lg font-medium">Close Shift</div><div className="text-xs text-[var(--text-muted)]">{shift?.shift_no} · {shift?.date}</div></div><button type="button" aria-label="Close shift dialog" onClick={onClose} className="rounded-xl p-2 hover:bg-[var(--sidebar)]"><X size={18} aria-hidden="true"/></button></div>
  <div className="max-h-[72vh] overflow-y-auto p-5">
   <div className="mb-4 flex items-center justify-between gap-3"><span className="text-xs text-[var(--text-muted)]">Shift totals are loaded from posted POS receipts and payment allocations.</span><button type="button" onClick={()=>setRefreshToken(v=>v+1)} disabled={busy||reportLoading} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold text-[var(--text)] disabled:opacity-50"><RefreshCw size={14} className={reportLoading?'animate-spin':''}/> Refresh summary</button></div>
   {reportLoading&&<div className="mb-4 rounded-xl bg-[var(--canvas)] p-3 text-sm text-[var(--text-muted)]">Refreshing shift sales and payment totals…</div>}
   {error&&<div className="mb-4 rounded-xl bg-[var(--danger-soft)] p-3 text-sm font-medium text-[var(--danger-text)]">{error}</div>}
   {openTables.length>0&&<div className="mb-4 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]"><b>Shift closing is blocked.</b><p className="mt-1">Settle and clear these tables from the floor first: {openTables.map(t=>`Table ${t.table_number||t.table_key}`).join(', ')}.</p></div>}{tableLoadError&&<div className="mb-4 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]">Could not verify the table floor: {tableLoadError}. Shift closing is disabled until this check succeeds.</div>}{report&&<><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[['Opening Cash',report.shift.opening_cash],['Gross Sales',report.grossSales],['Refunds',report.refundsTotal],['Voided Value',report.voidedValue],['Cash Sales',report.payments.cash.amount],['M-Pesa',report.payments.mpesa.amount],['Card',report.payments.card.amount],['Bank',report.payments.bank.amount],['Room Charge',report.payments.room_charge.amount],['Other Sales',report.payments.other.amount],['Net Sales',report.totalSales],['Receipts',report.totalTransactions],['Guest Covers',report.totalCovers],['Items Sold',report.itemsSold]].map(([l,v])=><div key={l} className="rounded-2xl border border-[var(--border)] bg-[var(--canvas)] p-3"><div className="text-[10px] font-medium  text-[var(--text-muted)]">{l}</div><div className="mt-1 font-mono text-sm font-medium">{typeof v==='number'&&['Receipts','Guest Covers','Items Sold'].includes(l)?v.toLocaleString('en-KE'):'KES '+money(v)}</div></div>)}</div>
   <div className="mt-4 rounded-2xl border border-[var(--border)] p-4"><div className="flex justify-between text-sm"><span>Expected cash in drawer</span><b>KES {money(report.expectedCash)}</b></div><div className="mt-3"><label className="text-xs font-medium  text-[var(--text-muted)]">Actual Cash Counted</label><input autoFocus value={counted} onChange={e=>setCounted(e.target.value)} type="number" min="0" className="mt-1 w-full rounded-xl border border-[var(--border)] p-3 text-lg font-medium outline-none focus:border-[var(--primary)]"/></div><div className={`mt-3 rounded-xl p-3 text-sm font-medium ${Math.abs(variance)>500?'bg-[var(--danger-soft)] text-[var(--danger-text)]':'bg-[var(--canvas)] text-[var(--text)]'}`}>{Math.abs(variance)>500&&<AlertTriangle size={15} className="mr-1 inline"/>}Variance: KES {money(variance)}</div></div>
   <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Closing notes (optional)" className="mt-4 min-h-20 w-full rounded-xl border border-[var(--border)] p-3 text-sm"/>
   </>}
  </div>
  <div className="flex flex-wrap justify-between gap-2 border-t border-[var(--border)] px-5 py-4"><div className="flex flex-wrap items-center gap-2"><div className="flex flex-col gap-1"><span className="text-[10px] text-[var(--text-muted)]">Digital documents are separate from assigned thermal copies.</span><DocumentExportMenu definition={shiftExportDefinition} label="Shift report" disabled={!shiftExportDefinition||busy}/></div><button type="button" onClick={printOpenShiftSummary} disabled={!report||reportLoading||busy||previewPrinting} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] disabled:opacity-50">{previewPrinting?<RefreshCw size={14} className="animate-spin"/>:<Printer size={14}/>} {previewPrinting?'Printing…':'Print live summary'}</button></div><div className="flex gap-2"><button onClick={onClose} className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-medium">Cancel</button><button disabled={!report||reportLoading||busy||counted.trim()===''||!Number.isFinite(Number(counted))||Number(counted)<0||!tablesLoaded||!!tableLoadError||openTables.length>0} onClick={()=>Math.abs(variance)>500&&!canApproveWithoutStaffPin?setPinOpen(true):doClose(Math.abs(variance)>500&&canApproveWithoutStaffPin)} className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-40"><LockKeyhole size={16}/>{busy?'Closing…':Math.abs(variance)>500&&!canApproveWithoutStaffPin?'Manager approval · Close shift':'Close shift'}</button></div></div>
 </div></div>;
}
