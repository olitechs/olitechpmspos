import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, BedDouble, CalendarPlus, ClipboardList, LogIn, LogOut, Sparkles, Wallet, Users } from 'lucide-react';
import { PmsProvider, usePms } from '@/data/PmsStore';

const keyOf = date => { const d=new Date(date); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); };
const todayKey = () => keyOf(new Date());

function DashboardContent() {
  const { rooms=[], reservations=[], loading, error } = usePms();
  const today = todayKey();
  const stats = useMemo(() => {
    const active = reservations.filter(r => r.status !== 'cancelled');
    const arrivals = active.filter(r => String(r.checkIn || r.arrival || '').slice(0,10) === today);
    const departures = active.filter(r => String(r.checkOut || r.departure || '').slice(0,10) === today);
    const inHouse = active.filter(r => String(r.checkIn || r.arrival || '').slice(0,10) <= today && String(r.checkOut || r.departure || '').slice(0,10) > today && r.bookingStatus !== 'checked_out');
    const unpaid = active.filter(r => Number(r.amountPaid || 0) <= 0 && Number(r.totalAmount || 0) > 0);
    const partial = active.filter(r => Number(r.amountPaid || 0) > 0 && Number(r.amountPaid || 0) < Number(r.totalAmount || 0));
    const expiring = active.filter(r => r.optionExpiresAt && new Date(r.optionExpiresAt).getTime() > Date.now() && new Date(r.optionExpiresAt).getTime() < Date.now()+6*60*60*1000);
    const occupied = rooms.filter(r => ['booked','occupied'].includes(String(r.status||'').toLowerCase()));
    const dirty = rooms.filter(r => String(r.status||'').toLowerCase()==='dirty');
    const out = rooms.filter(r => ['maintenance','out_of_service','blocked'].includes(String(r.status||'').toLowerCase()));
    const next7 = Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()+i);const k=keyOf(d);return active.filter(r=>String(r.checkIn||r.arrival||'').slice(0,10)<=k&&String(r.checkOut||r.departure||'').slice(0,10)>k).length;});
    const month = new Date(); month.setDate(1); const monthKey=keyOf(month);
    const monthNights = active.reduce((sum,r)=>{const start=String(r.checkIn||r.arrival||'').slice(0,10);const end=String(r.checkOut||r.departure||'').slice(0,10);return sum+Math.max(0,Math.round((new Date(end)-new Date(start))/86400000));},0);
    return {arrivals,departures,inHouse,unpaid,partial,expiring,occupied,dirty,out,next7,monthNights,rooms:rooms.length};
  },[rooms,reservations,today]);
  const occupancy = (n) => stats.rooms ? Math.round(n/stats.rooms*100) : 0;
  const Card = ({title,value,detail,icon:Icon,to,tone='teal'}) => <Link to={to} className="group min-w-0 rounded-xl border border-[var(--border)] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-xs font-semibold text-[var(--text-muted)]">{title}</div><div className="mt-2 text-3xl font-bold tabular-nums text-[var(--text)]">{loading?'—':value}</div><div className="mt-1 text-xs text-[var(--text-muted)]">{detail}</div></div><span className={['rounded-lg p-2',tone==='orange'?'bg-orange-50 text-orange-700':tone==='green'?'bg-emerald-50 text-emerald-700':'bg-[var(--surface-2)] text-[var(--brand-primary)]'].join(' ')}><Icon size={19}/></span></div><div className="mt-3 flex items-center gap-1 text-xs font-semibold text-[var(--brand-primary)]">Open <ArrowRight size={13}/></div></Link>;
  return <div className="h-full overflow-y-auto bg-[var(--canvas)] p-4 sm:p-5 lg:p-6">
    <div className="mx-auto max-w-[1500px]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Front Office / PMS</p><h1 className="mt-1 text-2xl font-bold text-[var(--text)]">Room Dashboard</h1><p className="mt-1 text-sm text-[var(--text-muted)]">Today's operational overview · {new Date().toLocaleDateString('en-GB')}</p></div><div className="flex flex-wrap gap-2"><Link to="/frontoffice/check-in/walk-in" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--brand-primary)] px-3 text-sm font-semibold text-white"><CalendarPlus size={16}/> New Reservation</Link><Link to="/frontoffice/room-planner" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-3 text-sm font-semibold"><BedDouble size={16}/> Open Planner</Link></div></div>
      {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card title="Today's Arrivals" value={stats.arrivals.length} detail="Expected check-ins" icon={LogIn} to="/frontoffice/check-in/arrivals"/>
        <Card title="Today's Departures" value={stats.departures.length} detail="Expected check-outs" icon={LogOut} to="/frontoffice/check-in/departures"/>
        <Card title="In-House Guests" value={stats.inHouse.length} detail="Current stays" icon={Users} to="/frontoffice/check-in/in-house"/>
        <Card title="Rooms Occupied / Booked" value={stats.occupied.length} detail={stats.rooms+' rooms in inventory'} icon={BedDouble} to="/frontoffice/rooms"/>
        <Card title="Unpaid Reservations" value={stats.unpaid.length} detail="No amount paid" icon={Wallet} tone="orange" to="/frontoffice/reservations"/>
        <Card title="Partially Paid" value={stats.partial.length} detail="Outstanding balances" icon={Wallet} tone="orange" to="/frontoffice/reservations"/>
        <Card title="Options Expiring Soon" value={stats.expiring.length} detail="Within the next 6 hours" icon={AlertTriangle} tone="orange" to="/frontoffice/room-planner"/>
        <Card title="Dirty Rooms" value={stats.dirty.length} detail="Housekeeping follow-up" icon={Sparkles} to="/frontoffice/services/housekeeping"/>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <section className="rounded-xl border border-[var(--border)] bg-white p-4"><h2 className="font-semibold">Occupancy</h2><div className="mt-3 space-y-3"><div><div className="flex justify-between text-xs"><span>Today</span><b>{occupancy(stats.inHouse.length)}%</b></div><div className="mt-1 h-2 rounded-full bg-[var(--surface-2)]"><div className="h-2 rounded-full bg-[var(--brand-primary)]" style={{width:occupancy(stats.inHouse.length)+'%'}}/></div></div><div><div className="flex justify-between text-xs"><span>Next 7 days · average</span><b>{occupancy(Math.round(stats.next7.reduce((a,b)=>a+b,0)/7))}%</b></div><div className="mt-1 h-2 rounded-full bg-[var(--surface-2)]"><div className="h-2 rounded-full bg-[var(--brand-primary)]" style={{width:occupancy(Math.round(stats.next7.reduce((a,b)=>a+b,0)/7))+'%'}}/></div></div><div><div className="flex justify-between text-xs"><span>Month · room nights booked</span><b>{stats.monthNights}</b></div></div></div></section>
        <section className="rounded-xl border border-[var(--border)] bg-white p-4"><h2 className="font-semibold">Room condition</h2><div className="mt-3 space-y-2 text-sm"><div className="flex justify-between"><span>Available</span><b>{Math.max(0,stats.rooms-stats.occupied.length-stats.out.length)}</b></div><div className="flex justify-between"><span>Dirty</span><b>{stats.dirty.length}</b></div><div className="flex justify-between"><span>Out of order / maintenance</span><b>{stats.out.length}</b></div></div><Link to="/frontoffice/services/housekeeping" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand-primary)]">Housekeeping Board <ArrowRight size={13}/></Link></section>
        <section className="rounded-xl border border-[var(--border)] bg-white p-4"><h2 className="font-semibold">Operational alerts</h2><div className="mt-3 space-y-2 text-sm"><p>{stats.expiring.length} option(s) expiring within 6 hours</p><p>{stats.unpaid.length} unpaid reservation(s)</p><p>{stats.partial.length} partially paid reservation(s)</p><p>{stats.out.length} room(s) out of order</p></div><p className="mt-3 text-xs text-[var(--text-muted)]">Revenue, POS room-charge totals and overbooking alerts will appear here when the corresponding reporting feeds are connected.</p></section>
      </div>
      <div className="mt-5 flex flex-wrap gap-2"><Link to="/frontoffice/check-in/walk-in" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-3 text-sm"><LogIn size={15}/> Walk-in Check-in</Link><Link to="/frontoffice/room-planner" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-3 text-sm"><CalendarPlus size={15}/> Add Closure / Planner</Link><Link to="/frontoffice/reservations" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-3 text-sm"><ClipboardList size={15}/> Reservations</Link></div>
    </div>
  </div>;
}

export default function FrontOfficeDashboard() {
  return <PmsProvider><DashboardContent/></PmsProvider>;
}
