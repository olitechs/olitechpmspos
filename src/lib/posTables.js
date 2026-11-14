// Table numbering and floor-plan geometry shared by the POS floor screens and
// the table-setup admin screen.
//
// Numbering is independent per zone, so Restaurant Room #5 and Bar #5 are
// different tables. The Restaurant Room zone keeps the "R" prefix; every other
// zone uses "T".
export const TABLE_CARD = { w: 86, h: 64, pad: 16, stepX: 100, stepY: 82 };

export const tablePrefix = (zoneId) => (zoneId === 'room' ? 'R' : 'T');

export const tableLabel = (table, zoneId) => `${tablePrefix(zoneId ?? table?.zoneId)}${table?.number ?? ''}`;
