// Sales workbook (Accounts) — matches the upgrade pack's OliTech_Sales_Reports
// layout: Sales Summary, Sales by Item, By Category, Voids & Adjustments,
// Item Lines, Notes and the Receipts register.
//
// Every total, status and check column is an Excel formula that reaches row
// 2000, so rows pasted below the export are counted automatically. The only
// blue cells are the date range on Sales Summary.

import {
  DATE,
  DATETIME,
  INT,
  LAST_TEMPLATE_ROW,
  NUM,
  PACK_CURRENCY,
  PACK_FILLS,
  PACK_FONTS,
  PCT,
  QTY,
  addCellRule,
  asNumber,
  columnLetter,
  excelDate,
  excelDateTime,
  finishSheet,
  generatedAtLabel,
  putCell,
  putInput,
  putLabel,
  safeText,
  setAutoFilter,
  shortId,
  writeNoteBox,
  writeNotesSheet,
  writeSheetTitle,
  writeTableHeader,
} from './workbookStyles.js';

const RECEIPT_START_ROW = 5;
const ITEM_START_ROW = 5;

const receiptRange = (column) => `Receipts!$${column}$${RECEIPT_START_ROW}:$${column}$${LAST_TEMPLATE_ROW}`;
const lineRange = (column) => `'Item Lines'!$${column}$${ITEM_START_ROW}:$${column}$${LAST_TEMPLATE_ROW}`;

const paymentMethods = [
  ['Cash', 'cash'],
  ['M-Pesa', 'mpesa'],
  ['Card', 'card'],
  ['Bank transfer', 'bank'],
  ['Room charge (to folio)', 'room'],
];

const receiptDateKey = (receipt) => {
  const value = excelDateTime(receipt.created_at);
  if (!value) return '';
  return value.toISOString().slice(0, 10);
};

const sortByCreatedAt = (rows) => [...rows].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));

const shiftLookup = (shifts = []) => new Map(shifts.map((shift) => [shift.id, shift.shift_no]));

const profileLookup = (profiles = []) => new Map(profiles.map((profile) => [profile.id, profile.full_name || profile.email || '']));

const buildItemLines = (receipts) => {
  const lines = [];
  receipts.forEach((receipt) => {
    const items = Array.isArray(receipt.items) ? receipt.items : [];
    items.forEach((item) => {
      lines.push({
        at: receipt.created_at,
        receiptRef: shortId(receipt.id),
        orderNumber: safeText(receipt.order_number),
        name: safeText(item?.name ?? item?.item_name),
        category: safeText(item?.category) || '(not recorded)',
        centre: safeText(item?.center ?? item?.centre) || '(not recorded)',
        qty: asNumber(item?.qty ?? item?.quantity),
        price: asNumber(item?.price ?? item?.unit_price),
        stockLinked: Boolean(item?.product_id || item?.productId),
        receiptStatus: safeText(receipt.status),
        paymentMethod: safeText(receipt.payment_method),
        categorySource: '',
      });
    });
  });

  const known = new Map();
  lines.forEach((line) => {
    if (line.category !== '(not recorded)') {
      const key = line.name.toLowerCase();
      if (!known.has(key)) known.set(key, [line.category, line.centre]);
    }
  });
  lines.forEach((line) => {
    if (line.category === '(not recorded)' && known.has(line.name.toLowerCase())) {
      const [category, centre] = known.get(line.name.toLowerCase());
      line.category = category;
      line.centre = centre;
      line.categorySource = 'Matched from same item on newer receipts';
    } else if (line.category === '(not recorded)') {
      line.categorySource = 'Not recorded';
    } else {
      line.categorySource = 'Recorded on receipt';
    }
  });
  return lines;
};

