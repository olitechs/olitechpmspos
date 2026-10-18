import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BedDouble,
  CalendarCheck,
  ChevronRight,
  LogIn,
  LogOut,
  Receipt,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react';
import { usePms } from '@/data/PmsStore';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const TZ = 'Africa/Nairobi';
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // YYYY-MM-DD
const sameDay = (value, key) => String(value || '').slice(0, 10) === key;
const kes = (n) => `KES ${Number(n || 0).toLocaleString('en-KE')}`;

const ROOM_GROUPS = [
  { key: 'occupied', label: 'Occupied', color: 'var(--stay-occupied)', statuses: ['occupied'] },
  { key: 'available', label: 'Vacant clean', color: 'var(--room-clean)', statuses: ['available'] },
  { key: 'dirty', label: 'Vacant dirty', color: 'var(--room-dirty)', statuses: ['dirty', 'cleaning'] },
  { key: 'ooo', label: 'Out of order', color: 'var(--stay-closed)', statuses: ['maintenance', 'out_of_service', 'blocked'] },
];

const ACTIVITY_COLORS = { order: 'var(--text)', payment: 'var(--action)', reserve: 'var(--info)' };

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

function Card({ className = '', children }) {
  return (
    <section className={`rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)] ${className}`}>
      {children}
    </section>
  );
}

function CardHeader({ title, meta, icon: Icon, action }) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {Icon && <Icon size={15} aria-hidden="true" className="shrink-0 text-[var(--muted)]" />}
        <h2 className="truncate text-sm font-semibold text-[var(--text)]">{title}</h2>
        {meta !== undefined && meta !== '' && <span className="shrink-0 text-xs text-[var(--muted)]">{meta}</span>}
      </div>
      {action}
    </header>
  );
}

function EmptyState({ children }) {
  return <div className="px-4 py-8 text-center text-sm text-[var(--muted)]">{children}</div>;
}

