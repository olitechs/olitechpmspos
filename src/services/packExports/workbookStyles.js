// Shared styling for the OliTechs "upgrade pack" Excel workbooks.
//
// The layout, palette and number formats mirror the reference generators in
// the upgrade pack (reference/export-generators/common.py) so exported files
// stay byte-for-byte familiar to the accountants and storekeepers who already
// use them. Only ExcelJS primitives live here; no workbook is created so the
// heavy `exceljs` import stays lazy in the browser bundle.

export const PACK_FONT = 'Arial';
export const PACK_CURRENCY = 'KES';
export const NAIROBI_TIME_ZONE = 'Africa/Nairobi';
export const LAST_TEMPLATE_ROW = 2000;

export const PACK_COLORS = {
  title: 'FF1F3A4D',
  header: 'FF1F3A4D',
  kpi: 'FFE8EEF2',
  input: 'FFFFF6CC',
  total: 'FFD9E2E8',
  red: 'FFF8D7DA',
  amber: 'FFFFE8B3',
  green: 'FFD4EDDA',
  grid: 'FFBFBFBF',
  muted: 'FF595959',
  link: 'FF008000',
  code: 'FF7F7F7F',
  occupancy: 'FF9FC5D9',
  white: 'FFFFFFFF',
};

export const NUM = '#,##0.00;(#,##0.00);"-"';
export const INT = '#,##0;(#,##0);"-"';
export const QTY = '#,##0.##;(#,##0.##);"-"';
export const PCT = '0.0%;(0.0%);"-"';
export const DATE = 'dd-mmm-yyyy';
export const DATETIME = 'dd-mmm-yyyy hh:mm';
export const DAY = 'd';

const font = (options = {}) => ({ name: PACK_FONT, size: 10, ...options });
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thinBorder = { style: 'thin', color: { argb: PACK_COLORS.grid } };
const boxBorder = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };

export const PACK_FONTS = {
  base: font(),
  bold: font({ bold: true }),
  title: font({ size: 14, bold: true, color: { argb: PACK_COLORS.title } }),
  subtitle: font({ size: 9, italic: true, color: { argb: PACK_COLORS.muted } }),
  header: font({ bold: true, color: { argb: PACK_COLORS.white } }),
  input: font({ color: { argb: 'FF0000FF' } }),
  link: font({ color: { argb: PACK_COLORS.link } }),
  code: font({ color: { argb: PACK_COLORS.code } }),
  day: font({ size: 8, color: { argb: PACK_COLORS.muted } }),
  grid: font({ size: 8 }),
};

export const PACK_FILLS = {
  header: fill(PACK_COLORS.header),
  kpi: fill(PACK_COLORS.kpi),
  input: fill(PACK_COLORS.input),
  total: fill(PACK_COLORS.total),
  red: fill(PACK_COLORS.red),
  amber: fill(PACK_COLORS.amber),
  green: fill(PACK_COLORS.green),
  occupancy: fill(PACK_COLORS.occupancy),
};

export const columnLetter = (index) => {
  let value = Number(index);
  if (!Number.isInteger(value) || value < 1) throw new Error('A positive column index is required.');
  let text = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    text = String.fromCharCode(65 + remainder) + text;
    value = Math.floor((value - 1) / 26);
  }
  return text;
};

export const safeText = (value) => String(value ?? '').trim();

export const shortId = (value) => safeText(value).slice(0, 8);

export const asNumber = (value) => {
  if (value === null || value === undefined || value === '') return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

export const nairobiParts = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: NAIROBI_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date);
  const read = (type) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
};

// Excel stores dates as timezone-free serials. Convert to a UTC Date whose
// wall-clock parts equal Nairobi wall-clock parts so every cell displays the
// property's local time regardless of the reviewer's machine.
export const excelDateTime = (value) => {
  const parts = nairobiParts(value);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
};

export const excelDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) return new Date(Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])));
  const parts = nairobiParts(value);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
};

