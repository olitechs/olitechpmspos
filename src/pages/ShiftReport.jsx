import React, { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Printer } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { shiftService } from '@/services/shiftService';
import { getPrinters, getAssignments, printShiftReport } from '@/services/printService';
import { supabase } from '@/lib/supabaseClient';
import DocumentExportMenu from '@/components/shared/DocumentExportMenu';
import { buildShiftReportDefinition } from '@/services/reportDefinitions';

function ShiftReportDocumentExport({ shift, propertyName, generatedBy }) {
  const getDefinition = async (onProgress) => {
    onProgress?.('Loading shift transactions…');
    const report = await shiftService.getShiftReport(shift.id);
    onProgress?.('Building shift report…');
    return buildShiftReportDefinition(report, { propertyName, generatedBy });
  };

  return <DocumentExportMenu getDefinition={getDefinition} label="Shift report" />;
}

export default function ShiftReport() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');

  const loadShifts = useCallback(async () => {
    if (!propertyId) {
      setShifts([]);
      setLoadError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const rows = await shiftService.listShifts(propertyId);
      setShifts(Array.isArray(rows) ? rows : []);
    } catch (error) {
      setLoadError(error.message || 'Could not load shift reports.');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    loadShifts();
  }, [loadShifts]);

  const action = async (shift) => {
    setActionError('');
    try {
      const report = await shiftService.getShiftReport(shift.id);
      report.propertyId = propertyId;
      const { data: settings } = await supabase
        .from('property_settings')
        .select('*')
        .eq('property_id', propertyId)
        .maybeSingle();
      report.settings = settings;
      const [printers, assignments] = await Promise.all([
        getPrinters(propertyId),
        getAssignments(propertyId),
      ]);
      const printer = assignments
        .filter((item) => item.assignment_type === 'shift_reports' || item.assignment_type === 'reports')
        .map((item) => printers.find((candidate) => candidate.id === item.printer_id))
        .find(Boolean);
      if (!printer) throw new Error('No shift report printer assigned.');
      await printShiftReport(report, printer);
    } catch (error) {
      setActionError(error.message || 'Shift report action failed.');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--canvas)] p-4 text-[var(--text)] sm:p-5">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-black text-[var(--text)]">Shift Reports</h1>
            <p className="text-sm text-[var(--text-muted)]">Structured shift financial reports; thermal reprints stay on assigned receipt printers.</p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold">
            <CalendarDays size={15} aria-hidden="true" />{date}
          </div>
        </div>

        {actionError && <div role="alert" className="mb-4 rounded-xl bg-[var(--danger-soft)] p-3 text-sm font-bold text-[var(--danger-text)]">{actionError}</div>}
        {loadError && (
          <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm font-bold text-[var(--danger-text)]">
            <span>{loadError}</span>
            <button type="button" disabled={loading} onClick={loadShifts} className="min-h-11 rounded-lg bg-[var(--primary)] px-4 text-[var(--on-primary)] disabled:opacity-60">{loading ? 'Loading…' : 'Retry reports'}</button>
          </div>
        )}

        {loading ? (
          <div role="status" aria-live="polite" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm font-semibold text-[var(--text-muted)]">Loading shift reports…</div>
        ) : loadError ? null : shifts.length === 0 ? (
          <div role="status" aria-live="polite" className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-muted)]">
            {propertyId ? 'No shifts recorded yet. Closed shift reports will appear here.' : 'Select a property to view shift reports.'}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            {shifts.map((shift) => (
              <div key={shift.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4 last:border-b-0">
                <div>
                  <div className="font-black text-[var(--text)]">{shift.shift_no}</div>
                  <div className="text-xs text-[var(--text-muted)]">{shift.status} · {new Date(shift.opened_at).toLocaleString('en-KE')}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => action(shift)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-bold text-[var(--text)] hover:bg-[var(--primary-soft)]">
                    <Printer size={15} aria-hidden="true" />Re-print
                  </button>
                  <ShiftReportDocumentExport shift={shift} propertyName={user?.property?.business_name || user?.property?.name || 'OliTechs'} generatedBy={user?.full_name || user?.staff?.full_name || user?.email || 'Authorized staff'} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
