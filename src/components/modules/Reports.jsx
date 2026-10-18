import React, { useEffect, useMemo, useState } from 'react';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { CalendarDays, Download, Printer, RefreshCw, TrendingUp, Hotel, ShoppingCart, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { reportingService } from '@/services/reportingService';
import { NAVY, TEAL_DARK, BORDER, SAND, SURFACE, MUTED } from '@/data/themePalette';

const money = (value) => `KES ${Number(value || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const todayKenya = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());

function startOfMonth(date) { return `${date.slice(0, 8)}01`; }
function Stat({ label, value, sub, icon: Icon }) {
  return <div className="rounded-2xl p-4" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
    <div className="mb-1 flex items-center justify-between gap-2"><div className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: MUTED }}>{label}</div>{Icon && <Icon size={15} style={{ color: TEAL_DARK }} />}</div>
    <div className="font-mono text-xl font-bold" style={{ color: NAVY }}>{value}</div>
    {sub && <div className="mt-1 text-xs" style={{ color: MUTED }}>{sub}</div>}
  </div>;
}
function Section({ title, children }) {
  return <section className="rounded-2xl overflow-hidden" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
    <div className="border-b px-4 py-3" style={{ borderColor: BORDER }}><h2 className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: NAVY }}>{title}</h2></div>
    <div className="p-4">{children}</div>
  </section>;
}
function Table({ columns, rows, empty = 'No transactional data for this period.' }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr style={{ borderBottom: `1px solid ${BORDER}` }}>{columns.map(c => <th key={c.key} className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{c.label}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, i) => <tr key={row.id || row.key || i} style={{ borderBottom: `1px solid ${BORDER}` }}>{columns.map(c => <td key={c.key} className="px-3 py-2" style={{ color: NAVY }}>{c.render ? c.render(row) : row[c.key]}</td>)}</tr>) : <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-sm" style={{ color: MUTED }}>{empty}</td></tr>}</tbody></table></div>;
}
function downloadCsv(filename, rows) {
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

export default function Reports() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const today = todayKenya();
  const [from, setFrom] = useState(startOfMonth(today));
  const [to, setTo] = useState(today);
  const [report, setReport] = useState(null);
  const [sales, setSales] = useState(null);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    if (!propertyId) return;
    if (from > to) { setError('The start date must be on or before the end date.'); return; }
    setLoading(true); setError('');
    try {
      const [management, salesDetail] = await Promise.all([
        reportingService.getManagementReport(propertyId, from, to),
        reportingService.getSalesDetail(propertyId, from, to),
      ]);
      setReport(management); setSales(salesDetail);
    } catch (err) { setError(err.message || 'Unable to load live management reports.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [propertyId, from, to]);

  const exportCsv = () => {
    if (!report || !sales) return;
    const rows = [
      ['OliTechs Management Report', from, to],
      [],
      ['Hotel KPI','Value'],
      ['Sellable rooms',report.hotel?.sellable_rooms || 0],
      ['Available room nights',report.hotel?.available_room_nights || 0],
      ['Occupied room nights',report.hotel?.occupied_room_nights || 0],
      ['Occupancy %',report.hotel?.occupancy_percent || 0],
      ['Room revenue',report.hotel?.room_revenue || 0],
      ['ADR',report.hotel?.adr || 0],
      ['RevPAR',report.hotel?.revpar || 0],
      ['Arrivals',report.hotel?.arrivals || 0],
      ['Departures',report.hotel?.departures || 0],
      [],
      ['Sales KPI','Value'],
      ['POS gross',report.sales?.pos_gross || 0],
      ['POS tax',report.sales?.pos_tax || 0],
      ['Discounts',report.sales?.discounts || 0],
      ['Refunds',report.sales?.refunds || 0],
      ['Voids',report.sales?.voids || 0],
      ['POS net',report.sales?.pos_net || 0],
      [],
      ['Payment method','Transactions','Amount'],
      ...(sales.payments || []).map(x => [x.method,x.transactions,x.amount]),
      [],
      ['Department','Quantity','Revenue'],
      ...(sales.departments || []).map(x => [x.department,x.qty,x.revenue]),
      [],
      ['Inventory KPI','Value'],
      ['Valuation',report.inventory?.valuation || 0],
      ['Purchases',report.inventory?.purchases || 0],
      ['Consumption quantity',report.inventory?.consumption_qty || 0],
      ['Wastage quantity',report.inventory?.wastage_qty || 0],
      ['Stock movements',report.inventory?.stock_movements || 0],
      ['Transfer orders',report.inventory?.transfer_orders || 0],
      [],
      ['Cashier KPI','Value'],
      ['Open shifts',report.cashier?.open_shifts || 0],
      ['Closed shifts',report.cashier?.closed_shifts || 0],
      ['Cash variance',report.cashier?.cash_variance || 0],
    ];
    downloadCsv(`olitech-management-report-${from}-to-${to}.csv`, rows);
  };

  const printReport = () => window.print();

  const daily = useMemo(() => sales?.daily || [], [sales]);
  const tabs = [
    ['overview','Overview',TrendingUp], ['sales','Sales',ShoppingCart], ['hotel','Hotel',Hotel], ['inventory','Inventory',ShoppingCart], ['controls','Controls',ShieldCheck],
  ];

  return <div className="flex-1 overflow-y-auto p-4 sm:p-5 lg:p-6" style={{ background: SAND }}>
    <div className="mx-auto w-full max-w-[1600px]">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><div className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Management reporting</div><h1 className="text-xl font-extrabold tracking-tight sm:text-2xl" style={{ color: NAVY }}>Transactional reports</h1><p className="mt-1 text-sm" style={{ color: MUTED }}>All KPIs are calculated from PMS, POS, cashier and inventory transactions for the selected Kenya business-date range.</p></div>
        <div className="flex flex-wrap gap-2">
          <label className="flex min-h-11 items-center gap-2 rounded-xl border bg-white px-3" style={{ borderColor: BORDER }}><CalendarDays size={15} style={{ color: TEAL_DARK }} /><input aria-label="From date" type="date" value={from} onChange={e=>setFrom(e.target.value)} className="bg-transparent text-sm font-semibold outline-none" /></label>
          <label className="flex min-h-11 items-center gap-2 rounded-xl border bg-white px-3" style={{ borderColor: BORDER }}><span className="text-xs font-bold" style={{ color: MUTED }}>TO</span><input aria-label="To date" type="date" value={to} onChange={e=>setTo(e.target.value)} className="bg-transparent text-sm font-semibold outline-none" /></label>
          <button type="button" onClick={load} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold disabled:opacity-50" style={{ background: NAVY, color: '#fff' }}><RefreshCw size={15} className={loading?'animate-spin':''}/>Refresh</button>
          <button type="button" onClick={exportCsv} disabled={!report || loading} className="inline-flex min-h-11 items-center gap-2 rounded-xl border bg-white px-3 text-sm font-bold disabled:opacity-50" style={{ borderColor: BORDER, color: NAVY }}><Download size={15}/>CSV</button>
          <button type="button" onClick={printReport} className="inline-flex min-h-11 items-center gap-2 rounded-xl border bg-white px-3 text-sm font-bold" style={{ borderColor: BORDER, color: NAVY }}><Printer size={15}/>Print</button>
        </div>
      </div>

      {error && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="mb-4 flex flex-wrap gap-2">{tabs.map(([key,label,Icon])=><button key={key} type="button" onClick={()=>setTab(key)} className="inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-bold" style={{ background: tab===key ? NAVY : SURFACE, color: tab===key ? '#fff' : NAVY, border: `1px solid ${tab===key ? NAVY : BORDER}` }}><Icon size={14}/>{label}</button>)}</div>

      {loading && !report ? <div className="rounded-2xl p-10 text-center text-sm" style={{ background:SURFACE,color:MUTED,border:`1px solid ${BORDER}` }}>Loading live transactional data…</div> : report && <>
        {tab==='overview' && <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Stat label="Occupancy" value={`${report.hotel?.occupancy_percent || 0}%`} sub={`${report.hotel?.occupied_room_nights || 0} / ${report.hotel?.available_room_nights || 0} room nights`} icon={Hotel}/>
            <Stat label="ADR" value={money(report.hotel?.adr)} sub="Room revenue / occupied nights"/>
            <Stat label="RevPAR" value={money(report.hotel?.revpar)} sub="Room revenue / available nights"/>
            <Stat label="Room revenue" value={money(report.hotel?.room_revenue)} sub={`${report.hotel?.arrivals || 0} arrivals`}/>
            <Stat label="POS net" value={money(report.sales?.pos_net)} sub={`Gross ${money(report.sales?.pos_gross)}`} icon={ShoppingCart}/>
            <Stat label="Tax" value={money(report.sales?.pos_tax)} sub="Posted POS VAT"/>
            <Stat label="Refunds" value={money(report.sales?.refunds)} sub={`${sales?.refunds?.reduce((a,x)=>a+Number(x.transactions||0),0) || 0} refunds`}/>
            <Stat label="Cash variance" value={money(report.cashier?.cash_variance)} sub={`${report.cashier?.closed_shifts || 0} closed shifts`} icon={ShieldCheck}/>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
            <Section title="Daily POS sales"><ResponsiveContainer width="100%" height={260}><LineChart data={daily}><XAxis dataKey="business_date" tick={{fontSize:10,fill:MUTED}}/><YAxis hide/><Tooltip formatter={(v)=>[money(v),'Revenue']}/><Line type="monotone" dataKey="revenue" stroke={TEAL_DARK} strokeWidth={3} dot={false}/></LineChart></ResponsiveContainer></Section>
            <Section title="Management controls"><div className="grid grid-cols-2 gap-3">{[['Open shifts',report.cashier?.open_shifts],['Closed shifts',report.cashier?.closed_shifts],['Stock movements',report.inventory?.stock_movements],['Transfers',report.inventory?.transfer_orders],['Arrivals',report.hotel?.arrivals],['Departures',report.hotel?.departures]].map(([k,v])=><div key={k} className="rounded-xl p-3" style={{background:SAND}}><div className="text-[11px] uppercase tracking-wide" style={{color:MUTED}}>{k}</div><div className="mt-1 font-mono text-lg font-bold" style={{color:NAVY}}>{Number(v||0).toLocaleString()}</div></div>)}</div></Section>
          </div>
        </div>}

        {tab==='sales' && <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Section title="Sales by department / production center"><Table columns={[{key:'department',label:'Department'},{key:'qty',label:'Qty'},{key:'revenue',label:'Revenue',render:r=>money(r.revenue)}]} rows={sales?.departments||[]} /></Section>
          <Section title="Payment methods"><Table columns={[{key:'method',label:'Method'},{key:'transactions',label:'Transactions'},{key:'amount',label:'Amount',render:r=>money(r.amount)}]} rows={sales?.payments||[]} /></Section>
          <Section title="Discounts"><Table columns={[{key:'discount',label:'Discount'},{key:'transactions',label:'Transactions'},{key:'amount',label:'Amount',render:r=>money(r.amount)}]} rows={sales?.discounts||[]} /></Section>
          <Section title="Voids"><Table columns={[{key:'reason',label:'Reason'},{key:'transactions',label:'Transactions'},{key:'amount',label:'Amount',render:r=>money(r.amount)}]} rows={sales?.voids||[]} /></Section>
          <Section title="Refunds"><Table columns={[{key:'method',label:'Method'},{key:'transactions',label:'Transactions'},{key:'amount',label:'Amount',render:r=>money(r.amount)}]} rows={sales?.refunds||[]} /></Section>
        </div>}

        {tab==='hotel' && <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Sellable rooms" value={report.hotel?.sellable_rooms}/><Stat label="Available room nights" value={report.hotel?.available_room_nights}/><Stat label="Occupied room nights" value={report.hotel?.occupied_room_nights}/><Stat label="Reservations" value={report.hotel?.reservations}/><Stat label="Arrivals" value={report.hotel?.arrivals}/><Stat label="Departures" value={report.hotel?.departures}/><Stat label="ADR" value={money(report.hotel?.adr)}/><Stat label="RevPAR" value={money(report.hotel?.revpar)}/><Stat label="Room revenue" value={money(report.hotel?.room_revenue)}/></div>}

        {tab==='inventory' && <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"><Stat label="Inventory valuation" value={money(report.inventory?.valuation)} sub="Current stock × cost"/><Stat label="Purchases" value={money(report.inventory?.purchases)} sub="Non-cancelled POs"/><Stat label="Consumption" value={Number(report.inventory?.consumption_qty||0).toLocaleString()} sub="Usage quantity"/><Stat label="Wastage" value={Number(report.inventory?.wastage_qty||0).toLocaleString()} sub="Recorded quantity"/><Stat label="Stock movements" value={report.inventory?.stock_movements}/><Stat label="Transfers" value={report.inventory?.transfer_orders}/></div>}

        {tab==='controls' && <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Open cashier shifts" value={report.cashier?.open_shifts}/><Stat label="Closed cashier shifts" value={report.cashier?.closed_shifts}/><Stat label="Cash variance" value={money(report.cashier?.cash_variance)}/><Stat label="Voids" value={money(report.sales?.voids)}/><Stat label="Refunds" value={money(report.sales?.refunds)}/><Stat label="Discounts" value={money(report.sales?.discounts)}/><Stat label="POS tax" value={money(report.sales?.pos_tax)}/><Stat label="POS net" value={money(report.sales?.pos_net)}/></div>}
      </>}
    </div>
  </div>;
}
