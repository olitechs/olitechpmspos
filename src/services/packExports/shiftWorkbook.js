// Shift report workbook — turns the existing shift report definition into a
// formula-driven Excel workbook so the closing report can leave the building
// as a spreadsheet as well as a thermal print.
//
// Every numeric column gets a SUM formula at the bottom; the values themselves
// stay exactly as the shift reconciliation produced them.

import {
  INT,
  NUM,
  PACK_FILLS,
  PACK_FONTS,
  PCT,
  QTY,
  addCellRule,
  asNumber,
  columnLetter,
  finishSheet,
  generatedAtLabel,
  putCell,
  safeText,
  setAutoFilter,
  writeSheetTitle,
  writeTableHeader,
} from './workbookStyles.js';

const formatFor = (column) => {
  if (column.format === 'currency') return NUM;
  if (column.format === 'percent') return PCT;
  if (column.format === 'number') return Number.isInteger(column.decimals) ? INT : QTY;
  return column.type === 'number' ? NUM : undefined;
};

const isNumericColumn = (column) => column.type === 'number' || ['currency', 'percent', 'number'].includes(column.format);

const safeSheetName = (value, fallback) => {
  const cleaned = safeText(value || fallback).replace(/[\\/*?:[\]]/g, ' ').slice(0, 31);
  return cleaned || fallback;
};

export function buildShiftWorkbook(workbook, data = {}) {
  const definition = data.definition || {};
  const sections = Array.isArray(definition.sections) ? definition.sections : [];
  const subtitle = `${data.propertyName || 'OliTechs'}  |  Generated ${generatedAtLabel(data.generatedAt)} from the OliTech database  |  Amounts in ${data.currency || 'KES'}`;
  const usedNames = new Set();

  sections.forEach((section, index) => {
    let name = safeSheetName(section.title || section.name, `Section ${index + 1}`);
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `${safeSheetName(section.title || section.name, 'Section').slice(0, 28)} ${suffix}`;
      suffix += 1;
    }
    usedNames.add(name);

    const worksheet = workbook.addWorksheet(name);
    const columns = Array.isArray(section.columns) ? section.columns : [];
    const rows = Array.isArray(section.rows) ? section.rows : [];
    writeSheetTitle(worksheet, section.title || definition.title || 'Shift report', subtitle);
    writeTableHeader(worksheet, 4, columns.map((column) => column.label || column.key), columns.map((column) => Math.max(10, Math.min(46, Number(column.width) || 16))));

    const firstRow = 5;
    rows.forEach((row, rowIndex) => {
      const current = firstRow + rowIndex;
      columns.forEach((column, columnIndex) => {
        const raw = row?.[column.key];
        const numeric = isNumericColumn(column);
        putCell(worksheet, current, columnIndex + 1, numeric ? asNumber(raw) : safeText(raw), {
          format: formatFor(column),
          align: { vertical: 'top', wrapText: true, horizontal: column.align || (numeric ? 'right' : 'left') },
        });
      });
    });

    const lastRow = Math.max(firstRow, firstRow + rows.length - 1);
    const totalRow = lastRow + 1;
    const numericColumns = columns.map((column, columnIndex) => ({ column, columnIndex })).filter(({ column }) => isNumericColumn(column));
    if (numericColumns.length && rows.length) {
      putCell(worksheet, totalRow, 1, 'Total', { font: PACK_FONTS.bold, fill: PACK_FILLS.total });
      numericColumns.forEach(({ column, columnIndex }) => {
        putCell(worksheet, totalRow, columnIndex + 1, `=SUM(${columnLetter(columnIndex + 1)}${firstRow}:${columnLetter(columnIndex + 1)}${lastRow})`, {
          format: formatFor(column),
          font: PACK_FONTS.bold,
          fill: PACK_FILLS.total,
        });
      });
    }

    if (rows.length) setAutoFilter(worksheet, 4, 1, lastRow, Math.max(1, columns.length));
    if (rows.length && columns.some((column) => /amount|total|value/i.test(column.key))) {
      const suspectColumn = columns.findIndex((column) => isNumericColumn(column));
      if (suspectColumn >= 0) addCellRule(worksheet, `${columnLetter(suspectColumn + 1)}${firstRow}:${columnLetter(suspectColumn + 1)}${lastRow}`, 'lessThan', '0', PACK_FILLS.red.fgColor.argb);
    }
    finishSheet(worksheet, { freeze: 'A5', landscape: columns.length > 6 });
  });

  if (!workbook.worksheets.length) {
    const worksheet = workbook.addWorksheet('Shift Report');
    writeSheetTitle(worksheet, definition.title || 'Shift report', subtitle);
    worksheet.getCell('A4').value = 'No shift report rows were available for this export.';
    finishSheet(worksheet, { landscape: false });
  }

  return { sheetNames: workbook.worksheets.map((sheet) => sheet.name) };
}
