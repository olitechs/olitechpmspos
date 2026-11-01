import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, RotateCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import SettingsPrinters from '@/pages/SettingsPrinters';
import { supabase } from '@/lib/supabaseClient';
import { listFnbPrintJobs, retryFnbPrintJob } from '@/services/printService';

/**
 * The production schema uses property_printers, printer_assignments and
 * fnb_print_jobs. Keep this route on that property-scoped implementation;
 * do not hydrate the obsolete workspace/store printerGroups schema here.
 */
export default function KitchenPrintersPage() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [failedJobs, setFailedJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [retryingJob, setRetryingJob] = useState(null);

  const loadFailedJobs = useCallback(async () => {
    if (!propertyId) {
      setFailedJobs([]);
      return;
    }
    setLoadingJobs(true);
    try {
      const rows = await listFnbPrintJobs(propertyId, { status: 'failed', limit: 25 });
      setFailedJobs(Array.isArray(rows) ? rows : []);
    } catch (error) {
      toast.error(error?.message || 'Unable to load failed print jobs.');
    } finally {
      setLoadingJobs(false);
    }
  }, [propertyId]);

  useEffect(() => {
    loadFailedJobs();
    if (!propertyId) return undefined;
    let active = true;
    const refresh = async () => {
      try {
        const rows = await listFnbPrintJobs(propertyId, { status: 'failed', limit: 25 });
        if (active) setFailedJobs(Array.isArray(rows) ? rows : []);
      } catch (error) {
        console.warn('[KitchenPrintersPage] print recovery refresh failed', error);
      }
    };
    const channel = supabase
      .channel('fnb-print-recovery-' + propertyId)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'fnb_print_jobs',
        filter: 'property_id=eq.' + propertyId,
      }, refresh)
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [propertyId, loadFailedJobs]);

  const retry = async (job) => {
    if (!propertyId || !job?.id) return;
    setRetryingJob(job.id);
    try {
      const result = await retryFnbPrintJob(job.id, propertyId);
      if (!result?.ok) throw new Error(result?.friendlyError || 'Print retry failed.');
      toast.success('Print job queued for retry.');
      await loadFailedJobs();
    } catch (error) {
      toast.error(error?.message || 'Unable to retry print job.');
    } finally {
      setRetryingJob(null);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsPrinters />
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-base font-medium text-[var(--text)]">Failed kitchen print jobs</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Review and retry failed F&B print jobs for this property.</p>
          </div>
          <button type="button" onClick={loadFailedJobs} disabled={loadingJobs}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-sm text-[var(--text)] disabled:opacity-50">
            <RefreshCw size={14} className={loadingJobs ? 'animate-spin' : ''} /> Refresh
          </button>
        </header>
        {failedJobs.length ? (
          <ul className="divide-y divide-[var(--border)]">
            {failedJobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-[var(--text)]">
                    <AlertCircle size={15} className="shrink-0 text-[var(--danger)]" />
                    <span className="truncate">{job.title || job.job_type || 'Kitchen print job'}</span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {job.error_message || 'The previous print attempt failed.'}
                    {job.created_at ? ' · ' + new Date(job.created_at).toLocaleString() : ''}
                  </p>
                </div>
                <button type="button" onClick={() => retry(job)} disabled={retryingJob === job.id}
                  className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-sm font-medium text-[var(--text)] disabled:opacity-50">
                  {retryingJob === job.id ? <RefreshCw size={14} className="animate-spin" /> : <RotateCw size={14} />}
                  Retry
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-[var(--text-muted)]">
            <CheckCircle2 size={16} className="text-[var(--success)]" />
            {loadingJobs ? 'Loading failed print jobs…' : 'No failed kitchen print jobs.'}
          </div>
        )}
      </section>
    </div>
  );
}
