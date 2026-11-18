// Filename helpers shared by the pack Excel exports. Kept free of browser and
// alias imports so the contract tests can exercise them in Node.

export const PACK_EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const sanitizePart = (value) => String(value ?? '')
  .replace(/[^A-Za-z0-9._-]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '');

export const packFileName = ({ propertyName, report, from, to, extra }) => {
  const range = from && to ? `${from}_to_${to}` : (from || to || '');
  return [sanitizePart(propertyName) || 'OliTechs', sanitizePart(report), sanitizePart(range), sanitizePart(extra)]
    .filter(Boolean)
    .join('_') + '.xlsx';
};

export const salesExportFilename = ({ propertyName, from, to }) => packFileName({ propertyName, report: 'Sales_Reports', from, to });
export const stockExportFilename = ({ propertyName, from, to }) => packFileName({ propertyName, report: 'Stock_Reports', from, to });
export const adjustmentFormFilename = ({ propertyName, date }) => packFileName({ propertyName, report: 'Stock_Adjustment_Form', from: date });
export const frontOfficeExportFilename = ({ propertyName, date }) => packFileName({ propertyName, report: 'Front_Office_Reports', from: date });
export const shiftExportFilename = ({ propertyName, shiftNo, date }) => packFileName({ propertyName, report: 'Shift_Report', from: date, extra: shiftNo });
