import React, { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { CalendarDays, RefreshCw, TrendingUp } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { shiftService, exportShiftToExcel } from '@/services/shiftService';
import { getPrinters, getAssignments, printShiftReport } from '@/services/printService';
import { pmsService } from '@/services/pmsService';
import { supabase } from '@/lib/supabaseClient';
import { NAVY, TEAL_DARK, BORDER, SAND, SURFACE, MUTED } from '@/data/themePalette';

const money = (value) => `KES ${Number(value || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;

function todayKenya() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
}

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
      <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: MUTED }}>{label}</div>
      <div className="font-mono text-xl font-bold" style={{ color: NAVY }}>{value}</div>
      {sub && <div className="mt-1 text-xs" style={{ color: MUTED }}>{sub}</div>}
    </div>
  );
}

export default function Reports() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [date, setDate] = useState(todayKenya);
  const [summary, setSummary] = useState(null);
  const [hotelMetrics, setHotelMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [shifts, setShifts] = useState([]);
  const [shiftBusy, setShiftBusy] = useState('');

  const load = async () => {
    if (!propertyId) return;
    setLoading(true);
    setError('');
    try {
      const [posSummary, metrics] = await Promise.all([pmsService.getDailyPosSummary(propertyId, date), pmsService.getDailyHotelMetrics(propertyId, date)]);
      setSummary(posSummary);
      setHotelMetrics(metrics);
    } catch (err) {
      setError(err.message || 'Unable to load live report.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [propertyId, date]);
  useEffect(() => { if(propertyId) shiftService.listShifts(propertyId,date).then(setShifts).catch(()=>{}); }, [propertyId,date]);
  const shiftAction = async (shift, action) => {
    setShiftBusy(shift.id+action);
    try {
      const report = await shiftService.getShiftReport(shift.id);
      report.propertyId=propertyId;
      if(action==='excel'){ exportShiftToExcel(report); }
      else {
        const {data:settings}=await supabase.from('property_settings').select('*').eq('property_id',propertyId).maybeSingle();
        report.settings=settings;
        const [printers,assignments]=await Promise.all([getPrinters(propertyId),getAssignments(propertyId)]);
        const printer=assignments.filter(a=>a.assignment_type==='shift_reports'||a.assignment_type==='reports').map(a=>printers.find(p=>p.id===a.printer_id)).find(Boolean);
        if(!printer) throw new Error('No Shift Closing Reports printer is assigned.');
        await printShiftReport(report,printer);
      }
    } catch(e){setError(e.message||'Shift report action failed.');} finally{setShiftBusy('');}
  };

  const hourlyData = useMemo(() => {
    const rows = summary?.hourly_revenue || [];
    return Array.from({ length: 24 }, (_, hour) => {
      const found = rows.find((r) => Number(r.hour) === hour);
      return { hour: `${String(hour).padStart(2, '0')}:00`, revenue: Number(found?.revenue || 0), transactions: Number(found?.transactions || 0) };
    }).filter((row) => row.revenue > 0 || row.transactions > 0);
  }, [summary]);

  const payments = summary?.payment_breakdown || [];
  const paymentTotal = payments.reduce((total, row) => total + Number(row.amount || 0), 0);

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-5 lg:p-6" style={{ background: SAND }}>
      <div className="mx-auto w-full max-w-[1600px]">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: MUTED }}>
              <TrendingUp size={14} aria-hidden="true" /> Live reporting
            </div>
            <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl" style={{ color: NAVY }}>POS revenue</h1>
            <p className="mt-1 text-sm" style={{ color: MUTED }}>Completed POS receipts for the selected Kenya business date.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-h-11 items-center gap-2 rounded-xl border bg-white px-3" style={{ borderColor: BORDER }}>
              <CalendarDays size={15} aria-hidden="true" style={{ color: TEAL_DARK }} />
              <span className="sr-only">Business date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-transparent text-sm font-semibold outline-none" />
            </label>
            <button type="button" onClick={load} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold disabled:opacity-50" style={{ background: NAVY, color: '#fff' }}>
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
            </button>
          </div>
        </div>

        {error && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Occupancy" value={loading ? '—' : `${Number(hotelMetrics?.occupancy_percent || 0).toLocaleString()}%`} sub={`${hotelMetrics?.occupied_rooms || 0} / ${hotelMetrics?.available_rooms || 0} rooms`} />
          <Stat label="ADR" value={loading ? '—' : money(hotelMetrics?.adr)} sub="Room revenue / occupied room nights" />
          <Stat label="RevPAR" value={loading ? '—' : money(hotelMetrics?.revpar)} sub="Room revenue / available rooms" />
          <Stat label="Room revenue" value={loading ? '—' : money(hotelMetrics?.room_revenue)} sub={`${hotelMetrics?.arrivals || 0} arrivals · ${hotelMetrics?.departures || 0} departures`} />
        </div>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Total POS revenue" value={loading ? '—' : money(summary?.total_revenue)} sub="Completed receipts" />
          <Stat label="Transactions" value={loading ? '—' : Number(summary?.transactions || 0).toLocaleString()} sub="Completed receipts" />
          <Stat label="Average check" value={loading ? '—' : money(summary?.average_check)} sub="Revenue ÷ transactions" />
          <Stat label="Payment methods" value={loading ? '—' : payments.length} sub="Methods used" />
        </div>

        <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
          <section className="rounded-2xl p-4 sm:p-5" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Revenue by hour</h2>
              <span className="text-[11px]" style={{ color: MUTED }}>{date}</span>
            </div>
            {hourlyData.length ? (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={hourlyData} barSize={22}>
                  <XAxis dataKey="hour" tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip formatter={(v) => [money(v), 'Revenue']} labelFormatter={(v) => v} contentStyle={{ background: NAVY, border: 'none', borderRadius: '8px', color: '#fff', fontSize: '12px' }} />
                  <Bar dataKey="revenue" radius={[5, 5, 0, 0]}>
                    {hourlyData.map((row, i) => <Cell key={i} fill={row.revenue === Math.max(...hourlyData.map((x) => x.revenue)) ? TEAL_DARK : BORDER} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="flex h-[230px] items-center justify-center text-sm" style={{ color: MUTED }}>No completed POS sales for this date.</div>}
          </section>

          <section className="rounded-2xl p-4 sm:p-5" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
            <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Payment breakdown</h2>
            {payments.length ? payments.map((row) => {
              const amount = Number(row.amount || 0);
              const pct = paymentTotal ? Math.round(amount / paymentTotal * 100) : 0;
              return (
                <div key={row.method} className="mb-4 last:mb-0">
                  <div className="mb-1.5 flex justify-between gap-3 text-xs">
                    <span className="font-semibold capitalize" style={{ color: NAVY }}>{row.method.replace('_', ' ')}</span>
                    <span className="font-mono" style={{ color: MUTED }}>{money(amount)} · {pct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full" style={{ background: BORDER }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: TEAL_DARK }} />
                  </div>
                  <div className="mt-1 text-[11px]" style={{ color: MUTED }}>{row.transactions} transaction{Number(row.transactions) === 1 ? '' : 's'}</div>
                </div>
              );
            }) : <div className="py-10 text-center text-sm" style={{ color: MUTED }}>No payments recorded.</div>}
          </section>
        </div>

        <section className="mb-4 rounded-2xl overflow-hidden" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
          <div className="flex items-center justify-between border-b px-4 py-4" style={{ borderColor:BORDER }}>
            <div><h2 className="text-xs font-bold uppercase tracking-[0.14em]" style={{color:NAVY}}>POS Shift Reports</h2><p className="mt-1 text-[11px]" style={{color:MUTED}}>Reprint closing receipts or export detailed Excel sales breakdowns.</p></div>
          </div>
          <div className="divide-y" style={{borderColor:BORDER}}>
            {shifts.map(s=><div key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div><div className="text-sm font-black" style={{color:NAVY}}>{s.shift_no}</div><div className="text-[11px]" style={{color:MUTED}}>{s.status.toUpperCase()} · Opened {new Date(s.opened_at).toLocaleString('en-KE')}</div></div>
              <div className="flex gap-2"><button disabled={!!shiftBusy} onClick={()=>shiftAction(s,'print')} className="rounded-lg border px-3 py-2 text-xs font-bold" style={{borderColor:BORDER,color:NAVY}}>Re-print</button><button disabled={!!shiftBusy} onClick={()=>shiftAction(s,'excel')} className="rounded-lg bg-[#0E7482] px-3 py-2 text-xs font-bold text-white">Export Excel</button></div>
            </div>)}
            {!shifts.length&&<div className="px-4 py-8 text-center text-sm" style={{color:MUTED}}>No shifts recorded for {date}.</div>}
          </div>
        </section>
        <section className="rounded-2xl overflow-hidden" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
          <div className="flex items-center justify-between border-b px-4 py-4" style={{ borderColor: BORDER }}>
            <h2 className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: NAVY }}>Top-selling items</h2>
            <span className="text-[11px]" style={{ color: MUTED }}>From receipt line items</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr style={{ background: '#F2F2F2', borderBottom: `1px solid ${BORDER}` }}>
                {['Item', 'Quantity', 'Revenue', 'Share'].map((h) => <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {(summary?.top_items || []).map((item) => {
                  const revenue = Number(item.revenue || 0);
                  const pct = Number(summary?.total_revenue || 0) ? Math.round(revenue / Number(summary.total_revenue) * 100) : 0;
                  return <tr key={item.name} style={{ borderBottom: `1px solid ${BORDER}` }}>
                    <td className="px-4 py-3 font-semibold" style={{ color: NAVY }}>{item.name}</td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: MUTED }}>{Number(item.qty || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 font-mono font-bold" style={{ color: NAVY }}>{money(revenue)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full" style={{ background: BORDER }}><div className="h-full rounded-full" style={{ width: `${pct}%`, background: TEAL_DARK }} /></div>
                        <span className="w-9 text-right text-xs font-mono" style={{ color: MUTED }}>{pct}%</span>
                      </div>
                    </td>
                  </tr>;
                })}
                {!loading && !(summary?.top_items || []).length && <tr><td colSpan="4" className="px-4 py-8 text-center text-sm" style={{ color: MUTED }}>No item sales recorded.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}