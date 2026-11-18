// Front Office workbook — matches the upgrade pack's
// OliTech_Front_Office_Reports layout: Dashboard, Reservations, Rooms, Folio
// Charges, Payments, Folio Summary, Occupancy Grid and Notes.
//
// The Dashboard report date and the Occupancy Grid month are the only blue
// inputs. Attention flags, nights, balances and occupancy are formulas.
// Guest phone numbers, notes and special requests are never exported.

import {
  DATE,
  DATETIME,
  DAY,
  INT,
  LAST_TEMPLATE_ROW,
  NUM,
  PACK_CURRENCY,
  PACK_FILLS,
  PACK_FONTS,
  PCT,
  addCellRule,
  addFormulaRule,
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

const RESERVATION_START_ROW = 7;
const RESERVATION_END_ROW = 500;
const DASHBOARD_DATE = 'Dashboard!$B$3';

const reservationRange = (column) => `Reservations!$${column}$${RESERVATION_START_ROW}:$${column}$${RESERVATION_END_ROW}`;
const chargeRange = (column) => `'Folio Charges'!$${column}$${6}:$${column}$${LAST_TEMPLATE_ROW}`;
const paymentRange = (column) => `Payments!$${column}$${6}:$${column}$${LAST_TEMPLATE_ROW}`;
const roomRange = (column) => `Rooms!$${column}$${6}:$${column}$${200}`;

const packSubtitle = (data) => `${data.propertyName || 'OliTechs'}  |  Generated ${generatedAtLabel(data.generatedAt)} from the OliTech database  |  Amounts in ${data.currency || PACK_CURRENCY}`;

const sortReservations = (rows) => [...rows].sort((a, b) => {
  const arrival = String(a.arrival || '').localeCompare(String(b.arrival || ''));
  if (arrival !== 0) return arrival;
  return safeText(a.guest_name).toLowerCase().localeCompare(safeText(b.guest_name).toLowerCase());
});

const writeReservationsSheet = (workbook, data) => {
  const worksheet = workbook.addWorksheet('Reservations');
  const reservations = sortReservations(data.reservations || []);
  const rooms = new Map((data.rooms || []).map((room) => [room.id, room]));

  writeSheetTitle(worksheet, 'Reservations register', packSubtitle(data));
  writeNoteBox(worksheet, 3, 'Booking ref = first 8 characters of the system ID (the software has no confirmation codes on file). Column G, K, M, O and T are formulas. "Attention" compares each booking with the report date on the Dashboard.', 20);
  writeTableHeader(worksheet, 6, [
    'Booking ref', 'Guest', 'Room', 'Room name', 'Arrival', 'Departure', 'Nights', 'Adults', 'Children', 'Rate (stored)',
    'Expected total (nights x rate)', 'Total (stored)', 'Difference', 'Paid', 'Balance', 'Status', 'Payment status', 'Source', 'Meal plan', 'Attention',
  ], [11, 18, 7, 20, 12, 12, 8, 8, 9, 13, 16, 13, 13, 13, 13, 12, 15, 12, 11, 52]);

  reservations.forEach((reservation, index) => {
    const row = RESERVATION_START_ROW + index;
    const room = rooms.get(reservation.room_id) || {};
    putCell(worksheet, row, 1, shortId(reservation.id));
    putCell(worksheet, row, 2, safeText(reservation.guest_name));
    putCell(worksheet, row, 3, room.number ?? '');
    putCell(worksheet, row, 4, safeText(room.name));
    putCell(worksheet, row, 5, excelDate(reservation.arrival), { format: DATE });
    putCell(worksheet, row, 6, excelDate(reservation.departure), { format: DATE });
    putCell(worksheet, row, 7, `=F${row}-E${row}`, { format: INT });
    putCell(worksheet, row, 8, asNumber(reservation.adults), { format: INT });
    putCell(worksheet, row, 9, asNumber(reservation.children ?? reservation.kids_count), { format: INT });
    putCell(worksheet, row, 10, asNumber(reservation.rate), { format: NUM });
    putCell(worksheet, row, 11, `=G${row}*J${row}`, { format: NUM });
    putCell(worksheet, row, 12, asNumber(reservation.total_amount), { format: NUM });
    putCell(worksheet, row, 13, `=L${row}-K${row}`, { format: NUM });
    putCell(worksheet, row, 14, asNumber(reservation.amount_paid), { format: NUM });
    putCell(worksheet, row, 15, `=L${row}-N${row}`, { format: NUM });
    putCell(worksheet, row, 16, safeText(reservation.status));
    putCell(worksheet, row, 17, safeText(reservation.payment_status));
    putCell(worksheet, row, 18, safeText(reservation.source));
    putCell(worksheet, row, 19, safeText(reservation.meal_plan));
    putCell(worksheet, row, 20, `=TRIM(IF(AND(P${row}="checked-in",F${row}<${DASHBOARD_DATE}),"Past departure, not checked out. ","")`
      + `&IF(AND(P${row}="booked",F${row}<=${DASHBOARD_DATE}),"Stay dates passed, still booked. ",IF(AND(P${row}="booked",E${row}<=${DASHBOARD_DATE}),"Arrival date reached, not checked in. ",""))`
      + `&IF(AND(P${row}="checked-in",E${row}>${DASHBOARD_DATE}),"Checked in before arrival date. ","")`
      + `&IF(AND(L${row}=0,P${row}<>"cancelled"),"No total recorded. ","")`
      + `&IF(AND(L${row}<>0,ABS(M${row})>0.005),"Total differs from nights x rate. ","")`
      + `&IF(AND(Q${row}="fully_paid",L${row}=0),"Marked fully paid with zero total. ",""))`);
  });

  const lastRow = Math.max(RESERVATION_START_ROW, RESERVATION_START_ROW + reservations.length - 1);
  putCell(worksheet, lastRow + 1, 6, 'Totals', { font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  [12, 14, 15].forEach((column) => {
    putCell(worksheet, lastRow + 1, column, `=SUM(${columnLetter(column)}${RESERVATION_START_ROW}:${columnLetter(column)}${lastRow})`, { format: NUM, font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  });
  addFormulaRule(worksheet, `T${RESERVATION_START_ROW}:T${lastRow}`, `LEN(T${RESERVATION_START_ROW})>0`, PACK_FILLS.amber.fgColor.argb);
  addCellRule(worksheet, `M${RESERVATION_START_ROW}:M${lastRow}`, 'notEqual', '0', PACK_FILLS.red.fgColor.argb);
  if (reservations.length) setAutoFilter(worksheet, 6, 1, lastRow, 20);
  finishSheet(worksheet, { freeze: 'C7' });
  return { reservations, lastRow };
};

const writeRoomsSheet = (workbook, data) => {
  const worksheet = workbook.addWorksheet('Rooms');
  const rooms = [...(data.rooms || [])].sort((a, b) => Number(a.number || 0) - Number(b.number || 0));

  writeSheetTitle(worksheet, 'Rooms', packSubtitle(data));
  writeNoteBox(worksheet, 3, 'System status is what the software shows. "In-house per bookings" checks whether any booking covers the Dashboard report date. A mismatch means the room status is stale.', 8);
  writeTableHeader(worksheet, 5, ['Room no.', 'Name', 'Type', 'Base rate', 'System status', 'Active', 'In-house per bookings', 'Attention'], [9, 22, 12, 13, 14, 9, 18, 52]);

  rooms.forEach((room, index) => {
    const row = 6 + index;
    putCell(worksheet, row, 1, room.number ?? '');
    putCell(worksheet, row, 2, safeText(room.name));
    putCell(worksheet, row, 3, safeText(room.room_type));
    putCell(worksheet, row, 4, asNumber(room.base_rate), { format: NUM });
    putCell(worksheet, row, 5, safeText(room.status));
    putCell(worksheet, row, 6, room.active === false ? 'No' : 'Yes');
    putCell(worksheet, row, 7, `=IF(COUNTIFS(${reservationRange('C')},A${row},${reservationRange('E')},"<="&${DASHBOARD_DATE},${reservationRange('F')},">"&${DASHBOARD_DATE},${reservationRange('P')},"<>cancelled")>0,"Yes","No")`);
    putCell(worksheet, row, 8, `=TRIM(IF(AND(E${row}="occupied",G${row}="No"),"Marked occupied but no booking covers the report date. ","")&IF(AND(E${row}<>"occupied",G${row}="Yes"),"Booking in-house but room not marked occupied. ","")&IF(D${row}=0,"No base rate set. ","")&IF(B${row}="","No room name. ",""))`);
  });

  const lastRow = Math.max(6, 6 + rooms.length - 1);
  addFormulaRule(worksheet, `H6:H${lastRow}`, 'LEN(H6)>0', PACK_FILLS.amber.fgColor.argb);
  finishSheet(worksheet, { freeze: 'A6' });
};

const writeFolioChargesSheet = (workbook, data) => {
  const worksheet = workbook.addWorksheet('Folio Charges');
  const charges = [...(data.folioCharges || [])].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));

  writeSheetTitle(worksheet, 'Folio charges (room charges, POS charges, extras)', packSubtitle(data));
  writeTableHeader(worksheet, 5, ['Date', 'Booking ref', 'Guest', 'Source', 'Description', 'Amount'], [17, 12, 20, 9, 46, 14]);

  charges.forEach((charge, index) => {
    const row = 6 + index;
    putCell(worksheet, row, 1, excelDateTime(charge.created_at), { format: DATETIME });
    putCell(worksheet, row, 2, shortId(charge.reservation_id));
    putCell(worksheet, row, 3, `=IFERROR(INDEX(${reservationRange('B')},MATCH($B${row},${reservationRange('A')},0)),"?")`);
    putCell(worksheet, row, 4, safeText(charge.source));
    putCell(worksheet, row, 5, safeText(charge.description));
    putCell(worksheet, row, 6, asNumber(charge.amount), { format: NUM });
  });

  const lastRow = Math.max(6, 6 + charges.length - 1);
  putCell(worksheet, lastRow + 1, 5, 'Total charges', { font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  putCell(worksheet, lastRow + 1, 6, `=SUM(F6:F${lastRow})`, { format: NUM, font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  if (charges.length) setAutoFilter(worksheet, 5, 1, lastRow, 6);
  finishSheet(worksheet, { freeze: 'A6' });
};

const writePaymentsSheet = (workbook, data) => {
  const worksheet = workbook.addWorksheet('Payments');
  const payments = [...(data.payments || [])].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));

  writeSheetTitle(worksheet, 'Guest payments', packSubtitle(data));
  writeTableHeader(worksheet, 5, ['Date', 'Booking ref', 'Guest', 'Amount', 'Method', 'Status'], [17, 12, 20, 14, 12, 10]);

  payments.forEach((payment, index) => {
    const row = 6 + index;
    putCell(worksheet, row, 1, excelDateTime(payment.created_at), { format: DATETIME });
    putCell(worksheet, row, 2, shortId(payment.reservation_id));
    putCell(worksheet, row, 3, `=IFERROR(INDEX(${reservationRange('B')},MATCH($B${row},${reservationRange('A')},0)),"?")`);
    putCell(worksheet, row, 4, asNumber(payment.amount), { format: NUM });
    putCell(worksheet, row, 5, safeText(payment.method));
    putCell(worksheet, row, 6, safeText(payment.status));
  });

  const lastRow = Math.max(6, 6 + payments.length - 1);
  putCell(worksheet, lastRow + 1, 3, 'Total posted', { font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  putCell(worksheet, lastRow + 1, 4, `=SUMIFS(D6:D${lastRow},F6:F${lastRow},"posted")`, { format: NUM, font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  finishSheet(worksheet, { freeze: 'A6' });
};

const writeFolioSummarySheet = (workbook, data) => {
  const worksheet = workbook.addWorksheet('Folio Summary');
  const reservations = sortReservations(data.reservations || []);

  writeSheetTitle(worksheet, 'Guest folio summary (charges vs payments)', packSubtitle(data));
  writeNoteBox(worksheet, 3, 'One row per booking. Balance = total charges - posted payments. "Folio vs booking total" compares what was charged to the guest account with the total stored on the reservation.', 11);
  writeTableHeader(worksheet, 5, ['Booking ref', 'Guest', 'Stay', 'Room charges', 'POS / extras', 'Total charges', 'Payments (posted)', 'Balance due', 'Booking total (stored)', 'Folio vs booking total', 'Attention'], [11, 20, 22, 14, 14, 14, 15, 14, 16, 15, 46]);

  reservations.forEach((reservation, index) => {
    const row = 6 + index;
    putCell(worksheet, row, 1, shortId(reservation.id));
    putCell(worksheet, row, 2, `=INDEX(${reservationRange('B')},MATCH($A${row},${reservationRange('A')},0))`);
    putCell(worksheet, row, 3, `=TEXT(INDEX(${reservationRange('E')},MATCH($A${row},${reservationRange('A')},0)),"dd mmm yy")&" to "&TEXT(INDEX(${reservationRange('F')},MATCH($A${row},${reservationRange('A')},0)),"dd mmm yy")`);
    putCell(worksheet, row, 4, `=SUMIFS(${chargeRange('F')},${chargeRange('B')},$A${row},${chargeRange('D')},"room")`, { format: NUM });
    putCell(worksheet, row, 5, `=SUMIFS(${chargeRange('F')},${chargeRange('B')},$A${row},${chargeRange('D')},"<>room")`, { format: NUM });
    putCell(worksheet, row, 6, `=D${row}+E${row}`, { format: NUM });
    putCell(worksheet, row, 7, `=SUMIFS(${paymentRange('D')},${paymentRange('B')},$A${row},${paymentRange('F')},"posted")`, { format: NUM });
    putCell(worksheet, row, 8, `=F${row}-G${row}`, { format: NUM });
    putCell(worksheet, row, 9, `=INDEX(${reservationRange('L')},MATCH($A${row},${reservationRange('A')},0))`, { format: NUM, font: PACK_FONTS.link });
    putCell(worksheet, row, 10, `=F${row}-I${row}`, { format: NUM });
    putCell(worksheet, row, 11, `=TRIM(IF(H${row}>0.005,"Balance due. ","")&IF(AND(F${row}>0,ABS(J${row})>0.005),"Folio differs from booking total. ","")`
      + `&IF(AND(INDEX(${reservationRange('P')},MATCH($A${row},${reservationRange('A')},0))="checked-in",INDEX(${reservationRange('F')},MATCH($A${row},${reservationRange('A')},0))<${DASHBOARD_DATE},F${row}>0),"Charges still posting to an overdue in-house stay. ",""))`);
  });

  const lastRow = Math.max(6, 6 + reservations.length - 1);
  putCell(worksheet, lastRow + 1, 3, 'Totals', { font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  for (let column = 4; column <= 8; column += 1) {
    putCell(worksheet, lastRow + 1, column, `=SUM(${columnLetter(column)}6:${columnLetter(column)}${lastRow})`, { format: NUM, font: PACK_FONTS.bold, fill: PACK_FILLS.total });
  }
  addFormulaRule(worksheet, `K6:K${lastRow}`, 'LEN(K6)>0', PACK_FILLS.amber.fgColor.argb);
  addCellRule(worksheet, `H6:H${lastRow}`, 'greaterThan', '0.005', PACK_FILLS.red.fgColor.argb);
  finishSheet(worksheet, { freeze: 'C6' });
  return { lastRow };
};

const writeOccupancyGridSheet = (workbook, data) => {
  const worksheet = workbook.addWorksheet('Occupancy Grid');
  const rooms = [...(data.rooms || [])].sort((a, b) => Number(a.number || 0) - Number(b.number || 0));
  const monthStart = data.monthStart || excelDate(data.reportDate || data.generatedAt);
  const firstOfMonth = monthStart ? new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 1)) : null;

  writeSheetTitle(worksheet, 'Room occupancy calendar', packSubtitle(data));
  putLabel(worksheet, 3, 1, 'Month starts');
  putInput(worksheet, 3, 3, firstOfMonth, DATE);
  worksheet.getCell(3, 5).value = 'Change the blue date to view another period. Each cell shows the first letters of the guest staying that night (departure day is free). Cancelled bookings are ignored.';
  worksheet.getCell(3, 5).font = PACK_FONTS.subtitle;

  for (let offset = 0; offset < 31; offset += 1) {
    const column = 3 + offset;
    const letter = columnLetter(column);
    putCell(worksheet, 4, column, `=TEXT(${letter}5,"ddd")`, { font: PACK_FONTS.day, align: { horizontal: 'center' } });
    putCell(worksheet, 5, column, offset === 0 ? '=$C$3' : `=${columnLetter(column - 1)}5+1`, {
      format: DAY,
      font: PACK_FONTS.header,
      fill: PACK_FILLS.header,
      align: { horizontal: 'center' },
    });
    worksheet.getColumn(column).width = 5.3;
  }
  putCell(worksheet, 5, 1, 'Room', { font: PACK_FONTS.header, fill: PACK_FILLS.header });
  putCell(worksheet, 5, 2, 'Name', { font: PACK_FONTS.header, fill: PACK_FILLS.header });
  worksheet.getColumn(1).width = 7;
  worksheet.getColumn(2).width = 20;

  rooms.forEach((room, index) => {
    const row = 6 + index;
    putCell(worksheet, row, 1, room.number ?? '');
    putCell(worksheet, row, 2, safeText(room.name));
    for (let offset = 0; offset < 31; offset += 1) {
      const column = 3 + offset;
      const dayCell = `${columnLetter(column)}$5`;
      putCell(worksheet, row, column, `=IFERROR(LEFT(INDEX(${reservationRange('B')},MATCH(1,INDEX((${reservationRange('C')}=$A${row})*(${reservationRange('E')}<=${dayCell})*(${reservationRange('F')}>${dayCell})*(${reservationRange('P')}<>"cancelled"),0),0)),4),"")`, {
        font: PACK_FONTS.grid,
        align: { horizontal: 'center' },
      });
    }
  });

  const lastRow = Math.max(6, 6 + rooms.length - 1);
  addFormulaRule(worksheet, `C6:${columnLetter(33)}${lastRow}`, 'LEN(C6)>0', PACK_FILLS.occupancy.fgColor.argb);
  worksheet.getRow(5).height = 18;
  finishSheet(worksheet, { freeze: 'C6' });
};

const writeDashboardSheet = (workbook, data, folioLastRow) => {
  const worksheet = workbook.getWorksheet('Dashboard');
  writeSheetTitle(worksheet, 'Front office dashboard', packSubtitle(data));
  putLabel(worksheet, 3, 1, 'Report date');
  putInput(worksheet, 3, 2, excelDate(data.reportDate || data.generatedAt), DATE);
  worksheet.getCell(3, 3).value = 'Blue cell is an input. Change it and the Attention flags on Reservations, Rooms and Folio Summary update.';
  worksheet.getCell(3, 3).font = PACK_FONTS.subtitle;

  writeTableHeader(worksheet, 5, ['Measure', 'Value'], [44, 16]);
  const measures = [
    ['Arrivals on report date', `=COUNTIFS(${reservationRange('E')},$B$3,${reservationRange('P')},"<>cancelled")`, INT],
    ['Departures on report date', `=COUNTIFS(${reservationRange('F')},$B$3,${reservationRange('P')},"<>cancelled")`, INT],
    ['Rooms occupied that night (by booking dates)', `=COUNTIFS(${reservationRange('E')},"<="&$B$3,${reservationRange('F')},">"&$B$3,${reservationRange('P')},"<>cancelled")`, INT],
    ['Bookings with status "checked-in" in the system', `=COUNTIF(${reservationRange('P')},"checked-in")`, INT],
    ['Active rooms', `=COUNTIF(${roomRange('F')},"Yes")`, INT],
    ['Occupancy on report date', '=IFERROR(B8/B10,0)', PCT],
    ['Arrivals in the next 7 days', `=COUNTIFS(${reservationRange('E')},">"&$B$3,${reservationRange('E')},"<="&$B$3+7,${reservationRange('P')},"<>cancelled")`, INT],
    ['Booking balances due (total - paid, not cancelled)', `=SUMIFS(${reservationRange('O')},${reservationRange('P')},"<>cancelled",${reservationRange('A')},"<>")`, NUM],
    ['Folio balances due (charges - payments)', `='Folio Summary'!H${folioLastRow + 1}`, NUM],
    ['Bookings needing attention', `=COUNTIF(${reservationRange('T')},"?*")`, INT],
    ['Rooms needing attention', `=COUNTIF(${roomRange('H')},"?*")`, INT],
  ];
  measures.forEach(([label, formula, format], index) => {
    putCell(worksheet, 6 + index, 1, label);
    putCell(worksheet, 6 + index, 2, formula, { format, font: formula.startsWith("='Folio") ? PACK_FONTS.link : PACK_FONTS.base });
  });
  worksheet.getCell(6 + measures.length + 1, 1).value = `Currency: ${data.currency || PACK_CURRENCY}. Time zone: Nairobi.`;
  worksheet.getCell(6 + measures.length + 1, 1).font = PACK_FONTS.subtitle;
  finishSheet(worksheet, { landscape: false });
};

const frontOfficeNotes = (data) => [
  `Source: OliTech database, reservations, rooms, folio charges and payments for "${data.propertyName || 'OliTechs'}", exported ${generatedAtLabel(data.generatedAt)}.`,
  'Report date on the Dashboard defaults to the export date. Attention flags are relative to that date.',
  'Nights = Departure - Arrival. Expected total = Nights x stored rate (the rate is treated as per night). Where it differs from the stored total, the Difference column shows it.',
  'Guest phone numbers, notes and special requests are deliberately left out of this workbook.',
  'The Occupancy Grid shows a guest on every night from arrival up to, but not including, the departure date.',
  'Blue cells are inputs. Everything else is a formula.',
];

export function buildFrontOfficeWorkbook(workbook, data = {}) {
  workbook.addWorksheet('Dashboard');
  writeReservationsSheet(workbook, data);
  writeRoomsSheet(workbook, data);
  writeFolioChargesSheet(workbook, data);
  writePaymentsSheet(workbook, data);
  const folio = writeFolioSummarySheet(workbook, data);
  writeOccupancyGridSheet(workbook, data);
  writeNotesSheet(workbook.addWorksheet('Notes'), 'Notes and assumptions', frontOfficeNotes(data));
  writeDashboardSheet(workbook, data, folio.lastRow);
  return { sheetNames: workbook.worksheets.map((sheet) => sheet.name) };
}
