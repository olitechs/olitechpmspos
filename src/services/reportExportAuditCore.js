const SAFE_FILTERS = new Set(['period', 'scope', 'status', 'category', 'department', 'payment_type', 'location', 'shift', 'report_type', 'from', 'to', 'reservation']);

export function normalizeReportExportFilters(filters = {}) {
  return Object.fromEntries(Object.entries(filters)
    .filter(([key, value]) => SAFE_FILTERS.has(String(key).toLowerCase()) && value !== undefined && value !== null && value !== '')
    .slice(0, 12)
    .map(([key, value]) => {
      const safeValue = Array.isArray(value) ? value.slice(0, 10).map((item) => String(item)).join(', ') : String(value);
      return [String(key), safeValue.replace(/[\u0000-\u001F]/g, ' ').slice(0, 100)];
    }));
}

export function buildReportExportAuditEvent({ definition, format, rowCount: includedRowCount, delivery = 'download' }) {
  if (!definition?.key || !['pdf', 'xlsx'].includes(format)) throw new Error('The report export audit event is incomplete.');
  const rowCount = Math.floor(Math.max(0, Math.min(1_000_000, Number(includedRowCount ?? definition.rowCount) || 0)));
  return {
    report_key: String(definition.key).slice(0, 80),
    file_format: format,
    delivery: delivery === 'print-preview' ? 'print-preview' : 'download',
    row_count: rowCount,
    filters: normalizeReportExportFilters(definition.filters),
  };
}
