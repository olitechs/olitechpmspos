// Stock workbook (Storekeeper) — matches the upgrade pack's
// OliTech_Stock_Reports layout: Stock Summary, Stock Position, Stock
// Movements, Stock Card, Adjustment Form and Notes, plus a sheet of recorded
// stock adjustments.
//
// Status, variance and valuation columns are formulas. Only the opening
// quantity on the Stock Card and the Adjustment Form's blue cells are inputs.

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

const POSITION_START_ROW = 5;
const MOVEMENT_START_ROW = 6;
const ADJUSTMENT_FORM_ROWS = 60;
const ADJUSTMENT_REASONS = [
  'Count correction',
  'Damaged / broken',
  'Expired',
  'Spoilage / wastage',
  'Theft / loss',
  'Received not recorded',
  'Transfer correction',
  'Other',
];

const positionRange = (column) => `'Stock Position'!$${column}$${POSITION_START_ROW}:$${column}$${LAST_TEMPLATE_ROW}`;
const movementRange = (column) => `'Stock Movements'!$${column}$${6}:$${column}$${LAST_TEMPLATE_ROW}`;

const sortProducts = (products) => [...products].sort((a, b) => {
  const category = safeText(a.category).toLowerCase().localeCompare(safeText(b.category).toLowerCase());
  if (category !== 0) return category;
  return safeText(a.name).toLowerCase().localeCompare(safeText(b.name).toLowerCase());
});

const sortMovements = (movements) => [...movements].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));

const mainStoreMap = (stockLocations = []) => {
  const map = new Map();
  stockLocations.forEach((row) => {
    const name = safeText(row.location_name || row.location?.name).toLowerCase();
    if (!map.has(row.product_id) || name === 'main store') map.set(row.product_id, asNumber(row.qty));
  });
  return map;
};

const movementProductId = (movement) => movement.product_id || movement.product?.id || '';

const packSubtitle = (data) => `${data.propertyName || 'OliTechs'}  |  Generated ${generatedAtLabel(data.generatedAt)} from the OliTech database  |  Amounts in ${data.currency || PACK_CURRENCY}`;

export const writeStockPositionSheet = (workbook, data) => {
  const worksheet = workbook.addWorksheet('Stock Position');
  const products = sortProducts(data.products || []);

  writeSheetTitle(worksheet, 'Stock position (all products)', packSubtitle(data));
  writeNoteBox(worksheet, 3, 'Quantity is the system quantity on hand. Status and Data flags are formulas. Filter column O to see Out of stock / Low items. Add new products by copying the formulas in columns L-P down.', 16);
  writeTableHeader(worksheet, 4, [
    'ID', 'SKU', 'Product', 'Category', 'Unit', 'Location', 'Qty on hand', 'Min level', 'Max level', 'Cost price',
    'Selling price', 'Stock value @ cost', 'Stock value @ selling', 'Margin %', 'Status', 'Data flags',
  ], [10, 10, 34, 20, 8, 12, 11, 10, 10, 12, 12, 15, 15, 10, 14, 40]);

  products.forEach((product, index) => {
    const row = POSITION_START_ROW + index;
    putCell(worksheet, row, 1, shortId(product.id));
    putCell(worksheet, row, 2, safeText(product.sku));
    putCell(worksheet, row, 3, safeText(product.name));
    putCell(worksheet, row, 4, safeText(product.category));
    putCell(worksheet, row, 5, safeText(product.unit));
    putCell(worksheet, row, 6, safeText(product.location));
    putCell(worksheet, row, 7, asNumber(product.current_stock), { format: QTY });
    putCell(worksheet, row, 8, asNumber(product.min_stock), { format: QTY });
    putCell(worksheet, row, 9, asNumber(product.max_stock), { format: QTY });
    putCell(worksheet, row, 10, asNumber(product.cost_price), { format: NUM });
    putCell(worksheet, row, 11, asNumber(product.selling_price), { format: NUM });
    putCell(worksheet, row, 12, `=G${row}*J${row}`, { format: NUM });
    putCell(worksheet, row, 13, `=G${row}*K${row}`, { format: NUM });
    putCell(worksheet, row, 14, `=IF(AND(J${row}>0,K${row}>0),(K${row}-J${row})/K${row},"")`, { format: PCT });
    putCell(worksheet, row, 15, `=IF(G${row}<=0,"Out of stock",IF(AND(H${row}>0,G${row}<H${row}),"Low","OK"))`);
    putCell(worksheet, row, 16, `=TRIM(IF(J${row}=0,"No cost price. ","")&IF(K${row}=0,"No selling price. ","")&IF(H${row}=0,"No min level. ","")&IF(B${row}="","No SKU. ",""))`);
  });

  const lastRow = Math.max(POSITION_START_ROW, POSITION_START_ROW + products.length - 1);
  addCellRule(worksheet, `O${POSITION_START_ROW}:O${LAST_TEMPLATE_ROW}`, 'equal', '"Out of stock"', PACK_FILLS.red.fgColor.argb);
  addCellRule(worksheet, `O${POSITION_START_ROW}:O${LAST_TEMPLATE_ROW}`, 'equal', '"Low"', PACK_FILLS.amber.fgColor.argb);
  if (products.length) setAutoFilter(worksheet, 4, 1, lastRow, 16);
  finishSheet(worksheet, { freeze: 'D5' });
  return { products, lastRow };
};

