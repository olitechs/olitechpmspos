import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Users, ShieldCheck, Building2, RefreshCw, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { platformService } from '@/services/platformService';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';

const ROLES = ['owner', 'admin', 'manager', 'reception', 'cashier', 'waiter', 'kitchen', 'housekeeping', 'maintenance', 'accountant', 'storekeeper'];

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true); else setRefreshing(true);
    setError('');
    try { setUsers(await platformService.getUserDirectory()); }
    catch (err) { setError(err.message || 'Unable to load user directory.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(true); }, [load]);
  useEffect(() => {
    const channel = supabase.channel('platform-users-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'property_users' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return users;
    return users.filter((user) => [user.email, user.full_name, user.platform_role, ...(user.property_memberships || []).map((m) => m.property_name)].filter(Boolean).some((v) => String(v).toLowerCase().includes(term)));
  }, [users, query]);

  const changeRole = async (membership, role) => {
    if (!role || role === membership.role) return;
    const key = membership.property_id + membership.user_id;
    setBusyKey(key);
    try {
      await platformService.setPropertyMember(membership.property_id, membership.user_id, role);
      toast.success('Property access role updated.');
      await load();
    } catch (err) { toast.error(err.message || 'Could not update property role.'); }
    finally { setBusyKey(''); }
  };

  const removeAccess = async (membership) => {
    if (!window.confirm(`Remove this user's access to ${membership.property_name}?`)) return;
    const key = membership.property_id + membership.user_id;
    setBusyKey(key);
    try {
      await platformService.removePropertyMember(membership.property_id, membership.user_id);
      toast.success('Property membership removed.');
      await load();
    } catch (err) { toast.error(err.message || 'Could not remove property membership.'); }
    finally { setBusyKey(''); }
  };

  return <div className="space-y-6">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><div className="flex items-center gap-2"><Users className="h-5 w-5 text-primary" /><h1 className="text-2xl font-bold text-foreground">Users & access</h1></div><p className="mt-1 text-sm text-muted-foreground">Search registered accounts across the platform and manage each user's property memberships.</p></div>
      <button type="button" onClick={() => load()} disabled={refreshing} className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh</button>
    </header>
    <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, email, platform role or property…" className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/30" /></div>
    {error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}<p className="mt-1 text-xs">Confirm the platform user-directory migration has been applied.</p></div>}
    <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{loading ? 'Loading accounts…' : `${filtered.length} of ${users.length} accounts`}</span><span>Property membership changes are audited by the existing platform RPCs.</span></div>
    <section className="space-y-3">
      {!loading && filtered.length === 0 && <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">No matching accounts found.</div>}
      {filtered.map((user) => <article key={user.user_id} className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Users className="h-5 w-5" /></div><div className="min-w-0"><div className="truncate font-semibold text-foreground">{user.full_name || 'Unnamed user'}</div><div className="truncate text-sm text-muted-foreground">{user.email}</div></div></div>
          <div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs capitalize"><ShieldCheck className="h-3 w-3" />{user.platform_role}</span><span className="rounded-full bg-muted px-2.5 py-1 text-xs">{(user.property_memberships || []).length} properties</span></div>
        </div>
        <div className="border-t border-border bg-muted/20 px-4 py-3 sm:px-5">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Building2 className="h-3.5 w-3.5" />Property access</div>
          {!user.property_memberships?.length ? <p className="text-sm text-muted-foreground">This account has no property membership.</p> : <div className="space-y-2">{user.property_memberships.map((membership) => {
            const key = membership.property_id + user.user_id;
            return <div key={membership.property_id} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0"><Link to={`/admin/properties/${membership.property_id}`} className="truncate text-sm font-semibold text-foreground hover:text-primary hover:underline">{membership.property_name}</Link><div className="mt-0.5 text-xs capitalize text-muted-foreground">{membership.property_status} · Current role: {membership.role}</div></div>
              <div className="flex flex-wrap items-center gap-2"><select aria-label={`Role at ${membership.property_name}`} value={membership.role} disabled={busyKey === key} onChange={(event) => changeRole({ ...membership, user_id: user.user_id }, event.target.value)} className="h-9 min-w-36 rounded-lg border border-border bg-background px-2 text-xs capitalize">{ROLES.map((role) => <option key={role} value={role}>{role}</option>)}</select><button type="button" title="Remove property access" aria-label={`Remove access to ${membership.property_name}`} disabled={busyKey === key} onClick={() => removeAccess({ ...membership, user_id: user.user_id })} className="inline-flex h-9 items-center gap-1 rounded-lg border border-destructive/30 px-2.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"><XCircle className="h-3.5 w-3.5" />Remove</button></div>
            </div>;
          })}</div>}
        </div>
      </article>)}
    </section>
  </div>;
}
