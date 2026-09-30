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
import { NAVY, TEAL, TEAL_DARK, SAND, SURFACE, BORDER, MUTED, SLATE } from '@/data/themePalette';

function StatCard({ label, value, sub, icon: Icon, emphasis = false }) {
  return (
    <div
      className="rounded-2xl p-4 flex min-h-[116px] flex-col justify-between transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:shadow-sm"
      style={{ background: SURFACE, border: `1px solid ${emphasis ? TEAL_DARK : BORDER}` }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: MUTED }}>{label}</span>
        {Icon && <Icon size={17} aria-hidden="true" style={{ color: emphasis ? NAVY : TEAL_DARK }} />}
      </div>
      <div>
        <div className="text-2xl font-bold font-mono tracking-tight" style={{ color: NAVY }}>{value}</div>
        {sub && <div className="mt-1 text-xs" style={{ color: MUTED }}>{sub}</div>}
      </div>
    </div>
  );
}

const ACTIVITY_COLORS = { order: NAVY, payment: TEAL_DARK, reserve: SLATE };

function SectionHeader({ title, meta, icon: Icon }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {Icon && <Icon size={16} aria-hidden="true" style={{ color: TEAL_DARK }} />}
        <h2 className="truncate text-xs font-bold uppercase tracking-[0.14em]" style={{ color: NAVY }}>{title}</h2>
      </div>
      {meta && <span className="shrink-0 text-[11px] font-medium" style={{ color: MUTED }}>{meta}</span>}
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
    <div className="flex-1 overflow-y-auto" style={{ background: SAND }}>
      <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-5 lg:p-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: MUTED }}>
              <Activity size={14} aria-hidden="true" />
              Operations overview
            </div>
            <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl" style={{ color: NAVY }}>Today at a glance</h1>
            <p className="mt-1 max-w-2xl text-sm" style={{ color: MUTED }}>
              Front-office status is sourced from the PMS. Revenue and POS summaries are sourced from completed POS receipts for the current Kenya business date.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start rounded-xl border px-3 py-2 text-xs font-semibold sm:self-auto" style={{ background: SURFACE, borderColor: BORDER, color: NAVY }}>
            <Clock3 size={14} aria-hidden="true" style={{ color: TEAL_DARK }} />
            Business day
            <span className="font-mono" style={{ color: MUTED }}>Today</span>
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
          <section className="rounded-2xl p-4 sm:p-5" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
            <SectionHeader title="Top sellers" meta="Live POS data" icon={TrendingUp} />
            <div className="divide-y" style={{ borderColor: BORDER }}>
              {liveTopItems.slice(0, 5).map((item, i) => (
                <div key={i} className="flex items-center gap-3 py-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold" style={{ background: i === 0 ? TEAL : SAND, color: NAVY }}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold" style={{ color: NAVY }}>{item.name}</div>
                    <div className="mt-0.5 text-xs" style={{ color: MUTED }}>Quantity sold</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-sm font-bold" style={{ color: NAVY }}>×{item.qty}</div>
                    <div className="font-mono text-[11px]" style={{ color: MUTED }}>KES {Number(item.revenue || 0).toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
            {!reportLoading && !liveTopItems.length && <div className="py-8 text-center text-sm" style={{ color: MUTED }}>No completed POS sales today.</div>}
          </section>

          <section className="rounded-2xl p-4 sm:p-5" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
            <SectionHeader title="Payments" meta="Live POS data" icon={Receipt} />
            {livePayments.map((p, i) => {
              const pct = paymentTotal ? Math.round((p.amount / paymentTotal) * 100) : 0;
              return (
                <div key={i} className="mb-4 last:mb-0">
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                    <span className="font-semibold capitalize" style={{ color: NAVY }}>{p.method.replace("_", " ")}</span>
                    <span className="font-mono" style={{ color: MUTED }}>KES {Number(p.amount || 0).toLocaleString()} · {pct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full" style={{ background: BORDER }} aria-hidden="true"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: TEAL_DARK }} /></div>
                </div>
              );
            })}
            {!reportLoading && !livePayments.length && <div className="py-8 text-center text-sm" style={{ color: MUTED }}>No completed POS payments today.</div>}
          </section>

          <section className="rounded-2xl p-4 sm:p-5" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
            <SectionHeader title="Recent activity" meta="Latest" icon={Activity} />
            <div>
              {liveActivity.map((a, i) => (
                <div key={`${a.created_at}-${i}`} className="flex gap-3 border-b py-3 last:border-b-0" style={{ borderColor: BORDER }}>
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: ACTIVITY_COLORS[a.type] || MUTED }} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold" style={{ color: NAVY }}>{a.action}</div>
                    <div className="truncate text-xs" style={{ color: MUTED }}>{a.detail}</div>
                  </div>
                  <time className="shrink-0 font-mono text-[11px]" style={{ color: MUTED }}>
                    {a.created_at ? new Date(a.created_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </time>
                </div>
              ))}
              {!reportLoading && !liveActivity.length && (
                <div className="py-8 text-center text-sm" style={{ color: MUTED }}>No recent activity.</div>
              )}
            </div>
          </section>
        </div>

        <div className="mt-4 flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between" style={{ background: NAVY, color: '#FFFFFF' }}>
          <div>
            <div className="text-sm font-bold">Need to work the dining floor?</div>
            <div className="mt-1 text-xs text-white/60">Open the POS workspace to manage tables, orders, bills, and payments.</div>
          </div>
          <button type="button" onClick={onNavigateToPOS} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition-colors hover:bg-[#FFEE32] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD300] focus-visible:ring-offset-2 focus-visible:ring-offset-[#090C11]" style={{ background: TEAL, color: NAVY }}>
            Open POS <ArrowUpRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}