export const generatedAtLabel = (value = new Date()) => {
  const parts = nairobiParts(value);
  if (!parts) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(parts.day).padStart(2, '0')} ${months[parts.month - 1]} ${parts.year}`;
};

export const putCell = (worksheet, row, column, value, options = {}) => {
  const cell = worksheet.getCell(row, column);
  cell.value = value ?? null;
  cell.font = options.font || PACK_FONTS.base;
  if (options.format) cell.numFmt = options.format;
  if (options.fill) cell.fill = options.fill;
  if (options.align) cell.alignment = options.align;
  if (options.border !== false) cell.border = boxBorder;
  return cell;
};

export const putInput = (worksheet, row, column, value, format) => putCell(worksheet, row, column, value, {
  format,
  font: PACK_FONTS.input,
  fill: PACK_FILLS.input,
});

export const putLabel = (worksheet, row, column, text, bold = true) => {
  const cell = worksheet.getCell(row, column);
  cell.value = text;
  cell.font = bold ? PACK_FONTS.bold : PACK_FONTS.base;
  return cell;
};

export const setColumnWidths = (worksheet, widths = []) => {
  widths.forEach((width, index) => {
    if (width) worksheet.getColumn(index + 1).width = width;
  });
};

export const writeSheetTitle = (worksheet, title, subtitle) => {
  worksheet.getCell('A1').value = title;
  worksheet.getCell('A1').font = PACK_FONTS.title;
  worksheet.getCell('A2').value = subtitle;
  worksheet.getCell('A2').font = PACK_FONTS.subtitle;
};

export const writeNoteBox = (worksheet, row, text, columns = 8) => {
  const cell = worksheet.getCell(row, 1);
  cell.value = text;
  cell.font = PACK_FONTS.subtitle;
  cell.alignment = { wrapText: true, vertical: 'top' };
  if (columns > 1) worksheet.mergeCells(row, 1, row, columns);
  worksheet.getRow(row).height = 15 * (1 + Math.floor(String(text || '').length / 110));
};

export const writeTableHeader = (worksheet, row, headers, widths) => {
  headers.forEach((header, index) => {
    const cell = worksheet.getCell(row, index + 1);
    cell.value = header;
    cell.font = PACK_FONTS.header;
    cell.fill = PACK_FILLS.header;
    cell.border = boxBorder;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  worksheet.getRow(row).height = 30;
  if (widths?.length) setColumnWidths(worksheet, widths);
};

export const finishSheet = (worksheet, { freeze, fitToWidth = 1, landscape = true } = {}) => {
  const view = { showGridLines: false };
  if (freeze) {
    const match = String(freeze).match(/^([A-Z]+)(\d+)$/);
    if (match) {
      view.state = 'frozen';
      view.xSplit = match[1].split('').reduce((total, letter) => total * 26 + (letter.charCodeAt(0) - 64), 0) - 1;
      view.ySplit = Number(match[2]) - 1;
    }
  }
  worksheet.views = [view];
  worksheet.pageSetup = {
    orientation: landscape ? 'landscape' : 'portrait',
    paperSize: 9,
    fitToPage: true,
    fitToWidth,
    fitToHeight: 0,
    horizontalCentered: true,
  };
  worksheet.headerFooter = { oddFooter: '&C&A  -  Page &P of &N' };
};

export const addCellRule = (worksheet, ref, operator, formula, colour) => {
  worksheet.addConditionalFormatting({
    ref,
    rules: [{
      type: 'cellIs',
      operator,
      formulae: [formula],
      style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: colour } } },
    }],
  });
};

export const addFormulaRule = (worksheet, ref, formula, colour) => {
  worksheet.addConditionalFormatting({
    ref,
    rules: [{
      type: 'expression',
      formulae: [formula],
      style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: colour } } },
    }],
  });
};

export const setAutoFilter = (worksheet, fromRow, fromColumn, toRow, toColumn) => {
  worksheet.autoFilter = {
    from: { row: fromRow, column: fromColumn },
    to: { row: toRow, column: toColumn },
  };
};

export const writeNotesSheet = (worksheet, title, notes) => {
  writeSheetTitle(worksheet, title, '');
  notes.forEach((text, index) => {
    const cell = worksheet.getCell(4 + index, 1);
    cell.value = `${index + 1}.  ${text}`;
    cell.font = PACK_FONTS.base;
    cell.alignment = { wrapText: true, vertical: 'top' };
    worksheet.getRow(4 + index).height = 30;
  });
  worksheet.getColumn(1).width = 130;
  finishSheet(worksheet, { landscape: false });
};

export const moneyText = (value, currency = PACK_CURRENCY) => `${currency} ${asNumber(value).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
