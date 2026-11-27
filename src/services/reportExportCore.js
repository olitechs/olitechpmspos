// Dependency-injected core of the single audited report export path.
//
// Keeping the orchestration free of browser/Supabase imports lets the audit
// ordering and delivery rules be exercised by plain Node tests. The production
// wrapper in reportExportService.js supplies the real document engines, audit
// writer and browser delivery primitives.

import { AUDITED_REPORT_FORMATS, countAuditedReportRows } from './reportExportAuditCore.js';
import { reportFilename } from './reportDocumentEngine.js';

const REPORT_DELIVERIES = new Set(['download', 'print-preview']);

export function createAuditedReportExecutor({ createDocument, recordAudit, deliver }) {
  for (const [name, dependency] of Object.entries({ createDocument, recordAudit, deliver })) {
    if (typeof dependency !== 'function') throw new Error(`Audited report export requires ${name}.`);
  }

  return async function executeAuditedReportExport({
    definition,
    format = 'pdf',
    userId,
    propertyId,
    delivery = 'download',
    blob = null,
    blobBuilder = null,
    filename = null,
    rowCount = null,
    printWindow = null,
  }) {
    if (!definition?.key || !definition?.title || !Array.isArray(definition.sections)) {
      throw new Error('A complete report definition is required for an audited export.');
    }
    const normalizedFormat = String(format).toLowerCase();
    if (!AUDITED_REPORT_FORMATS.has(normalizedFormat)) {
      throw new Error(`Unsupported audited report format: ${format}`);
    }
    const normalizedDelivery = REPORT_DELIVERIES.has(delivery) ? delivery : 'download';
    if (normalizedDelivery === 'print-preview' && normalizedFormat !== 'pdf') {
      throw new Error('Only PDF reports can be delivered to a print preview.');
    }

    const content = await createDocument({
      definition,
      format: normalizedFormat,
      blob,
      blobBuilder,
    });
    if (!content) throw new Error('The report document could not be created.');

    const auditedRowCount = rowCount === null || rowCount === undefined
      ? countAuditedReportRows(definition, normalizedFormat)
      : Math.max(0, Math.floor(Number(rowCount) || 0));

    // Audit first: a document must never leave the browser without a recorded
    // export, and a failed audit must never be followed by a download.
    await recordAudit({
      userId,
      propertyId,
      definition,
      format: normalizedFormat,
      rowCount: auditedRowCount,
      delivery: normalizedDelivery,
    });

    const finalFilename = filename || reportFilename(definition, normalizedFormat);
    await deliver({
      content,
      filename: finalFilename,
      format: normalizedFormat,
      delivery: normalizedDelivery,
      printWindow,
    });

    return { filename: finalFilename, format: normalizedFormat, rowCount: auditedRowCount };
  };
}
