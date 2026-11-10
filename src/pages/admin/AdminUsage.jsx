import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, Users, ReceiptText, CalendarDays, Printer, Building2, Clock3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { platformService } from '@/services/platformService';
import { supabase } from '@/lib/supabaseClient';

const number = (value) => Number(value || 0).toLocaleString();
const dateTime = (value) => value ? new Date(value).toLocaleString() : 'No activity recorded';

function Metric({ icon: Icon, label, value, detail }) {
  return <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
    <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground"><span>{label}</span><Icon className="h-4 w-4 shrink-0" /></div>
    <div className="mt-2 text-2xl font-bold tabular-nums text-foreground">{number(value)}</div>
    {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
  </div>;
}

export default function AdminUsage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      setRows(await platformService.getPropertyUsage());
    } catch (err) {
      setError(err.message || 'Unable to load property usage.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(true); }, [load]);

  useEffect(() => {
    const channel = supabase.channel('platform-usage-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'properties' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'property_users' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fnb_print_jobs' }, () => load())
      .subscribe();
    const refreshInterval = window.setInterval(() => load(), 30000);
    return () => { window.clearInterval(refreshInterval); supabase.removeChannel(channel); };
  }, [load]);

  const totals = rows.reduce((sum, row) => ({
    properties: sum.properties + 1,
    members: sum.members + Number(row.member_count || 0),
    sessions: sum.sessions + Number(row.recently_verified_sessions || 0),
    receipts: sum.receipts + Number(row.receipts_last_24h || 0),
    reservations: sum.reservations + Number(row.reservations_last_24h || 0),
    printFailures: sum.printFailures + Number(row.failed_print_jobs_last_24h || 0),
  }), { properties: 0, members: 0, sessions: 0, receipts: 0, reservations: 0, printFailures: 0 });

  return <div className="space-y-6">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary" /><h1 className="text-2xl font-bold text-foreground">Usage & property health</h1></div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Live, property-scoped operational activity. Recent sessions are based on staff verification in the last 15 minutes; transaction counts cover the last 24 hours.</p>
      </div>
      <button type="button" onClick={() => load()} disabled={refreshing} className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh</button>
    </header>

    {error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}<p className="mt-1 text-xs">Confirm the platform usage migration has been applied to the connected Supabase project.</p></div>}

    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Metric icon={Building2} label="Properties" value={totals.properties} />
      <Metric icon={Users} label="Property members" value={totals.members} />
      <Metric icon={Activity} label="Verified sessions" value={totals.sessions} detail="Last 15 minutes" />
      <Metric icon={ReceiptText} label="POS receipts" value={totals.receipts} detail="Last 24 hours" />
      <Metric icon={CalendarDays} label="Reservations" value={totals.reservations} detail="Created in last 24 hours" />
      <Metric icon={Printer} label="Print failures" value={totals.printFailures} detail="Last 24 hours" />
    </div>

    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-4 sm:px-5">
        <div><h2 className="font-semibold text-foreground">Property activity</h2><p className="mt-1 text-xs text-muted-foreground">Select a property to open its management workspace.</p></div>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Live changes + 30-second refresh</span>
      </div>
      {loading ? <div className="p-8 text-center text-sm text-muted-foreground">Loading property usage…</div> : rows.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">No property usage records are available.</div> : <>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr>
              <th className="px-4 py-3 font-medium">Property</th><th className="px-4 py-3 font-medium">Status / plan</th><th className="px-4 py-3 text-right font-medium">Members</th><th className="px-4 py-3 text-right font-medium">Sessions · 15m</th><th className="px-4 py-3 text-right font-medium">Receipts · 24h</th><th className="px-4 py-3 text-right font-medium">Bookings · 24h</th><th className="px-4 py-3 text-right font-medium">Print errors · 24h</th><th className="px-4 py-3 font-medium">Last activity</th>
            </tr></thead>
            <tbody className="divide-y divide-border">{rows.map((row) => <tr key={row.property_id} className="hover:bg-muted/20">
              <td className="px-4 py-3"><Link className="font-semibold text-foreground hover:text-primary hover:underline" to={`/admin/properties/${row.property_id}`}>{row.property_name}</Link></td>
              <td className="px-4 py-3"><span className="capitalize">{row.property_status}</span><span className="ml-2 text-xs text-muted-foreground capitalize">{row.package_code}</span></td>
              <td className="px-4 py-3 text-right tabular-nums">{number(row.member_count)}</td><td className="px-4 py-3 text-right tabular-nums">{number(row.recently_verified_sessions)}</td><td className="px-4 py-3 text-right tabular-nums">{number(row.receipts_last_24h)}</td><td className="px-4 py-3 text-right tabular-nums">{number(row.reservations_last_24h)}</td><td className="px-4 py-3 text-right tabular-nums">{number(row.failed_print_jobs_last_24h)}</td><td className="px-4 py-3 text-xs text-muted-foreground">{dateTime(row.last_operational_activity_at)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="divide-y divide-border md:hidden">{rows.map((row) => <Link key={row.property_id} to={`/admin/properties/${row.property_id}`} className="block p-4 hover:bg-muted/20">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate font-semibold text-foreground">{row.property_name}</div><div className="mt-1 text-xs capitalize text-muted-foreground">{row.property_status} · {row.package_code}</div></div><span className="shrink-0 text-xs text-muted-foreground">Open <span aria-hidden="true">→</span></span></div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><span>Members: <b>{number(row.member_count)}</b></span><span>Sessions: <b>{number(row.recently_verified_sessions)}</b></span><span>Receipts: <b>{number(row.receipts_last_24h)}</b></span><span>Bookings: <b>{number(row.reservations_last_24h)}</b></span><span>Print failures: <b>{number(row.failed_print_jobs_last_24h)}</b></span></div>
          <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="h-3 w-3" />{dateTime(row.last_operational_activity_at)}</p>
        </Link>)}</div>
      </>}
    </section>
  </div>;
}