/** Primary KPI tile. Renders as a button when it navigates somewhere. */
function Kpi({ label, value, sub, icon: Icon, onClick, accent = false }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`group flex min-h-[112px] w-full flex-col justify-between rounded-lg border bg-[var(--surface)] p-4 text-left shadow-[var(--shadow)] ${
        accent ? 'border-[var(--action)]' : 'border-[var(--border)]'
      } ${onClick ? 'hover:border-[var(--muted)]' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium text-[var(--muted)]">{label}</span>
        <span className="flex items-center gap-1 text-[var(--muted)]">
          {Icon && <Icon size={16} aria-hidden="true" />}
          {onClick && <ChevronRight size={14} aria-hidden="true" className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />}
        </span>
      </div>
      <div>
        <div className="font-mono text-[28px] font-semibold leading-none tracking-tight text-[var(--text)]">{value}</div>
        {sub && <div className="mt-1.5 text-xs text-[var(--muted)]">{sub}</div>}
      </div>
    </Tag>
  );
}

function MiniStat({ label, value, sub }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="mt-1 truncate font-mono text-xl font-semibold text-[var(--text)]">{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

function MovementList({ title, icon, rows, emptyText, onViewAll, timeLabel }) {
  return (
    <Card className="flex min-h-[260px] flex-col">
      <CardHeader
        title={title}
        icon={icon}
        meta={rows.length}
        action={onViewAll && (
          <button type="button" onClick={onViewAll} className="inline-flex min-h-0 items-center gap-1 text-xs font-medium text-[var(--info)] hover:underline">
            View all <ChevronRight size={13} aria-hidden="true" />
          </button>
        )}
      />
      {rows.length === 0 ? (
        <EmptyState>{emptyText}</EmptyState>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {rows.slice(0, 6).map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex h-8 min-w-[44px] items-center justify-center rounded-md bg-[var(--bg)] px-2 font-mono text-xs font-semibold text-[var(--text)]">
                {r.roomNumber || '—'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-[var(--text)]">{r.guest || 'Guest'}</div>
                <div className="truncate text-xs text-[var(--muted)]">
                  {r.partySize ? `${r.partySize} guest${Number(r.partySize) === 1 ? '' : 's'}` : timeLabel}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 6 && <div className="mt-auto border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)]">+${rows.length - 6} more</div>}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export default function Dashboard({ onNavigateToPOS, onNavigateToRooms, onNavigateToReservations }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const pms = usePms();
  const propertyId = user?.property?.id;

  const [summary, setSummary] = useState(null);
  const [liveActivity, setLiveActivity] = useState([]);
  const [reportLoading, setReportLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setReportLoading(true);
    const [summaryResult, activityResult] = await Promise.allSettled([
      pmsService.getDailyPosSummary(propertyId),
      pmsService.getRecentDashboardActivity(propertyId, 8),
    ]);
    setSummary(summaryResult.status === 'fulfilled' ? summaryResult.value : null);
    setLiveActivity(activityResult.status === 'fulfilled' ? (activityResult.value || []) : []);
    setUpdatedAt(new Date());
    setReportLoading(false);
  }, [propertyId]);

  useEffect(() => {
    if (!propertyId) {
      setSummary(null);
      setLiveActivity([]);
      return undefined;
    }
    load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, [propertyId, load]);

  /* ---- Front office figures (PMS) ---- */
  const today = dayKey(new Date());
  const rooms = pms?.rooms || [];
  const reservations = pms?.reservations || [];
  const pmsLoading = !!pms?.loading;

  const fo = useMemo(() => {
    const counts = Object.fromEntries(ROOM_GROUPS.map((g) => [g.key, 0]));
    rooms.forEach((room) => {
      const group = ROOM_GROUPS.find((g) => g.statuses.includes(room.status));
      if (group) counts[group.key] += 1;
    });
    const sellable = rooms.length - counts.ooo;
    const occupancy = sellable > 0 ? Math.round((counts.occupied / sellable) * 100) : 0;
    const arrivals = reservations.filter((r) => r.status === 'booked' && sameDay(r.arrival, today));
    const departures = reservations.filter((r) => r.status === 'checked-in' && sameDay(r.departure, today));
    const inHouse = reservations.filter((r) => r.status === 'checked-in');
    const inHouseGuests = inHouse.reduce((sum, r) => sum + (Number(r.partySize) || 1), 0);
    return { counts, sellable, occupancy, arrivals, departures, inHouse, inHouseGuests, total: rooms.length };
  }, [rooms, reservations, today]);

  /* ---- POS figures ---- */
  const revenue = Number(summary?.total_revenue || 0);
  const transactions = Number(summary?.transactions || 0);
  const averageCheck = Number(summary?.average_check || 0);
  const payments = summary?.payment_breakdown || [];
  const topItems = summary?.top_items || [];
  const paymentTotal = payments.reduce((a, b) => a + Number(b.amount || 0), 0);

  /* ---- Navigation (works in both /backoffice and /frontoffice) ---- */
  const goRooms = onNavigateToRooms || (() => navigate('/frontoffice/room-planner'));
  const goReservations = onNavigateToReservations || (() => navigate('/frontoffice/reservations'));
  const goPOS = onNavigateToPOS || (() => navigate('/pos'));

  const dash = (v) => (pmsLoading ? '—' : v);
  const posDash = (v) => (reportLoading && !summary ? '—' : v);
  const dateLabel = new Intl.DateTimeFormat('en-KE', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-5 lg:p-6">
        {/* ===== Header: context + actions ===== */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium text-[var(--muted)]">{dateLabel}</p>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-[var(--text)]">Today at a glance</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {updatedAt && (
              <span className="mr-1 text-xs text-[var(--muted)]">
                Updated {updatedAt.toLocaleTimeString('en-KE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button
              type="button"
              onClick={load}
              disabled={reportLoading}
              className="global-secondary-button inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium disabled:opacity-50"
            >
              <RefreshCw size={14} aria-hidden="true" className={reportLoading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button
              type="button"
              onClick={goPOS}
              className="global-primary-button inline-flex min-h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold"
            >
              Open POS <ArrowUpRight size={15} aria-hidden="true" />
            </button>
          </div>
        </header>

        {pms?.error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-[var(--warning)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)]">
            <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--warning)]" />
            <span>{String(pms.error)}</span>
          </div>
        )}

        {/* ===== 1. Front office: the command-center KPIs ===== */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Kpi
            accent
            label="Occupancy"
            icon={BedDouble}
            value={dash(`${fo.occupancy}%`)}
            sub={dash(`${fo.counts.occupied} of ${fo.sellable} rooms sold`)}
            onClick={goRooms}
          />
          <Kpi
            label="Arrivals today"
            icon={LogIn}
            value={dash(fo.arrivals.length)}
            sub="Booked, awaiting check-in"
            onClick={goReservations}
          />
          <Kpi
            label="Departures today"
            icon={LogOut}
            value={dash(fo.departures.length)}
            sub="Checked-in, due out"
            onClick={goReservations}
          />
          <Kpi
            label="In-house guests"
            icon={Users}
            value={dash(fo.inHouseGuests)}
            sub={dash(`${fo.inHouse.length} occupied room${fo.inHouse.length === 1 ? '' : 's'}`)}
            onClick={goRooms}
          />
        </div>

        {/* ===== 2. Operations: movements + room status ===== */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:col-span-8">
            <MovementList
              title="Arrivals"
              icon={LogIn}
              rows={fo.arrivals}
              emptyText="No arrivals expected today."
              timeLabel="Awaiting check-in"
              onViewAll={goReservations}
            />
            <MovementList
              title="Departures"
              icon={LogOut}
              rows={fo.departures}
              emptyText="No departures due today."
              timeLabel="Due out today"
              onViewAll={goReservations}
            />
          </div>

          <Card className="xl:col-span-4">
            <CardHeader title="Room status" icon={CalendarCheck} meta={pmsLoading ? '' : `${fo.total} rooms`} />
            <div className="p-4">
              <div
                className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--border)]"
                role="img"
                aria-label={ROOM_GROUPS.map((g) => `${g.label}: ${fo.counts[g.key]}`).join(', ')}
              >
                {fo.total > 0 && ROOM_GROUPS.map((g) => (
                  <div key={g.key} style={{ width: `${(fo.counts[g.key] / fo.total) * 100}%`, background: g.color }} />
                ))}
              </div>
              <ul className="mt-4 space-y-2.5">
                {ROOM_GROUPS.map((g) => (
                  <li key={g.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2 text-[var(--text)]">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: g.color }} aria-hidden="true" />
                      {g.label}
                    </span>
                    <span className="font-mono font-semibold text-[var(--text)]">{dash(fo.counts[g.key])}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={goRooms}
                className="mt-4 inline-flex min-h-0 items-center gap-1 text-xs font-medium text-[var(--info)] hover:underline"
              >
                Open room planner <ChevronRight size={13} aria-hidden="true" />
              </button>
            </div>
          </Card>
        </div>

        {/* ===== 3. Revenue & POS (secondary) ===== */}
        <Card>
          <CardHeader title="Restaurant & POS today" icon={Receipt} meta="Completed receipts" />
          <div className="grid grid-cols-1 divide-y divide-[var(--border)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <MiniStat label="POS revenue" value={posDash(kes(revenue))} />
            <MiniStat label="Completed checks" value={posDash(transactions.toLocaleString())} />
            <MiniStat label="Average check" value={posDash(kes(averageCheck))} />
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card>
            <CardHeader title="Top sellers" icon={TrendingUp} />
            {topItems.length === 0 ? (
              <EmptyState>{reportLoading ? 'Loading…' : 'No completed POS sales today.'}</EmptyState>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {topItems.slice(0, 5).map((item, i) => (
                  <li key={`${item.name}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-5 shrink-0 text-center font-mono text-xs font-semibold text-[var(--muted)]">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text)]">{item.name}</span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-sm font-semibold text-[var(--text)]">×{item.qty}</span>
                      <span className="block font-mono text-[11px] text-[var(--muted)]">{kes(item.revenue)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Payment methods" icon={Receipt} />
            {payments.length === 0 ? (
              <EmptyState>{reportLoading ? 'Loading…' : 'No completed POS payments today.'}</EmptyState>
            ) : (
              <ul className="space-y-4 p-4">
                {payments.map((p, i) => {
                  const pct = paymentTotal ? Math.round((Number(p.amount || 0) / paymentTotal) * 100) : 0;
                  return (
                    <li key={`${p.method}-${i}`}>
                      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                        <span className="font-medium capitalize text-[var(--text)]">{String(p.method || '').replace(/_/g, ' ')}</span>
                        <span className="font-mono text-xs text-[var(--muted)]">{kes(p.amount)} · {pct}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[var(--border)]" aria-hidden="true">
                        <div className="h-full rounded-full bg-[var(--action)]" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Recent activity" icon={Activity} />
            {liveActivity.length === 0 ? (
              <EmptyState>{reportLoading ? 'Loading…' : 'No recent activity.'}</EmptyState>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {liveActivity.map((a, i) => (
                  <li key={`${a.created_at}-${i}`} className="flex gap-3 px-4 py-2.5">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: ACTIVITY_COLORS[a.type] || 'var(--muted)' }} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-[var(--text)]">{a.action}</div>
                      <div className="truncate text-xs text-[var(--muted)]">{a.detail}</div>
                    </div>
                    <time className="shrink-0 font-mono text-[11px] text-[var(--muted)]">
                      {a.created_at ? new Date(a.created_at).toLocaleTimeString('en-KE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '—'}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <p className="pb-2 text-xs text-[var(--muted)]">
          Room and guest figures come from the PMS. Revenue and POS figures come from completed POS receipts for the current Kenya business date.
        </p>
      </div>
    </div>
  );
}
