import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Clock, CheckCircle2, ShieldAlert, Users, Package, ArrowRight, RefreshCw, Plus, ClipboardList, Activity, Ban, CreditCard } from 'lucide-react';
import { platformService } from '@/services/platformService';
import { PACKAGE_LABELS } from '@/lib/entitlements';

function StatCard({ icon: Icon, label, value, hint }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="text-3xl font-bold text-foreground mt-2">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function QuickAction({ to, icon: Icon, title, description }) {
  return (
    <Link to={to} className="group rounded-2xl border border-border bg-card p-5 hover:border-primary/50 hover:bg-muted/30 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Icon className="h-5 w-5" /></div>
        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
      </div>
      <div className="mt-4 font-semibold text-foreground">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{description}</div>
    </Link>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const allProperties = await platformService.listProperties();
      setStats(platformService.buildDashboardStats(allProperties));
      setProperties(allProperties);
    } catch (err) {
      setError(err.message || 'Unable to load platform data.');
    } finally {
      if (initial) setLoading(false);
      else setRefreshing(false);
    }
  };

  useEffect(() => { load(true); }, []);

  if (loading) return <div className="text-muted-foreground text-sm">Loading platform dashboard...</div>;
  if (error) return <div className="p-4 rounded-xl bg-destructive/10 text-destructive text-sm">{error}</div>;

  const pending = properties.filter((property) => property.status === 'pending');
  const active = properties.filter((property) => property.status === 'active');
  const suspended = properties.filter((property) => property.status === 'suspended');
  const recent = [...properties].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
  const packageRows = ['standard', 'premium', 'professional'].map((pkg) => ({
    pkg,
    count: stats.activePackages[pkg] || 0,
    percent: stats.activeProperties ? Math.round(((stats.activePackages[pkg] || 0) / stats.activeProperties) * 100) : 0,
  }));

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-[#090C11] p-2 text-[#FFD300]"><ShieldAlert className="h-5 w-5" /></div>
            <h1 className="text-2xl font-bold text-foreground">Platform Dashboard</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">Central control center for properties, access, subscriptions and platform activity.</p>
        </div>
        <button type="button" onClick={() => load(false)} disabled={refreshing} className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh Data
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard icon={Building2} label="Total Properties" value={stats.totalProperties} />
        <StatCard icon={Clock} label="Pending" value={stats.pendingProperties} hint="Applications awaiting review" />
        <StatCard icon={CheckCircle2} label="Active" value={stats.activeProperties} />
        <StatCard icon={Ban} label="Suspended" value={stats.suspendedProperties} />
        <StatCard icon={Users} label="Registered Owners" value={stats.activeUsers} />
      </div>

      <section>
        <div className="flex items-end justify-between gap-4 mb-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Platform Actions</h2>
            <p className="text-sm text-muted-foreground mt-1">Platform-level operations only. Property staff and receipt/printer settings remain inside each property.</p>
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <QuickAction to="/admin/properties/new" icon={Plus} title="Create Property" description="Register a property directly from the platform." />
          <QuickAction to="/admin/properties" icon={ClipboardList} title="Manage Properties" description="Approve, suspend, reactivate and assign packages." />
          <QuickAction to="/admin/audit-log" icon={Activity} title="Platform Audit Log" description="Review platform-wide administrative activity." />
        </div>
      </section>

      <section className="grid lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div><h2 className="font-semibold">Subscription Distribution</h2><p className="text-xs text-muted-foreground mt-1">Active properties by assigned package.</p></div>
            <CreditCard className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="mt-5 space-y-4">
            {packageRows.map(({ pkg, count, percent }) => (
              <div key={pkg}>
                <div className="flex justify-between text-sm mb-1"><span>{PACKAGE_LABELS[pkg]}</span><span className="font-semibold">{count}</span></div>
                <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} /></div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div><h2 className="font-semibold">Platform Status</h2><p className="text-xs text-muted-foreground mt-1">Current tenant lifecycle counts.</p></div>
            <Activity className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {[
              ['Active', active.length, 'Properties operating normally'],
              ['Pending', pending.length, 'Require platform review'],
              ['Suspended', suspended.length, 'Access currently suspended'],
              ['No Package', stats.activePackages.none || 0, 'Properties without a package'],
            ].map(([label, value, description]) => (
              <div key={label} className="rounded-xl border border-border p-4">
                <div className="text-2xl font-bold">{value}</div>
                <div className="text-sm font-medium mt-1">{label}</div>
                <div className="text-xs text-muted-foreground mt-1">{description}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <div><h2 className="text-lg font-semibold text-foreground">Pending Applications</h2><p className="text-sm text-muted-foreground mt-1">Review and assign a package to activate new properties.</p></div>
          <Link to="/admin/properties" className="text-sm font-medium text-primary hover:underline">View all properties</Link>
        </div>
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          {pending.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No pending applications.</div>
          ) : (
            <div className="divide-y divide-border">
              {pending.slice(0, 5).map((property) => (
                <div key={property.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-semibold text-foreground">{property.name}</div>
                    <div className="text-sm text-muted-foreground">{property.business_name || 'Property application'}{property.owner_email ? ` · ${property.owner_email}` : ''}</div>
                    <div className="mt-1 text-xs text-muted-foreground">Submitted {new Date(property.created_at).toLocaleString()}</div>
                  </div>
                  <Link to={`/admin/properties/${property.id}`} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">Review <ArrowRight className="h-4 w-4" /></Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <div><h2 className="text-lg font-semibold">Recently Registered Properties</h2><p className="text-sm text-muted-foreground mt-1">Latest tenant records received by the platform.</p></div>
          <Link to="/admin/properties" className="text-sm font-medium text-primary hover:underline">Manage</Link>
        </div>
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          {recent.length === 0 ? <div className="p-6 text-sm text-muted-foreground">No properties registered yet.</div> : (
            <div className="divide-y divide-border">
              {recent.map((property) => (
                <Link key={property.id} to={`/admin/properties/${property.id}`} className="flex items-center justify-between gap-4 p-4 hover:bg-muted/30">
                  <div className="min-w-0"><div className="font-medium truncate">{property.name}</div><div className="text-xs text-muted-foreground">{property.owner_email || 'No owner email'}</div></div>
                  <div className="flex items-center gap-3 shrink-0"><span className="text-xs capitalize rounded-full bg-muted px-2.5 py-1">{property.status}</span><ArrowRight className="h-4 w-4 text-muted-foreground" /></div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
