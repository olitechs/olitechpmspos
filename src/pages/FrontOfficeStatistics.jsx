import React,{useMemo,useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import {PmsProvider,usePms} from '@/data/PmsStore';
import {BarChart3,CalendarDays,Download,TrendingUp,Users,BedDouble,Wallet,ArrowUpRight} from 'lucide-react';

const REPORTS={
 occupancy:{title:'Occupancy',description:'Room-night demand and room availability across the selected period.'},
 'adr-revpar':{title:'ADR and RevPAR',description:'Average daily rate and revenue per available room, based on reservation rates.'},
 revenue:{title:'Revenue',description:'Reservation value and recorded payments for stays in the selected period.'},
 channels:{title:'Sources / Channels',description:'Understand which booking sources and channels generate reservations.'},
 'guest-origin':{title:'Guest Origin / Nationality',description:'Guest-origin insights where nationality or origin is recorded in booking details.'},
 cancellations:{title:'Cancellations and No-shows',description:'Cancelled reservations and no-show records within the selected period.'},
 forecast:{title:'Forecast',description:'Forward-looking room demand based on current confirmed reservations.'}
};
const money=v=>new Intl.NumberFormat('en-KE',{style:'currency',currency:'KES',maximumFractionDigits:0}).format(Number(v)||0);
const dateKey=d=>{const x=new Date(d);return Number.isNaN(x.getTime())?'':x.toISOString().slice(0,10)};
function StatisticsContent(){
 const {report='occupancy'}=useParams(),{rooms=[],reservations=[],loading,error}=usePms();
 const [period,setPeriod]=useState('30');
 const config=REPORTS[report]||REPORTS.occupancy;
 const now=new Date(),days=Number(period),start=new Date(now);start.setHours(0,0,0,0);start.setDate(start.getDate()-(days-1));
 const end=new Date(now);end.setHours(23,59,59,999);
 const data=useMemo(()=>{
  const active=reservations.filter(r=>!['cancelled','no_show'].includes(String(r.status||'').toLowerCase()));
  const scoped=reservations.filter(r=>{const d=new Date(r.checkIn||r.arrival);return !Number.isNaN(d.getTime())&&d>=start&&d<=end;});
  const cancelled=reservations.filter(r=>['cancelled','no_show'].includes(String(r.status||'').toLowerCase())&&new Date(r.checkIn||r.arrival)>=start&&new Date(r.checkIn||r.arrival)<=end);
  const nightsBetween=(a,b)=>Math.max(0,Math.round((new Date(dateKey(b)+'T00:00:00')-new Date(dateKey(a)+'T00:00:00'))/86400000));
  const roomNights=scoped.reduce((sum,r)=>sum+nightsBetween(r.checkIn||r.arrival,r.checkOut||r.departure),0);
  const availableRoomNights=rooms.length*days;
  const occupancy=availableRoomNights?Math.min(100,roomNights/availableRoomNights*100):0;
  const totalValue=scoped.reduce((s,r)=>s+Number(r.totalAmount??r.total_amount??r.rate??0),0);
  const collected=scoped.reduce((s,r)=>s+Number(r.amountPaid??r.amount_paid??0),0);
  const adr=roomNights?totalValue/roomNights:0,revpar=availableRoomNights?totalValue/availableRoomNights:0;
  const grouped={};scoped.forEach(r=>{const key=r.source||r.channel||'Unspecified';grouped[key]=(grouped[key]||0)+1;});
  const origin={};scoped.forEach(r=>{const details=r.booking_details||r.bookingDetails||{};const key=details.nationality||details.country||details.guest_origin||'Not recorded';origin[key]=(origin[key]||0)+1;});
  const upcoming=active.filter(r=>{const d=new Date(r.checkIn||r.arrival);return d>=now&&d<=new Date(now.getTime()+days*86400000);});
  const daily=Array.from({length:Math.min(days,14)},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+Math.round(i*(days-1)/(Math.min(days,14)-1||1)));const k=dateKey(d);return {date:k,count:scoped.filter(r=>dateKey(r.checkIn||r.arrival)===k).length};});
  return {scoped,cancelled,roomNights,availableRoomNights,occupancy,totalValue,collected,adr,revpar,grouped,origin,upcoming,daily,active};
 },[reservations,rooms,period]);
 const cards=report==='occupancy'?[['Occupancy',data.occupancy.toFixed(1)+'%','Room nights / available room nights',BedDouble],['Room nights',data.roomNights,'Reserved nights in period',CalendarDays],['Available room nights',data.availableRoomNights,'Rooms × selected days',BedDouble],['Reservations',data.scoped.length,'Arrivals in selected period',Users]]:
 report==='adr-revpar'?[['ADR',money(data.adr),'Reservation value / occupied room nights',TrendingUp],['RevPAR',money(data.revpar),'Reservation value / available room nights',BedDouble],['Occupancy',data.occupancy.toFixed(1)+'%','Selected period',BarChart3],['Room nights',data.roomNights,'Selected period',CalendarDays]]:
 report==='revenue'?[['Reservation value',money(data.totalValue),'Value of reservations arriving in period',Wallet],['Recorded payments',money(data.collected),'Payments recorded against those reservations',Wallet],['Outstanding',money(Math.max(0,data.totalValue-data.collected)),'Estimated difference; not a folio ledger balance',TrendingUp],['Reservations',data.scoped.length,'Arrivals in selected period',Users]]:
 report==='cancellations'?[['Cancelled / no-show',data.cancelled.length,'Selected period',CalendarDays],['Reservations',data.scoped.length,'Other arrivals in selected period',Users],['Cancellation share',((data.cancelled.length/(data.cancelled.length+data.scoped.length||1))*100).toFixed(1)+'%','Of records in selected period',BarChart3],['Active reservations',data.active.length,'All active reservations',BedDouble]]:
 [['Reservations',data.scoped.length,'Arrivals in selected period',Users],['Forward demand',data.upcoming.length,'Upcoming arrivals within selected window',CalendarDays],['Room nights',data.roomNights,'Selected period',BedDouble],['Occupancy',data.occupancy.toFixed(1)+'%','Selected period',BarChart3]];
 const groups=report==='channels'?data.grouped:report==='guest-origin'?data.origin:null;
 const rows=Object.entries(groups||{}).sort((a,b)=>b[1]-a[1]);
 const exportCsv=()=>{const lines=[['Metric','Value'],...cards.map(([k,v])=>[k,String(v)]),['Period days',String(days)],['Generated at',new Date().toISOString()]];const csv=lines.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download='front-office-'+report+'-'+dateKey(now)+'.csv';a.click();URL.revokeObjectURL(url);};
 return <div className="h-full overflow-y-auto bg-[var(--canvas)] p-4 sm:p-6"><div className="mx-auto max-w-7xl space-y-5">
  <header className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Front Office / Statistics</div><h1 className="mt-1 text-2xl font-bold">{config.title}</h1><p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">{config.description}</p></div><div className="flex flex-wrap gap-2"><select aria-label="Reporting period" value={period} onChange={e=>setPeriod(e.target.value)} className="h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option></select><button onClick={exportCsv} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><Download size={15}/> Export summary</button></div></header>
  <nav className="flex gap-2 overflow-x-auto pb-1">{Object.entries(REPORTS).map(([key,item])=><Link key={key} to={'/frontoffice/statistics/'+key} className={'shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold '+(key===report?'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white':'border-[var(--border)] bg-[var(--surface)]')}>{item.title}</Link>)}</nav>
  {error&&<div role="alert" className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm">{error}</div>}
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label,value,detail,Icon])=><section key={label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-[var(--text-muted)]">{label}</span><Icon size={17} className="text-[var(--brand-primary)]"/></div><div className="mt-3 text-2xl font-bold tabular-nums">{loading?'—':value}</div><p className="mt-1 text-xs text-[var(--text-muted)]">{detail}</p></section>)}</div>
  {rows.length>0?<section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><h2 className="font-semibold">{report==='channels'?'Reservations by source / channel':'Guests by recorded origin'}</h2><div className="mt-4 space-y-3">{rows.map(([label,count])=><div key={label}><div className="mb-1 flex justify-between gap-3 text-sm"><span className="truncate">{label}</span><b>{count}</b></div><div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]"><div className="h-full rounded-full bg-[var(--brand-primary)]" style={{width:(count/Math.max(1,rows[0][1])*100)+'%'}}/></div></div>)}</div></section>:report==='channels'||report==='guest-origin'?<section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--text-muted)]">No source or origin details are recorded for reservations in this period. Add these details to reservation records to populate this report.</section>:null}
  {report==='forecast'&&<section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><h2 className="font-semibold">Upcoming arrivals</h2><div className="mt-3 divide-y divide-[var(--border)]">{data.upcoming.slice(0,30).map((r,i)=><div key={r.id||i} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span>{r.guestName||r.guest_name||'Guest'} · {r.roomNumber||r.room?.number||'Room not assigned'}</span><span className="text-[var(--text-muted)]">{dateKey(r.checkIn||r.arrival)}</span></div>)}{!data.upcoming.length&&<p className="py-4 text-sm text-[var(--text-muted)]">No upcoming arrivals in this window.</p>}</div></section>}
  <p className="text-xs text-[var(--text-muted)]">Reports use reservation and room data available to the signed-in property. Revenue figures are reservation-level estimates, not a substitute for settled folio, payment, POS or accounting reports. Guest nationality is shown only when explicitly recorded; missing values remain unclassified.</p>
  <div className="flex flex-wrap gap-2"><Link to="/frontoffice/dashboard" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs">Back to dashboard <ArrowUpRight size={14}/></Link></div>
 </div></div>;
}
export default function FrontOfficeStatistics(){return <PmsProvider><StatisticsContent/></PmsProvider>;}
