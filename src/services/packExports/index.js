// Entry point for the upgrade-pack Excel exports.
//
// ExcelJS is imported lazily so it never lands in the initial bundle. Builders
// receive a workbook so they can be unit-tested in Node without a DOM.

import { downloadBlob } from '@/services/reportDocumentEngine';
import { buildSalesWorkbook } from './salesWorkbook.js';
import { buildStockWorkbook, buildAdjustmentFormWorkbook } from './stockWorkbook.js';
import { buildFrontOfficeWorkbook } from './frontOfficeWorkbook.js';
import { buildShiftWorkbook } from './shiftWorkbook.js';
import { PACK_EXCEL_MIME } from './filenames.js';

export {
  PACK_EXCEL_MIME,
  adjustmentFormFilename,
  frontOfficeExportFilename,
  packFileName,
  salesExportFilename,
  shiftExportFilename,
  stockExportFilename,
} from './filenames.js';

export async function createPackWorkbookBlob(builder, data = {}) {
  const excelModule = await import('exceljs');
  const ExcelJS = excelModule.default || excelModule;
  const workbook = new ExcelJS.Workbook();
  const meta = builder(workbook, data) || {};
  const buffer = await workbook.xlsx.writeBuffer();
  return { blob: new Blob([buffer], { type: PACK_EXCEL_MIME }), meta };
}

export async function downloadPackWorkbook(builder, data, filename) {
  const { blob, meta } = await createPackWorkbookBlob(builder, data);
  downloadBlob(blob, filename);
  return { filename, sheetNames: meta.sheetNames || [] };
}

export const packExportBuilders = {
  sales: buildSalesWorkbook,
  stock: buildStockWorkbook,
  adjustmentForm: buildAdjustmentFormWorkbook,
  frontOffice: buildFrontOfficeWorkbook,
  shift: buildShiftWorkbook,
};
