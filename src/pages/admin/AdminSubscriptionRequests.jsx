import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Inbox, Mail, RefreshCw } from 'lucide-react';
import { platformService } from '@/services/platformService';

function statusClass(value) {
  const status = String(value || '').toLowerCase();
  if (status === 'sent') return 'bg-[var(--success-soft)] text-[var(--success-text)]';
  if (status === 'failed') return 'bg-[var(--danger-soft)] text-[var(--danger-text)]';
  return 'bg-[var(--warning-soft)] text-[var(--warning-text)]';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : '—';
}

export default function AdminSubscriptionRequests() {
  const [view, setView] = useState('subscription');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isDemoView = view === 'demo';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRequests(isDemoView
        ? await platformService.listDemoRequests()
        : await platformService.listSubscriptionRequests());
    } catch (err) {
      setError(err?.message || (isDemoView
        ? 'Unable to load demo requests.'
        : 'Unable to load subscription requests.'));
    } finally {
      setLoading(false);
    }
  }, [isDemoView]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{isDemoView ? 'Demo Requests' : 'Subscription Requests'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isDemoView
              ? 'Public demo enquiries submitted from the OliTechs homepage.'
              : 'Subscribe, upgrade and renewal requests sent by property owners and administrators.'}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-foreground hover:bg-muted"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setView('subscription')}
          aria-pressed={!isDemoView}
          className={`rounded-xl px-4 py-2 text-sm font-bold ${!isDemoView ? 'bg-[var(--primary)] text-[var(--white)]' : 'border border-border bg-card text-foreground hover:bg-muted'}`}
        >
          Subscription requests
        </button>
        <button
          type="button"
          onClick={() => setView('demo')}
          aria-pressed={isDemoView}
          className={`rounded-xl px-4 py-2 text-sm font-bold ${isDemoView ? 'bg-[var(--primary)] text-[var(--white)]' : 'border border-border bg-card text-foreground hover:bg-muted'}`}
        >
          Demo requests
        </button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger-text)]">{error}</div>}

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3">Requested</th>
              <th className="px-4 py-3">Property</th>
              <th className="px-4 py-3">{isDemoView ? 'Visitor' : 'Request'}</th>
              <th className="px-4 py-3">{isDemoView ? 'Interest' : 'Contact'}</th>
              <th className="px-4 py-3">Message</th>
              <th className="px-4 py-3">Delivery</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading requests…</td></tr>
            )}
            {!loading && requests.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground"><Inbox className="mx-auto h-6 w-6" aria-hidden="true" /><span className="mt-2 block">No {isDemoView ? 'demo' : 'subscription'} requests yet.</span></td></tr>
            )}
            {!loading && requests.map((request) => (
              <tr key={request.id} className="border-b border-border last:border-b-0 align-top">
                <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(request.requested_at)}</td>
                {isDemoView ? (
                  <>
                    <td className="px-4 py-3">
                      <div className="font-bold text-foreground">{request.property_name || 'Unnamed property'}</div>
                      <div className="mt-1 text-xs text-muted-foreground capitalize">Source: {String(request.source || 'homepage').replaceAll('_', ' ')}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground">{request.requester_name || '—'}</div>
                      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Mail className="h-3 w-3" aria-hidden="true" />{request.requester_email || '—'}</div>
                      {request.contact_phone && <div className="text-xs text-muted-foreground">{request.contact_phone}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold capitalize text-foreground">{request.requested_package || 'Not sure yet'}</div>
                      <div className="mt-1 text-xs text-muted-foreground capitalize">{request.billing_cycle || 'Cycle not recorded'}</div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-3">
                      <Link className="font-bold text-foreground hover:underline" to={`/admin/properties/${request.property_id}`}>
                        {request.property_name || 'Unnamed property'}
                      </Link>
                      <div className="mt-1 text-xs text-muted-foreground">Current: {String(request.subscription_status || '—').replaceAll('_', ' ')}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold capitalize text-foreground">{String(request.request_kind || 'renewal').replaceAll('_', ' ')}</div>
                      <div className="mt-1 text-xs text-muted-foreground capitalize">{request.requested_package || 'Package not recorded'}</div>
                      <div className="text-xs text-muted-foreground capitalize">{request.billing_cycle || '—'} billing</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground">{request.requester_name || '—'}</div>
                      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Mail className="h-3 w-3" aria-hidden="true" />{request.requester_email || '—'}</div>
                      {request.contact_phone && <div className="text-xs text-muted-foreground">{request.contact_phone}</div>}
                    </td>
                  </>
                )}
                <td className="px-4 py-3 text-xs text-muted-foreground">{request.request_notes || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold capitalize ${statusClass(request.notification_status)}`}>
                    {request.notification_status === 'sent' && <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
                    {request.notification_status || 'pending'}
                  </span>
                  <div className="mt-1 text-xs font-semibold capitalize text-foreground">{request.status || 'pending'}</div>
                  {request.notification_error && <div className="mt-1 text-xs text-[var(--danger-text)]">{request.notification_error}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
