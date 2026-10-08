import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  CalendarCheck,
  Clock3,
  Receipt,
  TrendingUp,
  Users,
  Utensils,
} from 'lucide-react';
import { usePms } from '@/data/PmsStore';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';


function StatCard({ label, value, sub, icon: Icon, emphasis = false }) {
  return (
    <div
      className="rounded-2xl p-4 flex min-h-[116px] flex-col justify-between transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:shadow-sm"
      className="rounded-2xl p-4 flex min-h-[116px] flex-col justify-between transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:shadow-sm bg-[var(--surface)] border border-[var(--border)]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em]" className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">{label}</span>
        {Icon && <Icon size={17} aria-hidden="true" className="text-[var(--info)]" />}
      </div>
      <div>
        <div className="text-2xl font-bold font-mono tracking-tight" className="text-[var(--text)]">{value}</div>
        {sub && <div className="mt-1 text-xs" className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">{sub}</div>}
      </div>
    </div>
  );
}

const ACTIVITY_COLORS = { order: 'var(--brand-dark)', payment: 'var(--info)', reserve: 'var(--muted)' };

function SectionHeader({ title, meta, icon: Icon }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {Icon && <Icon size={16} aria-hidden="true" className="text-[var(--info)]" />}
        <h2 className="truncate text-xs font-bold uppercase tracking-[0.14em]" className="text-[var(--text)]">{title}</h2>
      </div>
      {meta && <span className="shrink-0 text-[11px] font-medium" className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">{meta}</span>}
    </div>
  );
}

export default function Dashboard({ onNavigateToPOS, onNavigateToRooms, onNavigateToReservations }) {
  const [liveActivity, setLiveActivity] = useState([]);
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const pms = usePms();
  const [summary, setSummary] = useState(null);
  const [reportLoading, setReportLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!propertyId) {
      setSummary(null);
      setLiveActivity([]);
      return undefined;
    }
    setReportLoading(true);
    Promise.allSettled([
      pmsService.getDailyPosSummary(propertyId),
      pmsService.getRecentDashboardActivity(propertyId, 8),
    ])
      .then(([summaryResult, activityResult]) => {
        if (!active) return;
        setSummary(summaryResult.status === 'fulfilled' ? summaryResult.value : null);
        setLiveActivity(activityResult.status === 'fulfilled' ? (activityResult.value || []) : []);
      })
      .finally(() => { if (active) setReportLoading(false); });
    return () => { active = false; };
  }, [propertyId]);
  const liveRooms = pms?.rooms || [];
  const liveReservations = pms?.reservations || [];
  const liveRoomCounts = liveRooms.reduce((acc, room) => { acc[room.status] = (acc[room.status] || 0) + 1; return acc; }, {});
  const liveArrivals = liveReservations.filter((r) => r.status === 'booked').length;
  const liveInHouse = liveReservations.filter((r) => r.status === 'checked-in').length;
  const liveAvailable = liveRoomCounts.available || 0;
  const liveOccupied = liveRoomCounts.occupied || 0;
  const liveRevenue = Number(summary?.total_revenue || 0);
  const liveTransactions = Number(summary?.transactions || 0);
  const liveAverageCheck = Number(summary?.average_check || 0);
  const livePayments = summary?.payment_breakdown || [];
  const liveTopItems = summary?.top_items || [];
  const revenueFormatted = reportLoading ? '—' : `KES ${liveRevenue.toLocaleString('en-KE')}`;
  const paymentTotal = livePayments.reduce((a, b) => a + Number(b.amount || 0), 0);

  return (
    <div className="flex-1 overflow-y-auto" className="bg-[var(--bg)]">
      <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-5 lg:p-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em]" className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
              <Activity size={14} aria-hidden="true" />
              Operations overview
            </div>
            <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl" className="text-[var(--text)]">Today at a glance</h1>
            <p className="mt-1 max-w-2xl text-sm" className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
              Front-office status is sourced from the PMS. Revenue and POS summaries are sourced from completed POS receipts for the current Kenya business date.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start rounded-xl border px-3 py-2 text-xs font-semibold sm:self-auto" className="bg-[var(--surface)] border-[var(--border)] text-[var(--text)]">
            <Clock3 size={14} aria-hidden="true" className="text-[var(--info)]" />
            Business day
            <span className="font-mono" className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">Today</span>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <button type="button" onClick={onNavigateToRooms} className="text-left"><StatCard label="Available rooms" value={pms.loading ? '—' : liveAvailable} sub={`${liveOccupied} occupied`} icon={CalendarCheck} emphasis /></button>
          <button type="button" onClick={onNavigateToReservations} className="text-left"><StatCard label="Arrivals / bookings" value={pms.loading ? '—' : liveArrivals} sub="Active reservations" icon={CalendarCheck} /></button>
          <StatCard label="In-house guests" value={pms.loading ? '—' : liveInHouse} sub="Checked in" icon={Users} />
          <StatCard label="POS revenue today" value={revenueFormatted} sub={`${liveTransactions.toLocaleString()} completed transactions`} icon={TrendingUp} />
          <StatCard label="Completed checks" value={reportLoading ? "—" : liveTransactions} sub="Live POS receipts" icon={Receipt} />
          <StatCard label="Average check" value={reportLoading ? "—" : `KES ${liveAverageCheck.toLocaleString("en-KE")}`} sub="Live POS receipts" icon={TrendingUp} />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr_1fr]">
          <section className="rounded-2xl p-4 sm:p-5" className="bg-[var(--surface)] border border-[var(--border)]">
            <SectionHeader title="Top sellers" meta="Live POS data" icon={TrendingUp} />
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {liveTopItems.slice(0, 5).map((item, i) => (
                <div key={i} className="flex items-center gap-3 py-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold" className="bg-[var(--brand-soft)] text-[var(--text)]">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold" className="text-[var(--text)]">{item.name}</div>
                    <div className="mt-0.5 text-xs" className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">Quantity sold</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-sm font-bold" className="text-[var(--text)]">×{item.qty}</div>
                    <div className="font-mono text-[11px]" className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">KES {Number(item.revenue || 0).toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
            {!reportLoading && !liveTopItems.length && <div className="py-8 text-center text-sm" className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">No completed POS sales today.</div>}
          </section>

          <section className="rounded-2xl p-4 sm:p-5" className="bg-[var(--surface)] border border-[var(--border)]">
            <SectionHeader title="Payments" meta="Live POS data" icon={Receipt} />
            {livePayments.map((p, i) => {
              const pct = paymentTotal ? Math.round((p.amount / paymentTotal) * 100) : 0;
              return (
                <div key={i} className="mb-4 last:mb-0">
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                    <span className="font-semibold capitalize" className="text-[var(--text)]">{p.method.replace("_", " ")}</span>
                    <span className="font-mono" className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">KES {Number(p.amount || 0).toLocaleString()} · {pct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--border)' }} aria-hidden="true"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--info)' }} /></div>
                </div>
              );
            })}
            {!reportLoading && !livePayments.length && <div className="py-8 text-center text-sm" className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">No completed POS payments today.</div>}
          </section>

          <section className="rounded-2xl p-4 sm:p-5" className="bg-[var(--surface)] border border-[var(--border)]">
            <SectionHeader title="Recent activity" meta="Latest" icon={Activity} />
            <div>
              {liveActivity.map((a, i) => (
                <div key={`${a.created_at}-${i}`} className="flex gap-3 border-b py-3 last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: ACTIVITY_COLORS[a.type] || MUTED }} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold" className="text-[var(--text)]">{a.action}</div>
                    <div className="truncate text-xs" className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">{a.detail}</div>
                  </div>
                  <time className="shrink-0 font-mono text-[11px]" className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                    {a.created_at ? new Date(a.created_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </time>
                </div>
              ))}
              {!reportLoading && !liveActivity.length && (
                <div className="py-8 text-center text-sm" className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">No recent activity.</div>
              )}
            </div>
          </section>
        </div>

        <div className="mt-4 flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between" className="bg-[var(--brand-dark)] text-[var(--on-dark)]">
          <div>
            <div className="text-sm font-bold">Need to work the dining floor?</div>
            <div className="mt-1 text-xs text-white/60">Open the POS workspace to manage tables, orders, bills, and payments.</div>
          </div>
          <button type="button" onClick={onNavigateToPOS} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition-colors hover:bg-[var(--brand-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-dark)]" className="bg-[var(--brand-primary)] text-[var(--action-text)]">
            Open POS <ArrowUpRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}