const writeReceiptsSheet = (workbook, data) => {
  const worksheet = workbook.addWorksheet('Receipts');
  const receipts = sortByCreatedAt(data.receipts || []);
  const shifts = shiftLookup(data.shifts);
  const profiles = profileLookup(data.profiles);

  writeSheetTitle(worksheet, 'Receipts register (all POS receipts)', packSubtitle(data));
  writeNoteBox(worksheet, 3, 'One row per receipt. Times are Nairobi time. Column O must be zero (Subtotal - Discount + VAT - Total). Column Q shows whether a room-charge receipt reached a guest folio.', 18);
  writeTableHeader(worksheet, 4, [
    'Date & time', 'Date', 'Receipt ref', 'Order no.', 'Table', 'Room', 'Guest', 'Waiter', 'Payment method', 'Status',
    'Subtotal', 'Discount', 'VAT', 'Total', 'Check (should be 0)', 'Shift #', 'On guest folio?', 'Cashier',
  ], [17, 12, 11, 17, 8, 7, 16, 14, 12, 9, 13, 11, 11, 13, 12, 8, 15, 15]);

  receipts.forEach((receipt, index) => {
    const row = RECEIPT_START_ROW + index;
    const isRoomCharge = safeText(receipt.payment_method) === 'room';
    const folio = isRoomCharge ? (receipt.folio_charge_id ? 'Yes' : 'NO') : 'n/a';
    putCell(worksheet, row, 1, excelDateTime(receipt.created_at), { format: DATETIME });
    putCell(worksheet, row, 2, `=INT(A${row})`, { format: DATE });
    putCell(worksheet, row, 3, shortId(receipt.id));
    putCell(worksheet, row, 4, safeText(receipt.order_number));
    putCell(worksheet, row, 5, safeText(receipt.table_number));
    putCell(worksheet, row, 6, safeText(receipt.room_number));
    putCell(worksheet, row, 7, safeText(receipt.guest_name));
    putCell(worksheet, row, 8, safeText(receipt.waiter));
    putCell(worksheet, row, 9, safeText(receipt.payment_method));
    putCell(worksheet, row, 10, safeText(receipt.status));
    putCell(worksheet, row, 11, asNumber(receipt.subtotal), { format: NUM });
    putCell(worksheet, row, 12, asNumber(receipt.discount_amount), { format: NUM });
    putCell(worksheet, row, 13, asNumber(receipt.vat), { format: NUM });
    putCell(worksheet, row, 14, asNumber(receipt.total), { format: NUM });
    putCell(worksheet, row, 15, `=ROUND(K${row}-L${row}+M${row}-N${row},2)`, { format: NUM });
    putCell(worksheet, row, 16, shifts.get(receipt.shift_id || receipt.pos_shift_id) || '');
    putCell(worksheet, row, 17, folio);
    putCell(worksheet, row, 18, profiles.get(receipt.created_by) || '');
  });

  const lastRow = Math.max(RECEIPT_START_ROW, RECEIPT_START_ROW + receipts.length - 1);
  const totalsRow = lastRow + 1;
  putCell(worksheet, totalsRow, 10, 'Totals (all statuses)', { font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  [11, 12, 13, 14].forEach((column) => {
    putCell(worksheet, totalsRow, column, `=SUM(${columnLetter(column)}${RECEIPT_START_ROW}:${columnLetter(column)}${lastRow})`, { format: NUM, font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  });

  addCellRule(worksheet, `Q${RECEIPT_START_ROW}:Q${lastRow}`, 'equal', '"NO"', PACK_FILLS.red.fgColor.argb);
  addCellRule(worksheet, `J${RECEIPT_START_ROW}:J${lastRow}`, 'equal', '"voided"', PACK_FILLS.amber.fgColor.argb);
  addCellRule(worksheet, `O${RECEIPT_START_ROW}:O${lastRow}`, 'notEqual', '0', PACK_FILLS.red.fgColor.argb);
  if (receipts.length) setAutoFilter(worksheet, 4, 1, lastRow, 18);
  finishSheet(worksheet, { freeze: 'A5' });
  return { receipts, lastRow };
};

const writeItemLinesSheet = (workbook, data, lines) => {
  const worksheet = workbook.addWorksheet('Item Lines');

  writeSheetTitle(worksheet, 'Item lines (every item on every receipt)', packSubtitle(data));
  writeNoteBox(worksheet, 3, 'Unpacked from the receipt items. Older receipts had no category/department; where the same item appears on a newer receipt it is filled in from there (see Category source). Line total = Qty x Unit price.', 13);
  writeTableHeader(worksheet, 4, [
    'Date & time', 'Receipt ref', 'Order no.', 'Item', 'Category', 'Dept / centre', 'Qty', 'Unit price', 'Line total',
    'Stock-linked?', 'Receipt status', 'Payment method', 'Category source',
  ], [17, 11, 17, 28, 16, 14, 7, 12, 13, 12, 12, 14, 34]);

  lines.forEach((line, index) => {
    const row = ITEM_START_ROW + index;
    putCell(worksheet, row, 1, excelDateTime(line.at), { format: DATETIME });
    putCell(worksheet, row, 2, line.receiptRef);
    putCell(worksheet, row, 3, line.orderNumber);
    putCell(worksheet, row, 4, line.name);
    putCell(worksheet, row, 5, line.category);
    putCell(worksheet, row, 6, line.centre);
    putCell(worksheet, row, 7, line.qty, { format: QTY });
    putCell(worksheet, row, 8, line.price, { format: NUM });
    putCell(worksheet, row, 9, `=G${row}*H${row}`, { format: NUM });
    putCell(worksheet, row, 10, line.stockLinked ? 'Yes' : 'No');
    putCell(worksheet, row, 11, line.receiptStatus);
    putCell(worksheet, row, 12, line.paymentMethod);
    putCell(worksheet, row, 13, line.categorySource);
  });

  const lastRow = Math.max(ITEM_START_ROW, ITEM_START_ROW + lines.length - 1);
  putCell(worksheet, lastRow + 1, 8, 'Total', { font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  putCell(worksheet, lastRow + 1, 9, `=SUM(I${ITEM_START_ROW}:I${lastRow})`, { format: NUM, font: PACK_FONTS.bold, fill: PACK_FILLS.total });

  addCellRule(worksheet, `H${ITEM_START_ROW}:H${lastRow}`, 'equal', '0', PACK_FILLS.red.fgColor.argb);
  addCellRule(worksheet, `J${ITEM_START_ROW}:J${lastRow}`, 'equal', '"No"', PACK_FILLS.amber.fgColor.argb);
  if (lines.length) setAutoFilter(worksheet, 4, 1, lastRow, 13);
  finishSheet(worksheet, { freeze: 'A5' });
  return lines;
};

const writeSalesSummarySheet = (workbook, data) => {
  const worksheet = workbook.addWorksheet('Sales Summary');
  const receipts = data.receipts || [];
  const dates = [...new Set(receipts.map(receiptDateKey).filter(Boolean))].sort();
  const fromValue = data.from || dates[0] || '';
  const toValue = data.to || dates[dates.length - 1] || '';

  writeSheetTitle(worksheet, 'Sales summary', packSubtitle(data));
  putLabel(worksheet, 3, 1, 'Date from');
  putInput(worksheet, 3, 2, excelDate(fromValue), DATE);
  putLabel(worksheet, 4, 1, 'Date to');
  putInput(worksheet, 4, 2, excelDate(toValue), DATE);
  worksheet.getCell(3, 3).value = 'Blue cells are inputs. Change the dates and every figure on this sheet and on Sales by Item / Category updates.';
  worksheet.getCell(3, 3).font = PACK_FONTS.subtitle;

  const criteria = `${receiptRange('B')},">="&$B$3,${receiptRange('B')},"<="&$B$4`;
  writeTableHeader(worksheet, 6, ['Key figures', 'Value']);

  const keyFigures = [
    ['Receipts (posted)', `=COUNTIFS(${receiptRange('J')},"posted",${criteria})`, INT, false],
    ['Sales before discount', `=SUMIFS(${receiptRange('K')},${receiptRange('J')},"posted",${criteria})`, NUM, false],
    ['Less: discounts', `=SUMIFS(${receiptRange('L')},${receiptRange('J')},"posted",${criteria})`, NUM, false],
    ['VAT charged', `=SUMIFS(${receiptRange('M')},${receiptRange('J')},"posted",${criteria})`, NUM, false],
    ['Total sales', `=SUMIFS(${receiptRange('N')},${receiptRange('J')},"posted",${criteria})`, NUM, true],
    ['Average receipt', '=IFERROR(B11/B7,0)', NUM, false],
    ['Voided receipts (count)', `=COUNTIFS(${receiptRange('J')},"voided",${criteria})`, INT, false],
    ['Voided receipts (value)', `=SUMIFS(${receiptRange('N')},${receiptRange('J')},"voided",${criteria})`, NUM, false],
  ];
  keyFigures.forEach(([labelText, formula, format, emphasise], index) => {
    const row = 7 + index;
    putCell(worksheet, row, 1, labelText, { font: emphasise ? PACK_FONTS.bold : PACK_FONTS.base, fill: emphasise ? PACK_FILLS.kpi : undefined });
    putCell(worksheet, row, 2, formula, { format, font: emphasise ? PACK_FONTS.bold : PACK_FONTS.base, fill: emphasise ? PACK_FILLS.kpi : undefined });
  });

  writeTableHeader(worksheet, 16, ['Payment method', 'Code in system', 'Receipts', 'Amount', '% of sales']);
  paymentMethods.forEach(([labelText, code], index) => {
    const row = 17 + index;
    putCell(worksheet, row, 1, labelText);
    putCell(worksheet, row, 2, code, { font: PACK_FONTS.code });
    putCell(worksheet, row, 3, `=COUNTIFS(${receiptRange('J')},"posted",${receiptRange('I')},$B${row},${criteria})`, { format: INT });
    putCell(worksheet, row, 4, `=SUMIFS(${receiptRange('N')},${receiptRange('J')},"posted",${receiptRange('I')},$B${row},${criteria})`, { format: NUM });
    putCell(worksheet, row, 5, `=IFERROR(D${row}/$B$11,0)`, { format: PCT });
  });
  putCell(worksheet, 22, 1, 'Other / unrecognised method');
  putCell(worksheet, 22, 2, '');
  putCell(worksheet, 22, 3, '=B7-SUM(C17:C21)', { format: INT });
  putCell(worksheet, 22, 4, '=B11-SUM(D17:D21)', { format: NUM });
  putCell(worksheet, 22, 5, '=IFERROR(D22/$B$11,0)', { format: PCT });
  putCell(worksheet, 23, 1, 'Total', { font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  putCell(worksheet, 23, 2, '', { fill: PACK_FILLS.total });
  putCell(worksheet, 23, 3, '=SUM(C17:C22)', { format: INT, font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  putCell(worksheet, 23, 4, '=SUM(D17:D22)', { format: NUM, font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  putCell(worksheet, 23, 5, '=SUM(E17:E22)', { format: PCT, font: PACK_FONTS.bold, fill: PACK_FILLS.total });

  writeTableHeader(worksheet, 26, ['Date', 'Receipts', 'Total sales', 'Cash', 'M-Pesa', 'Card + Bank', 'Room charge', 'Voided value']);
  const dailyStart = 27;
  dates.forEach((dateKey, index) => {
    const row = dailyStart + index;
    const dateCriteria = `${receiptRange('B')},$A${row}`;
    putCell(worksheet, row, 1, excelDate(dateKey), { format: DATE });
    putCell(worksheet, row, 2, `=COUNTIFS(${receiptRange('J')},"posted",${dateCriteria})`, { format: INT });
    putCell(worksheet, row, 3, `=SUMIFS(${receiptRange('N')},${receiptRange('J')},"posted",${dateCriteria})`, { format: NUM });
    putCell(worksheet, row, 4, `=SUMIFS(${receiptRange('N')},${receiptRange('J')},"posted",${receiptRange('I')},"cash",${dateCriteria})`, { format: NUM });
    putCell(worksheet, row, 5, `=SUMIFS(${receiptRange('N')},${receiptRange('J')},"posted",${receiptRange('I')},"mpesa",${dateCriteria})`, { format: NUM });
    putCell(worksheet, row, 6, `=SUMIFS(${receiptRange('N')},${receiptRange('J')},"posted",${receiptRange('I')},"card",${dateCriteria})+SUMIFS(${receiptRange('N')},${receiptRange('J')},"posted",${receiptRange('I')},"bank",${dateCriteria})`, { format: NUM });
    putCell(worksheet, row, 7, `=SUMIFS(${receiptRange('N')},${receiptRange('J')},"posted",${receiptRange('I')},"room",${dateCriteria})`, { format: NUM });
    putCell(worksheet, row, 8, `=SUMIFS(${receiptRange('N')},${receiptRange('J')},"voided",${dateCriteria})`, { format: NUM });
  });

  const dailyLast = Math.max(dailyStart, dailyStart + dates.length - 1);
  const dailyTotals = dailyLast + 1;
  putCell(worksheet, dailyTotals, 1, 'Total', { font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  for (let column = 2; column <= 8; column += 1) {
    putCell(worksheet, dailyTotals, column, `=SUM(${columnLetter(column)}${dailyStart}:${columnLetter(column)}${dailyLast})`, {
      format: column === 2 ? INT : NUM,
      font: PACK_FONTS.bold,
      fill: PACK_FILLS.total,
    });
  }
  putCell(worksheet, dailyTotals + 1, 1, 'Check: daily total minus key-figure total (0 = ties)', { font: PACK_FONTS.subtitle, border: false });
  putCell(worksheet, dailyTotals + 1, 3, `=ROUND(C${dailyTotals}-B11,2)`, { format: NUM, border: false });
  worksheet.getCell(dailyTotals + 2, 1).value = 'The daily table lists the days that have receipts. If you import newer receipts, add a row for the new date and copy the formulas across.';
  worksheet.getCell(dailyTotals + 2, 1).font = PACK_FONTS.subtitle;

  [34, 14, 16, 16, 14, 14, 14, 14].forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });
  finishSheet(worksheet, { landscape: true });
  return { dates, lastRow: dailyTotals };
};

const itemCriteria = (row) => `${lineRange('D')},$B${row},${lineRange('E')},$C${row},${lineRange('F')},$D${row},${lineRange('K')},"posted",${dateRangeCriteria()}`;

function dateRangeCriteria() {
  return `${lineRange('A')},">="&'Sales Summary'!$B$3,${lineRange('A')},"<"&'Sales Summary'!$B$4+1`;
}

const writeSalesByItemSheet = (workbook, lines, data) => {
  const worksheet = workbook.addWorksheet('Sales by Item');
  writeSheetTitle(worksheet, 'Sales by item', packSubtitle(data));
  writeNoteBox(worksheet, 3, 'Posted receipts only, within the dates on the Sales Summary sheet. Sorted by sales at export time; Rank is live.', 9);

  const totals = new Map();
  lines.filter((line) => line.receiptStatus === 'posted').forEach((line) => {
    const key = `${line.name}\u0000${line.category}\u0000${line.centre}`;
    const existing = totals.get(key);
    if (existing) existing.sales += line.qty * line.price;
    else totals.set(key, { name: line.name, category: line.category, centre: line.centre, sales: line.qty * line.price });
  });
  const rows = [...totals.values()].sort((a, b) => (b.sales - a.sales) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  writeTableHeader(worksheet, 6, ['Rank', 'Item', 'Category', 'Dept / centre', 'Qty sold', 'Sales', 'Avg price', '% of sales', 'Stock-tracked?'], [7, 32, 16, 14, 10, 14, 12, 11, 14]);

  const firstRow = 7;
  const lastRow = Math.max(firstRow, firstRow + rows.length - 1);
  rows.forEach((item, index) => {
    const row = firstRow + index;
    const criteria = itemCriteria(row);
    putCell(worksheet, row, 1, `=RANK(F${row},$F$${firstRow}:$F$${lastRow})`, { format: INT });
    putCell(worksheet, row, 2, item.name);
    putCell(worksheet, row, 3, item.category);
    putCell(worksheet, row, 4, item.centre);
    putCell(worksheet, row, 5, `=SUMIFS(${lineRange('G')},${criteria})`, { format: QTY });
    putCell(worksheet, row, 6, `=SUMIFS(${lineRange('I')},${criteria})`, { format: NUM });
    putCell(worksheet, row, 7, `=IFERROR(F${row}/E${row},0)`, { format: NUM });
    putCell(worksheet, row, 8, `=IFERROR(F${row}/$F$${firstRow + rows.length},0)`, { format: PCT });
    putCell(worksheet, row, 9, `=IF(COUNTIFS(${criteria},${lineRange('J')},"Yes")>0,"Yes","No")`);
  });

  const totalRow = lastRow + 1;
  putCell(worksheet, totalRow, 2, 'Total', { font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  [1, 3, 4, 7, 9].forEach((column) => putCell(worksheet, totalRow, column, '', { fill: PACK_FILLS.total }));
  putCell(worksheet, totalRow, 5, `=SUM(E${firstRow}:E${lastRow})`, { format: QTY, font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  putCell(worksheet, totalRow, 6, `=SUM(F${firstRow}:F${lastRow})`, { format: NUM, font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  putCell(worksheet, totalRow, 8, `=SUM(H${firstRow}:H${lastRow})`, { format: PCT, font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  putCell(worksheet, totalRow + 2, 2, 'Sales before discount per Receipts sheet', { border: false });
  putCell(worksheet, totalRow + 2, 6, "='Sales Summary'!B8", { format: NUM, font: PACK_FONTS.link, border: false });
  putCell(worksheet, totalRow + 3, 2, 'Difference (0 = items tie to receipts)', { font: PACK_FONTS.bold, border: false });
  putCell(worksheet, totalRow + 3, 6, `=ROUND(F${totalRow}-F${totalRow + 2},2)`, { format: NUM, font: PACK_FONTS.bold, border: false });
  addCellRule(worksheet, `F${totalRow + 3}`, 'notEqual', '0', PACK_FILLS.red.fgColor.argb);
  if (rows.length) setAutoFilter(worksheet, 6, 1, lastRow, 9);
  finishSheet(worksheet, { freeze: 'A7' });
};

const categoryBlock = (worksheet, startRow, heading, columnLetterName, values) => {
  writeTableHeader(worksheet, startRow, [heading, 'Qty sold', 'Sales', '% of sales']);
  const firstRow = startRow + 1;
  values.forEach((value, index) => {
    const row = firstRow + index;
    const criteria = `${lineRange(columnLetterName)},$A${row},${lineRange('K')},"posted",${dateRangeCriteria()}`;
    putCell(worksheet, row, 1, value);
    putCell(worksheet, row, 2, `=SUMIFS(${lineRange('G')},${criteria})`, { format: QTY });
    putCell(worksheet, row, 3, `=SUMIFS(${lineRange('I')},${criteria})`, { format: NUM });
    putCell(worksheet, row, 4, `=IFERROR(C${row}/$C$${firstRow + values.length},0)`, { format: PCT });
  });
  const totalRow = firstRow + values.length;
  putCell(worksheet, totalRow, 1, 'Total', { font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  putCell(worksheet, totalRow, 2, `=SUM(B${firstRow}:B${totalRow - 1})`, { format: QTY, font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  putCell(worksheet, totalRow, 3, `=SUM(C${firstRow}:C${totalRow - 1})`, { format: NUM, font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  putCell(worksheet, totalRow, 4, `=SUM(D${firstRow}:D${totalRow - 1})`, { format: PCT, font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  return totalRow;
};

const writeByCategorySheet = (workbook, lines, data) => {
  const worksheet = workbook.addWorksheet('By Category');
  writeSheetTitle(worksheet, 'Sales by category and by department', packSubtitle(data));
  writeNoteBox(worksheet, 3, 'Same filters as Sales by Item (posted receipts, Sales Summary dates).', 6);

  const totalsFor = (key) => {
    const map = new Map();
    lines.filter((line) => line.receiptStatus === 'posted').forEach((line) => {
      map.set(line[key], (map.get(line[key]) || 0) + line.qty * line.price);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([value]) => value);
  };

  const categoryEnd = categoryBlock(worksheet, 5, 'Category', 'E', totalsFor('category'));
  categoryBlock(worksheet, categoryEnd + 3, 'Department / centre', 'F', totalsFor('centre'));
  [30, 12, 16, 12].forEach((width, index) => { worksheet.getColumn(index + 1).width = width; });
  finishSheet(worksheet, { landscape: false });
};

const writeVoidsSheet = (workbook, data) => {
  const worksheet = workbook.addWorksheet('Voids & Adjustments');
  const receipts = sortByCreatedAt(data.receipts || []);
  const shifts = shiftLookup(data.shifts);

  writeSheetTitle(worksheet, 'Voids, refunds and cashier adjustments', packSubtitle(data));
  let row = 4;
  putLabel(worksheet, row, 1, 'A. Voided receipts');
  row += 1;
  writeTableHeader(worksheet, row, ['Date & time', 'Receipt ref', 'Table', 'Room', 'Total', 'Reason on file'], [18, 14, 10, 10, 14, 36]);
  const voided = receipts.filter((receipt) => receipt.status === 'voided');
  const voidStart = row + 1;
  voided.forEach((receipt, index) => {
    const current = voidStart + index;
    putCell(worksheet, current, 1, excelDateTime(receipt.created_at), { format: DATETIME });
    putCell(worksheet, current, 2, shortId(receipt.id));
    putCell(worksheet, current, 3, safeText(receipt.table_number));
    putCell(worksheet, current, 4, safeText(receipt.room_number));
    putCell(worksheet, current, 5, asNumber(receipt.total), { format: NUM });
    putCell(worksheet, current, 6, safeText(receipt.void_reason) || '(not recorded on receipt)');
  });
  const voidLast = voidStart + Math.max(voided.length, 1) - 1;
  putCell(worksheet, voidLast + 1, 4, 'Total', { font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  putCell(worksheet, voidLast + 1, 5, `=SUM(E${voidStart}:E${voidLast})`, { format: NUM, font: PACK_FONTS.bold, fill: PACK_FILLS.total });

  row = voidLast + 4;
  putLabel(worksheet, row, 1, 'B. Approved cashier adjustments (void / refund / discount)');
  row += 1;
  writeTableHeader(worksheet, row, ['Date & time', 'Shift #', 'Type', 'Status', 'Amount', 'Reason'], [18, 14, 14, 12, 14, 36]);
  const adjustments = [...(data.adjustments || [])].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const adjustmentStart = row + 1;
  adjustments.forEach((adjustment, index) => {
    const current = adjustmentStart + index;
    putCell(worksheet, current, 1, excelDateTime(adjustment.created_at), { format: DATETIME });
    putCell(worksheet, current, 2, shifts.get(adjustment.shift_id) || '');
    putCell(worksheet, current, 3, safeText(adjustment.adjustment_type));
    putCell(worksheet, current, 4, safeText(adjustment.status));
    putCell(worksheet, current, 5, asNumber(adjustment.amount), { format: NUM });
    putCell(worksheet, current, 6, safeText(adjustment.reason));
  });
  const adjustmentLast = adjustmentStart + Math.max(adjustments.length, 1) - 1;
  putCell(worksheet, adjustmentLast + 1, 4, 'Total approved', { font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  putCell(worksheet, adjustmentLast + 1, 5, `=SUMIFS(E${adjustmentStart}:E${adjustmentLast},D${adjustmentStart}:D${adjustmentLast},"approved")`, { format: NUM, font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  worksheet.getCell(adjustmentLast + 2, 1).value = 'An approved void adjustment normally matches a voided receipt in table A. Do not add A and B together; they describe the same money.';
  worksheet.getCell(adjustmentLast + 2, 1).font = PACK_FONTS.subtitle;

  row = adjustmentLast + 5;
  putLabel(worksheet, row, 1, 'C. Item voids at the POS (items removed from an open order)');
  row += 1;
  writeTableHeader(worksheet, row, ['Date & time', 'Void no.', 'Order', 'Table', 'Waiter', 'Item', 'Category', 'Qty removed', 'Original qty', 'Reason', 'Removed by', 'Status'], [18, 12, 14, 8, 14, 26, 12, 11, 11, 28, 16, 10]);
  const voidItems = [...(data.voidItems || [])].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const itemStart = row + 1;
  voidItems.forEach((item, index) => {
    const current = itemStart + index;
    putCell(worksheet, current, 1, excelDateTime(item.created_at), { format: DATETIME });
    putCell(worksheet, current, 2, safeText(item.void_number));
    putCell(worksheet, current, 3, safeText(item.order_number));
    putCell(worksheet, current, 4, safeText(item.table_number));
    putCell(worksheet, current, 5, safeText(item.waiter));
    putCell(worksheet, current, 6, safeText(item.item_name));
    putCell(worksheet, current, 7, safeText(item.category));
    putCell(worksheet, current, 8, asNumber(item.removed_qty), { format: QTY });
    putCell(worksheet, current, 9, asNumber(item.original_qty), { format: QTY });
    putCell(worksheet, current, 10, safeText(item.reason));
    putCell(worksheet, current, 11, safeText(item.removed_by_name));
    putCell(worksheet, current, 12, safeText(item.status));
  });
  const itemLast = itemStart + Math.max(voidItems.length, 1) - 1;
  putCell(worksheet, itemLast + 1, 7, 'Total qty removed', { font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  putCell(worksheet, itemLast + 1, 8, `=SUM(H${itemStart}:H${itemLast})`, { format: QTY, font: PACK_FONTS.bold, fill: PACK_FILLS.total });

  finishSheet(worksheet, { landscape: true });
};

const packSubtitle = (data) => `${data.propertyName || 'OliTechs'}  |  Generated ${generatedAtLabel(data.generatedAt)} from the OliTech database  |  Amounts in ${data.currency || PACK_CURRENCY}`;

const salesNotes = (data) => [
  `Source: OliTech database, property "${data.propertyName || 'OliTechs'}". Export date ${generatedAtLabel(data.generatedAt)}. Times converted to Nairobi time (UTC+3).`,
  `Currency shown as ${data.currency || PACK_CURRENCY}. Figures reflect what was actually recorded and charged.`,
  'Only receipts with status "posted" count as sales. Voided receipts are listed separately and never added to sales.',
  'VAT reflects the tax actually charged on each receipt. No VAT is estimated or back-filled.',
  'Receipts made before the category/department fields existed: where the same item name appears on a newer receipt, its category is filled in from there (Item Lines, column M). Otherwise it shows "(not recorded)".',
  'Item lines are priced at the price on the receipt (Qty x Unit price). A zero unit price is flagged in red.',
  'Blue cells are inputs. All totals are formulas and recalculate when inputs or data rows change.',
  'To refresh: re-export from the software, or paste new rows below the last row of Receipts and Item Lines (formulas read down to row 2000).',
  'Guest phone numbers and reservation notes are deliberately left out of this workbook.',
];

export function buildSalesWorkbook(workbook, data = {}) {
  const summary = writeSalesSummarySheet(workbook, data);
  const lines = buildItemLines(sortByCreatedAt(data.receipts || []));
  writeSalesByItemSheet(workbook, lines, data);
  writeByCategorySheet(workbook, lines, data);
  writeVoidsSheet(workbook, data);
  writeItemLinesSheet(workbook, data, lines);
  writeNotesSheet(workbook.addWorksheet('Notes'), 'Notes and assumptions', salesNotes(data));
  writeReceiptsSheet(workbook, data);
  return { sheetNames: workbook.worksheets.map((sheet) => sheet.name), summary };
}

export { buildItemLines, paymentMethods };
