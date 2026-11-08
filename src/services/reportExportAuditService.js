import { supabase } from '@/lib/supabaseClient';
import { buildReportExportAuditEvent } from '@/services/reportExportAuditCore';

export { buildReportExportAuditEvent, normalizeReportExportFilters } from '@/services/reportExportAuditCore';

export const reportExportAuditService = {
  async record({ userId, propertyId, definition, format, rowCount, delivery = 'download' }) {
    if (!userId || !propertyId) throw new Error('Your authenticated user and active property are required to record this export in Audit Log.');
    const newValue = buildReportExportAuditEvent({ definition, format, rowCount, delivery });
    const { error } = await supabase.from('audit_logs').insert({
      actor_id: userId,
      property_id: propertyId,
      action: 'report_exported',
      new_value: newValue,
    });
    if (error) throw new Error(`Audit Log could not record this export: ${error.message}`);
    return newValue;
  },
};