export const writeStockMovementsSheet = (workbook, data) => {
  const worksheet = workbook.addWorksheet('Stock Movements');
  const movements = sortMovements(data.movements || []);

  writeSheetTitle(worksheet, 'Stock movements ledger', packSubtitle(data));
  putLabel(worksheet, 3, 1, 'Total in');
  putCell(worksheet, 3, 2, '=SUMIFS(F6:F2000,E6:E2000,"in")', { format: QTY, font: PACK_FONTS.bold });
  putLabel(worksheet, 3, 3, 'Total out');
  putCell(worksheet, 3, 4, '=SUMIFS(F6:F2000,E6:E2000,"out")', { format: QTY, font: PACK_FONTS.bold });
  putLabel(worksheet, 3, 5, 'Net change');
  putCell(worksheet, 3, 6, '=B3-D3', { format: QTY, font: PACK_FONTS.bold });
  writeTableHeader(worksheet, 5, ['Date & time', 'Product ID', 'SKU', 'Product', 'Type', 'Qty', 'Signed qty (+in / -out)', 'Reason', 'Source', 'By user'], [17, 10, 10, 30, 7, 9, 14, 44, 14, 16]);

  movements.forEach((movement, index) => {
    const row = MOVEMENT_START_ROW + index;
    const product = movement.product || {};
    putCell(worksheet, row, 1, excelDateTime(movement.created_at), { format: DATETIME });
    putCell(worksheet, row, 2, shortId(movementProductId(movement)));
    putCell(worksheet, row, 3, safeText(product.sku));
    putCell(worksheet, row, 4, safeText(product.name) || '(deleted product)');
    putCell(worksheet, row, 5, safeText(movement.type));
    putCell(worksheet, row, 6, asNumber(movement.qty), { format: QTY });
    putCell(worksheet, row, 7, `=IF(E${row}="in",F${row},-F${row})`, { format: QTY });
    putCell(worksheet, row, 8, safeText(movement.reason));
    putCell(worksheet, row, 9, safeText(movement.source_type));
    putCell(worksheet, row, 10, safeText(movement.user_profile?.full_name));
  });

  const lastRow = Math.max(MOVEMENT_START_ROW, MOVEMENT_START_ROW + movements.length - 1);
  if (movements.length) setAutoFilter(worksheet, 5, 1, lastRow, 10);
  addCellRule(worksheet, `E${MOVEMENT_START_ROW}:E${lastRow}`, 'equal', '"out"', PACK_FILLS.amber.fgColor.argb);
  finishSheet(worksheet, { freeze: 'A6' });
  return { movements, lastRow };
};

