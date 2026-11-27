// Single audited path for every report download or print preview.
//
// Definitions, CSV/XLSX/PDF engines and pack workbook builders may change
// independently, but no component should write an Audit Log row and trigger a
// browser download separately. This module owns both steps so an export can
// never be delivered without an audit event (or audited twice).

import {
  createCsvBlob,
  createExcelBlob,
  createPdfBlob,
  downloadBlob,
  openPdfPreview,
} from '@/services/reportDocumentEngine';
import { reportExportAuditService } from '@/services/reportExportAuditService';
import { createAuditedReportExecutor } from './reportExportCore.js';

export const executeAuditedReportExport = createAuditedReportExecutor({
  async createDocument({ definition, format, blob, blobBuilder }) {
    return blob
      || (typeof blobBuilder === 'function'
        ? await blobBuilder(definition, { format })
        : format === 'csv'
          ? await createCsvBlob(definition)
          : format === 'xlsx'
            ? await createExcelBlob(definition)
            : await createPdfBlob(definition));
  },
  async recordAudit(event) {
    await reportExportAuditService.record(event);
  },
  async deliver({ content, filename, delivery, printWindow }) {
    if (delivery === 'print-preview') openPdfPreview(content, printWindow);
    else downloadBlob(content, filename);
  },
});

export { countAuditedReportRows } from './reportExportAuditCore.js';
