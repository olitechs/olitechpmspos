import React,{useEffect,useMemo,useState}from'react';
import{Download,X,LockKeyhole,AlertTriangle}from'lucide-react';
import{toast}from'sonner';
import{useAuth}from'@/lib/AuthContext';
import{authService,getSessionStaff}from'@/services/authService';
import{shiftService,exportShiftToExcel}from'@/services/shiftService';
import{getPrinters,getAssignments,printShiftReport}from'@/services/printService';
import PinPad from'@/components/auth/PinPad';
import BrandLogo from'@/components/ui/BrandLogo';

const money=n=>Number(n||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
const managerRoles = new Set(['hotel_admin','super_admin','fb_manager','owner','admin','manager','property_manager','general_manager']);
export function OpenShiftModal({ propertyId, onOpened }) {
  const [step, setStep] = useState('pin');
  const [pin, setPin] = useState('');
  const [staff, setStaff] = useState(null);
  const [cash, setCash] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const openingFloat = Number(cash);
  const validFloat = cash.trim() !== '' && Number.isFinite(openingFloat) && openingFloat > 0;
  const today = new Date().toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const verifyPin = async (value) => {
    if (busy || value.length !== 4) return;
    setBusy(true);
    setError('');
    try {
      const result = await authService.verifyStaffPin({ propertyId, module: 'pos', pin: value });
      if (!result?.ok || !result?.staff) {
        setPin('');
        setError('PIN not recognised. Please try again.');
        return;
      }
      setStaff(result.staff);
      sessionStorage.setItem('olitech_active_staff_v2', JSON.stringify(result.staff));
      window.dispatchEvent(new CustomEvent('olitech:staff-changed', { detail: result.staff }));
      setStep('float');
    } catch (e) {
      setPin('');
      setError(e.message || 'Could not verify staff PIN. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  const enterDigit = (digit) => {
    if (busy || pin.length >= 4) return;
    const next = pin + String(digit);
    setPin(next);
    if (next.length === 4) verifyPin(next);
  };

  const open = async () => {
    if (!validFloat || busy) {
      setError('Enter a starting cash float greater than zero.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const shift = await shiftService.openShift({ propertyId, openingCash: openingFloat, notes });
      onOpened?.(shift);
    } catch (e) {
      setError(e.message || 'Unable to open shift. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const keyClass = 'flex min-h-[58px] items-center justify-center border-b border-r border-[var(--pos-gate-border)] bg-transparent text-2xl font-semibold text-[var(--pos-gate-text)] transition hover:bg-[var(--pos-gate-hover)] active:bg-[var(--pos-gate-active)] disabled:opacity-40';

  return (
    <main className="fixed inset-0 z-[9999] flex h-[100dvh] w-screen flex-col items-center justify-center overflow-y-auto bg-[var(--pos-gate-bg)] px-4 py-5 font-body text-[var(--pos-gate-text)] sm:px-6">
      <header className="mb-5 flex w-full max-w-4xl items-center justify-between gap-4">
        <div className="rounded-xl bg-[var(--surface)] px-4 py-2 shadow-sm"><BrandLogo className="h-9 w-auto max-w-[158px] object-contain" /></div>
        <div className="text-right"><div className="text-xs font-semibold text-[var(--pos-gate-muted)]">POS SHIFT CONTROL</div><div className="mt-1 text-xs text-[var(--pos-gate-muted)]">{today}</div></div>
      </header>

      <section className="grid w-full max-w-4xl overflow-hidden rounded-3xl border border-[var(--pos-gate-border)] bg-[var(--pos-gate-surface)] shadow-[0_24px_70px_rgba(0,0,0,.22)] md:grid-cols-[0.9fr_1.1fr]">
        <aside className="flex flex-col justify-between bg-[var(--pos-gate-accent)] p-6 text-white sm:p-8">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[.2em] text-white/70">Start of business</div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Open your shift</h1>
            <p className="mt-3 max-w-sm text-sm leading-6 text-white/80">Verify the cashier on duty and record the opening cash float. POS payments remain locked until the shift is opened.</p>
          </div>
          <div className="mt-8 space-y-3">
            <div className="flex items-center gap-3 rounded-xl border border-white/20 bg-white/10 p-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-sm font-bold">1</span><div><div className="text-sm font-semibold">Staff verification</div><div className="text-xs text-white/70">Your personal POS PIN</div></div></div>
            <div className="flex items-center gap-3 rounded-xl border border-white/20 bg-white/10 p-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-sm font-bold">2</span><div><div className="text-sm font-semibold">Opening cash float</div><div className="text-xs text-white/70">Record the amount in the drawer</div></div></div>
          </div>
          <div className="mt-8 text-[10px] font-medium text-white/60">{'OliTechs PMS + POS · Secure cashier workflow'}</div>
        </aside>

        <div className="flex min-w-0 flex-col justify-center p-5 sm:p-8">
          {step === 'pin' ? (
            <>
              <div className="text-center">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--pos-gate-muted)]">Step 1 of 2</div>
                <h2 className="mt-2 text-xl font-semibold">Cashier PIN</h2>
                <p className="mt-1 text-sm text-[var(--pos-gate-muted)]">Enter your 4-digit staff PIN to take responsibility for this shift.</p>
                <div className="mt-5 flex justify-center gap-3" aria-label={`${pin.length} of 4 PIN digits entered`}>
                  {Array.from({ length: 4 }, (_, i) => <span key={i} className={`h-4 w-4 rounded-full border-2 border-[var(--pos-gate-accent)] ${i < pin.length ? 'bg-[var(--pos-gate-accent)]' : 'bg-transparent'}`} />)}
                </div>
              </div>
              <div className="mt-5 grid grid-cols-3 overflow-hidden rounded-xl border-l border-t border-[var(--pos-gate-border)]">
                {[1,2,3,4,5,6,7,8,9].map(n => <button key={n} type="button" onClick={() => enterDigit(n)} disabled={busy || pin.length >= 4} className={keyClass}>{n}</button>)}
                <button type="button" onClick={() => setPin('')} disabled={busy || !pin.length} className="border-b border-r border-[var(--pos-gate-border)] text-xs font-semibold text-[var(--pos-gate-accent)] disabled:opacity-40">Clear</button>
                <button type="button" onClick={() => enterDigit(0)} disabled={busy || pin.length >= 4} className={keyClass}>0</button>
                <div className="border-b border-r border-[var(--pos-gate-border)]" />
              </div>
              {error && <p role="alert" className="mt-3 text-center text-xs font-semibold text-[var(--danger-text)]">{error}</p>}
              {busy && <p aria-live="polite" className="mt-3 text-center text-xs text-[var(--pos-gate-muted)]">Verifying cashier…</p>}
              <p className="mt-4 text-center text-[11px] text-[var(--pos-gate-muted)]">Opening a shift is required before the POS can accept orders and payments.</p>
            </>
          ) : (
            <>
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--pos-gate-muted)]">Step 2 of 2</div>
              <h2 className="mt-2 text-xl font-semibold">Opening cash float</h2>
              <p className="mt-1 text-sm text-[var(--pos-gate-muted)]">Confirm the physical cash placed in the drawer before service begins.</p>
              <div className="mt-5 flex items-center gap-3 rounded-xl border border-[var(--pos-gate-border)] bg-[var(--pos-gate-bg)] p-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--pos-gate-accent)] text-sm font-bold text-white">{(staff?.full_name || 'S').slice(0,1).toUpperCase()}</div>
                <div className="min-w-0"><div className="truncate text-sm font-semibold">{staff?.full_name || 'Verified cashier'}</div><div className="text-xs text-[var(--pos-gate-muted)]">{staff?.role || 'POS Staff'} · Verified</div></div>
                <span className="ml-auto rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-800">VERIFIED</span>
              </div>
              <label htmlFor="pos-opening-float" className="mt-5 text-xs font-semibold text-[var(--pos-gate-muted)]">Opening cash float · KES</label>
              <div className="mt-2 flex items-center rounded-xl border border-[var(--pos-gate-border)] bg-[var(--pos-gate-bg)] px-4 py-3 focus-within:border-[var(--pos-gate-accent)]">
                <span className="mr-3 text-sm font-semibold text-[var(--pos-gate-muted)]">KES</span>
                <input id="pos-opening-float" autoFocus value={cash} onChange={e => { setCash(e.target.value); setError(''); }} type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="5,000.00" aria-invalid={cash !== '' && !validFloat} className="w-full min-w-0 bg-transparent text-2xl font-semibold outline-none" />
              </div>
              <p className="mt-2 text-xs text-[var(--pos-gate-muted)]">Enter the actual amount counted in the cash drawer. This becomes the opening balance for the shift.</p>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opening notes (optional)" className="mt-4 min-h-20 w-full rounded-xl border border-[var(--pos-gate-border)] bg-transparent p-3 text-sm outline-none focus:border-[var(--pos-gate-accent)]" />
              {error && <p role="alert" className="mt-3 text-xs font-semibold text-[var(--danger-text)]">{error}</p>}
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
                <button type="button" onClick={() => { setStep('pin'); setPin(''); setError(''); setCash(''); }} disabled={busy} className="rounded-xl border border-[var(--pos-gate-border)] px-4 py-3 text-sm font-semibold">Back</button>
                <button type="button" disabled={!validFloat || busy} onClick={open} className="flex-1 rounded-xl bg-[var(--pos-gate-accent)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">{busy ? 'Opening shift…' : 'Confirm & Open Shift'}</button>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

export default function CloseShiftModal({shift,onClosed,onClose}){
 const{user}=useAuth();const propertyId=user?.property?.id;const[report,setReport]=useState(null);const[openTables,setOpenTables]=useState([]);const[tablesLoaded,setTablesLoaded]=useState(false);const[tableLoadError,setTableLoadError]=useState('');const[counted,setCounted]=useState('');const[notes,setNotes]=useState('');const[busy,setBusy]=useState(false);const[error,setError]=useState('');const[pinOpen,setPinOpen]=useState(false);const[pinError,setPinError]=useState('');
 const staff=getSessionStaff();const canApproveWithoutStaffPin=Boolean(user?.isPlatformOwner||['owner','admin','manager'].includes(String(user?.propertyRole||'').toLowerCase())||['hotel_admin','super_admin'].includes(String(user?.staff?.role||'').toLowerCase()));const[managerApproved,setManagerApproved]=useState(false);
 
 useEffect(()=>{if(!shift)return;shiftService.getShiftReport(shift.id).then(setReport).catch(e=>setError(e.message));shiftService.getOpenTables(propertyId).then(setOpenTables).catch(e=>setTableLoadError(e.message||'Could not verify open tables.')).finally(()=>setTablesLoaded(true));},[shift,propertyId]);
 const variance=useMemo(()=>report?Number(counted||0)-Number(report.expectedCash||0):0,[counted,report]);
 const doClose=async(approved=managerApproved)=>{
   if(!tablesLoaded||tableLoadError){setError(tableLoadError||'Checking open tables. Please wait.');return;}
   if(openTables.length){setError('Clear or settle every active table before closing this shift.');return;}
   setBusy(true);setError('');
   try{
    const closed=await shiftService.closeShift({shiftId:shift.id,countedCash:Number(counted||0),notes,managerApproved:approved});
    const fresh=await shiftService.getShiftReport(shift.id);
    fresh.countedCash=Number(counted||0);fresh.variance=Number(closed?.variance||0);fresh.propertyId=propertyId;fresh.openedBy=fresh.openedBy||'Staff';fresh.closedBy=fresh.closedBy||staff?.full_name||user?.name||'Staff';
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
   try{const result=await authService.verifyStaffPin({propertyId,module:'pos',pin});const r=String(result?.staff?.role||'').toLowerCase().replace(/\s+/g,'_');if(!result?.ok||!managerRoles.has(r)){setPinError('Manager or administrator PIN required.');return;}setPinOpen(false);setManagerApproved(true);await doClose(true);}catch(e){setPinError(e.message||'PIN verification failed.');}
 };
 if(pinOpen)return <PinPad title="Manager PIN Required" staffName="Manager approval" error={pinError} onSubmit={submitPin} onClose={()=>setPinOpen(false)}/>;
 return <div className="fixed inset-0 z-[260] flex items-center justify-center bg-[var(--pos-gate-bg)] p-2 sm:p-5"><div className="flex h-full max-h-[960px] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
  <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-6"><div className="flex min-w-0 items-center gap-3"><div className="rounded-lg bg-[var(--canvas)] px-2 py-1"><BrandLogo className="h-7 w-auto max-w-[112px] object-contain"/></div><div className="min-w-0"><div className="text-base font-semibold text-[var(--text)]">Close Shift</div><div className="truncate text-xs text-[var(--text-muted)]">{shift?.shift_no} · {shift?.date} · {staff?.full_name || "Current cashier"}</div></div></div><button onClick={onClose} aria-label="Cancel shift closing" className="rounded-xl border border-[var(--border)] p-2 text-[var(--text-muted)] transition hover:bg-[var(--canvas)]"><X size={18}/></button></div>
  <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
   {error&&<div className="mb-4 rounded-xl bg-[var(--danger-soft)] p-3 text-sm font-medium text-[var(--danger-text)]">{error}</div>}
   {openTables.length>0&&<div className="mb-4 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]"><b>Shift closing is blocked.</b><p className="mt-1">Settle and clear these tables from the floor first: {openTables.map(t=>`Table ${t.table_number||t.table_key}`).join(', ')}.</p></div>}{tableLoadError&&<div className="mb-4 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]">Could not verify the table floor: {tableLoadError}. Shift closing is disabled until this check succeeds.</div>}{report&&<><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[['Opening Cash',report.shift.opening_cash],['Gross Sales',report.grossSales],['Refunds',report.refundsTotal],['Voided Value',report.voidedValue],['Cash Sales',report.payments.cash.amount],['M-Pesa',report.payments.mpesa.amount],['Card',report.payments.card.amount],['Bank',report.payments.bank.amount],['Room Charge',report.payments.room_charge.amount],['Other Sales',report.payments.other.amount],['Net Sales',report.totalSales],['Receipts',report.totalTransactions],['Guest Covers',report.totalCovers],['Items Sold',report.itemsSold]].map(([l,v])=><div key={l} className="rounded-2xl border border-[var(--border)] bg-[var(--canvas)] p-3"><div className="text-[10px] font-medium  text-[var(--text-muted)]">{l}</div><div className="mt-1 font-mono text-sm font-medium">{typeof v==='number'&&['Receipts','Guest Covers','Items Sold'].includes(l)?v.toLocaleString('en-KE'):'KES '+money(v)}</div></div>)}</div>
   <div className="mt-4 rounded-2xl border border-[var(--border)] p-4"><div className="flex justify-between text-sm"><span>Expected cash in drawer</span><b>KES {money(report.expectedCash)}</b></div><div className="mt-3"><label className="text-xs font-medium  text-[var(--text-muted)]">Actual Cash Counted</label><input autoFocus value={counted} onChange={e=>setCounted(e.target.value)} type="number" min="0" className="mt-1 w-full rounded-xl border border-[var(--border)] p-3 text-lg font-medium outline-none focus:border-[var(--primary)]"/></div><div className={`mt-3 rounded-xl p-3 text-sm font-medium ${Math.abs(variance)>500?'bg-[var(--danger-soft)] text-[var(--danger-text)]':'bg-[var(--canvas)] text-[var(--text)]'}`}>{Math.abs(variance)>500&&<AlertTriangle size={15} className="mr-1 inline"/>}Variance: KES {money(variance)}</div></div>
   <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Closing notes (optional)" className="mt-4 min-h-20 w-full rounded-xl border border-[var(--border)] p-3 text-sm"/>
   </>}
  </div>
  <div className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-[var(--border)] bg-[var(--canvas)] px-4 py-3 sm:px-6"><button disabled={!report||busy} onClick={()=>{const r={...report,countedCash:Number(counted||0),variance};exportShiftToExcel(r)}} className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-medium disabled:opacity-40"><Download size={16}/>Export Excel</button><div className="flex gap-2"><button onClick={onClose} className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-medium">Cancel</button><button disabled={!report||busy||counted===''||!tablesLoaded||!!tableLoadError||openTables.length>0} onClick={()=>Math.abs(variance)>500&&!canApproveWithoutStaffPin?setPinOpen(true):doClose(Math.abs(variance)>500&&canApproveWithoutStaffPin)} className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-40"><LockKeyhole size={16}/>{busy?'Closing…':Math.abs(variance)>500&&!canApproveWithoutStaffPin?'Manager PIN · Print & Close':'Print & Close Shift'}</button></div></div>
 </div></div>;
}