export const writeStockCardSheet = (workbook, data) => {
  const worksheet = workbook.addWorksheet('Stock Card');
  const products = sortProducts(data.products || []);
  const movements = data.movements || [];
  const storeQty = mainStoreMap(data.stockLocations);
  const movedProductIds = new Set(movements.map(movementProductId));

  writeSheetTitle(worksheet, 'Stock card: movements vs system quantity', packSubtitle(data));
  writeNoteBox(worksheet, 3, 'For every product that has stock or movements: Opening + Received - Issued should equal the system quantity. "No movement trail" means stock exists that the ledger cannot explain. Opening quantity is assumed 0 because the first ledger entry is the bulk CSV import (edit the blue cells if you have an earlier count).', 13);
  writeTableHeader(worksheet, 5, ['ID', 'SKU', 'Product', 'Unit', 'Opening qty', 'Received (in)', 'Issued (out)', 'Ledger closing', 'System qty', 'Variance (system - ledger)', 'Main Store qty (store record)', 'Variance (store - system)', 'Result'], [10, 10, 30, 8, 11, 12, 12, 12, 11, 14, 14, 14, 22]);

  const relevant = products.filter((product) => movedProductIds.has(product.id) || asNumber(product.current_stock) !== 0 || storeQty.has(product.id));
  relevant.forEach((product, index) => {
    const row = 6 + index;
    putCell(worksheet, row, 1, shortId(product.id));
    putCell(worksheet, row, 2, safeText(product.sku));
    putCell(worksheet, row, 3, safeText(product.name));
    putCell(worksheet, row, 4, safeText(product.unit));
    putInput(worksheet, row, 5, 0, QTY);
    putCell(worksheet, row, 6, `=SUMIFS(${movementRange('F')},${movementRange('B')},$A${row},${movementRange('E')},"in")`, { format: QTY });
    putCell(worksheet, row, 7, `=SUMIFS(${movementRange('F')},${movementRange('B')},$A${row},${movementRange('E')},"out")`, { format: QTY });
    putCell(worksheet, row, 8, `=E${row}+F${row}-G${row}`, { format: QTY });
    putCell(worksheet, row, 9, `=IFERROR(INDEX(${positionRange('G')},MATCH($A${row},${positionRange('A')},0)),0)`, { format: QTY, font: PACK_FONTS.link });
    putCell(worksheet, row, 10, `=I${row}-H${row}`, { format: QTY });
    putCell(worksheet, row, 11, storeQty.get(product.id) || 0, { format: QTY });
    putCell(worksheet, row, 12, `=K${row}-I${row}`, { format: QTY });
    putCell(worksheet, row, 13, `=IF(AND(ABS(J${row})<0.0001,ABS(L${row})<0.0001),"OK",IF(AND(F${row}=0,G${row}=0),"No movement trail","Investigate"))`);
  });

  const lastRow = Math.max(6, 6 + relevant.length - 1);
  putCell(worksheet, lastRow + 1, 3, 'Totals', { font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  [6, 7, 8, 9, 10, 11, 12].forEach((column) => {
    putCell(worksheet, lastRow + 1, column, `=SUM(${columnLetter(column)}6:${columnLetter(column)}${lastRow})`, { format: QTY, font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  });
  addCellRule(worksheet, `M6:M${lastRow}`, 'equal', '"OK"', PACK_FILLS.green.fgColor.argb);
  addCellRule(worksheet, `M6:M${lastRow}`, 'notEqual', '"OK"', PACK_FILLS.red.fgColor.argb);
  worksheet.getCell('E5').note = 'Assumption: opening quantity is 0 because the earliest stock movement on file is the first bulk CSV import.';
  finishSheet(worksheet, { freeze: 'D6' });
  return { relevant, lastRow };
};

export const writeAdjustmentFormSheet = (workbook, data) => {
  const worksheet = workbook.addWorksheet('Adjustment Form');
  const products = sortProducts(data.products || []);
  const stockLocations = mainStoreMap(data.stockLocations);

  writeSheetTitle(worksheet, 'Stock adjustment form (count correction, damage, expiry, loss)', packSubtitle(data));
  const legend = [
    'HOW TO USE: fill the BLUE cells only. Everything else fills itself.',
    '1) Product ID: copy the 8-character ID from the Stock Position sheet (column A).   2) Counted qty: what is physically on the shelf.',
    '3) Variance and Value of variance calculate automatically. Choose a Reason from the list. A manager signs the Approved by column before the system is changed.',
    'The first row is an EXAMPLE (using a real product). Delete it before use.',
  ];
  legend.forEach((text, index) => {
    const cell = worksheet.getCell(3 + index, 1);
    cell.value = text;
    cell.font = index === 0 ? PACK_FONTS.bold : PACK_FONTS.subtitle;
  });

  writeTableHeader(worksheet, 8, ['Date', 'Product ID', 'Product', 'Unit', 'System qty', 'Counted qty', 'Variance', 'Unit cost', 'Value of variance', 'Reason', 'Notes', 'Adjusted by', 'Approved by'], [12, 12, 32, 8, 11, 11, 11, 11, 15, 22, 28, 16, 16]);

  const firstRow = 9;
  const lastRow = firstRow + ADJUSTMENT_FORM_ROWS - 1;
  for (let row = firstRow; row <= lastRow; row += 1) {
    putInput(worksheet, row, 1, null, DATE);
    putInput(worksheet, row, 2, null);
    putCell(worksheet, row, 3, `=IF($B${row}="","",IFERROR(INDEX(${positionRange('C')},MATCH($B${row},${positionRange('A')},0)),"ID not found"))`);
    putCell(worksheet, row, 4, `=IF($B${row}="","",IFERROR(INDEX(${positionRange('E')},MATCH($B${row},${positionRange('A')},0)),""))`);
    putCell(worksheet, row, 5, `=IF($B${row}="","",IFERROR(INDEX(${positionRange('G')},MATCH($B${row},${positionRange('A')},0)),""))`, { format: QTY });
    putInput(worksheet, row, 6, null, QTY);
    putCell(worksheet, row, 7, `=IF(OR($B${row}="",$F${row}="",$E${row}=""),"",$F${row}-$E${row})`, { format: QTY });
    putCell(worksheet, row, 8, `=IF($B${row}="","",IFERROR(INDEX(${positionRange('J')},MATCH($B${row},${positionRange('A')},0)),0))`, { format: NUM });
    putCell(worksheet, row, 9, `=IF($G${row}="","",$G${row}*$H${row})`, { format: NUM });
    putInput(worksheet, row, 10, null);
    putInput(worksheet, row, 11, null);
    putInput(worksheet, row, 12, null);
    putInput(worksheet, row, 13, null);
    worksheet.getCell(row, 6).dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: ['0'], errorTitle: 'Counted qty', error: 'Enter a number of 0 or more.' };
    worksheet.getCell(row, 10).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${ADJUSTMENT_REASONS.join(',')}"`] };
  }

  const example = products.find((product) => stockLocations.has(product.id) && asNumber(product.current_stock) > 0) || products[0];
  if (example) {
    worksheet.getCell('A9').value = excelDate(data.generatedAt);
    worksheet.getCell('A9').numFmt = DATE;
    worksheet.getCell('B9').value = shortId(example.id);
    worksheet.getCell('F9').value = Math.max(asNumber(example.current_stock) - 2, 0);
    worksheet.getCell('F9').numFmt = QTY;
    worksheet.getCell('J9').value = 'Damaged / broken';
    worksheet.getCell('K9').value = 'EXAMPLE ROW - delete before use';
    worksheet.getCell('L9').value = 'Storekeeper';
  }

  putCell(worksheet, lastRow + 1, 8, 'Total', { font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  putCell(worksheet, lastRow + 1, 7, `=SUM(G${firstRow}:G${lastRow})`, { format: QTY, font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  putCell(worksheet, lastRow + 1, 9, `=SUM(I${firstRow}:I${lastRow})`, { format: NUM, font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  addCellRule(worksheet, `G${firstRow}:G${lastRow}`, 'lessThan', '0', PACK_FILLS.red.fgColor.argb);
  finishSheet(worksheet, { freeze: 'A9' });
  return { firstRow, lastRow };
};

const writeAdjustmentsRecordedSheet = (workbook, data) => {
  const worksheet = workbook.addWorksheet('Adjustments Recorded');
  const adjustments = [...(data.adjustments || [])].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const products = new Map((data.products || []).map((product) => [product.id, product]));

  writeSheetTitle(worksheet, 'Recorded stock adjustments', packSubtitle(data));
  writeNoteBox(worksheet, 3, 'Every adjustment posted through the stock ledger. This sheet is the audit trail behind the Adjustment Form; the form itself is for proposing counts before they are posted.', 10);
  writeTableHeader(worksheet, 5, ['Date & time', 'Product ID', 'SKU', 'Product', 'Location', 'Change qty', 'Reason', 'Status', 'Recorded by'], [17, 10, 10, 30, 14, 11, 30, 10, 18]);

  adjustments.forEach((adjustment, index) => {
    const row = 6 + index;
    const product = products.get(adjustment.product_id) || {};
    putCell(worksheet, row, 1, excelDateTime(adjustment.created_at), { format: DATETIME });
    putCell(worksheet, row, 2, shortId(adjustment.product_id));
    putCell(worksheet, row, 3, safeText(product.sku));
    putCell(worksheet, row, 4, safeText(product.name));
    putCell(worksheet, row, 5, safeText(adjustment.location_name || adjustment.location?.name));
    putCell(worksheet, row, 6, asNumber(adjustment.change_qty), { format: QTY });
    putCell(worksheet, row, 7, safeText(adjustment.reason));
    putCell(worksheet, row, 8, safeText(adjustment.status));
    putCell(worksheet, row, 9, safeText(adjustment.created_by_name));
  });

  const lastRow = Math.max(6, 6 + adjustments.length - 1);
  putCell(worksheet, lastRow + 1, 5, 'Net change', { font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  putCell(worksheet, lastRow + 1, 6, `=SUM(F6:F${lastRow})`, { format: QTY, font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  if (adjustments.length) setAutoFilter(worksheet, 5, 1, lastRow, 9);
  finishSheet(worksheet, { freeze: 'A6' });
};

const writeStockSummarySheet = (workbook, data, cardLastRow) => {
  const worksheet = workbook.getWorksheet('Stock Summary') || workbook.addWorksheet('Stock Summary');
  const products = data.products || [];
  const categories = [...new Set(products.map((product) => safeText(product.category) || '(none)'))].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  writeSheetTitle(worksheet, 'Stock summary', packSubtitle(data));
  writeTableHeader(worksheet, 4, ['Measure', 'Value'], [40, 16, 16, 16, 18]);
  const measures = [
    ['Products listed', `=COUNTA(${positionRange('C')})`, INT],
    ['Products with stock on hand', `=COUNTIF(${positionRange('G')},">0")`, INT],
    ['Out of stock', `=COUNTIF(${positionRange('O')},"Out of stock")`, INT],
    ['Low (below minimum, still in stock)', `=COUNTIF(${positionRange('O')},"Low")`, INT],
    [`Stock value at cost (${data.currency || PACK_CURRENCY})`, `=SUM(${positionRange('L')})`, NUM],
    [`Stock value at selling price (${data.currency || PACK_CURRENCY})`, `=SUM(${positionRange('M')})`, NUM],
    ['Products with no cost price', `=COUNTIFS(${positionRange('C')},"<>",${positionRange('J')},0)`, INT],
    ['Products with no selling price', `=COUNTIFS(${positionRange('C')},"<>",${positionRange('K')},0)`, INT],
    ['Stock received (ledger)', "='Stock Movements'!B3", QTY],
    ['Stock issued (ledger)', "='Stock Movements'!D3", QTY],
    ['Products where ledger does not explain system qty', `=COUNTIF('Stock Card'!M6:M${cardLastRow},"<>OK")`, INT],
  ];
  measures.forEach(([label, formula, format], index) => {
    putCell(worksheet, 5 + index, 1, label);
    putCell(worksheet, 5 + index, 2, formula, { format, font: formula.includes('Stock Movements') || formula.includes('Stock Card') ? PACK_FONTS.link : PACK_FONTS.base });
  });

  const blockStart = 5 + measures.length + 2;
  putLabel(worksheet, blockStart - 1, 1, 'By category');
  writeTableHeader(worksheet, blockStart, ['Category', 'Products', 'Qty on hand', `Value @ cost (${data.currency || PACK_CURRENCY})`, 'Out of stock']);
  categories.forEach((category, index) => {
    const row = blockStart + 1 + index;
    putCell(worksheet, row, 1, category);
    putCell(worksheet, row, 2, `=COUNTIF(${positionRange('D')},$A${row})`, { format: INT });
    putCell(worksheet, row, 3, `=SUMIFS(${positionRange('G')},${positionRange('D')},$A${row})`, { format: QTY });
    putCell(worksheet, row, 4, `=SUMIFS(${positionRange('L')},${positionRange('D')},$A${row})`, { format: NUM });
    putCell(worksheet, row, 5, `=COUNTIFS(${positionRange('D')},$A${row},${positionRange('O')},"Out of stock")`, { format: INT });
  });
  const categoryLast = blockStart + categories.length;
  putCell(worksheet, categoryLast + 1, 1, 'Total', { font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  [[2, INT], [3, QTY], [4, NUM], [5, INT]].forEach(([column, format]) => {
    putCell(worksheet, categoryLast + 1, column, `=SUM(${columnLetter(column)}${blockStart + 1}:${columnLetter(column)}${categoryLast})`, { format, font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  });
  finishSheet(worksheet, { landscape: false });
};

const stockNotes = (data) => [
  `Source: OliTech database, products and stock movements for "${data.propertyName || 'OliTechs'}", exported ${generatedAtLabel(data.generatedAt)}.`,
  'Stock value uses the cost and selling prices stored in the software. Where a price is missing, the workbook flags it and leaves the value at zero; nothing is estimated or filled in.',
  'Low = quantity below the minimum level while some stock remains. Out of stock = zero or negative quantity.',
  'The ledger (Stock Movements) contains only what the software recorded: purchases, POS sales, usage, transfers and adjustments that were actually posted.',
  'Stock Card compares Opening + Received - Issued with the system quantity and the Main Store record. Any difference is flagged.',
  'Product names are shown exactly as stored, including typos.',
  'The Adjustment Form is a template: fill the blue cells, have a manager sign, then post the adjustment in the software. Recorded adjustments appear on the Adjustments Recorded sheet.',
  'Blue cells are inputs. All totals and status columns are formulas (they read down to row 2000).',
];

export function buildStockWorkbook(workbook, data = {}) {
  workbook.addWorksheet('Stock Summary');
  const position = writeStockPositionSheet(workbook, data);
  writeStockMovementsSheet(workbook, data);
  const card = writeStockCardSheet(workbook, data);
  writeAdjustmentFormSheet(workbook, data);
  writeAdjustmentsRecordedSheet(workbook, data);
  writeNotesSheet(workbook.addWorksheet('Notes'), 'Notes and assumptions', stockNotes(data));
  writeStockSummarySheet(workbook, data, card.lastRow);
  return { sheetNames: workbook.worksheets.map((sheet) => sheet.name), position };
}

export function buildAdjustmentFormWorkbook(workbook, data = {}) {
  writeStockPositionSheet(workbook, data);
  writeAdjustmentFormSheet(workbook, data);
  return { sheetNames: workbook.worksheets.map((sheet) => sheet.name) };
}

export { ADJUSTMENT_REASONS };
