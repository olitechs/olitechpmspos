// Read-only data loaders for the upgrade-pack Excel exports.
//
// Everything runs with the signed-in user's Supabase session, so Row Level
// Security still decides what a property can see. The loaders only shape the
// rows the workbook builders need; no calculations happen here.

import { supabase } from '@/lib/supabaseClient';
import { inventoryService } from '@/services/inventoryService';

const PAGE_SIZE = 1000;
const MAX_ROWS = 20_000;
const ID_CHUNK = 200;

const nextDate = (value) => {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error('Select a valid report end date.');
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

export const todayKenya = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());

const rangeStamps = (from, to) => ({
  fromStamp: from ? `${String(from).slice(0, 10)}T00:00:00+03:00` : null,
  toStamp: to ? `${nextDate(to)}T00:00:00+03:00` : null,
});

const fetchPaged = async (table, { select = '*', propertyId, from, to, order = 'created_at', ascending = true }, onProgress) => {
  if (!propertyId) throw new Error('An active property is required to export reports.');
  const { fromStamp, toStamp } = rangeStamps(from, to);
  const rows = [];
  let offset = 0;
  while (offset <= MAX_ROWS) {
    let query = supabase.from(table)
      .select(select)
      .eq('property_id', propertyId)
      .order(order, { ascending })
      .range(offset, offset + PAGE_SIZE - 1);
    if (fromStamp) query = query.gte(order, fromStamp);
    if (toStamp) query = query.lt(order, toStamp);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = data || [];
    rows.push(...page);
    onProgress?.(rows.length);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  if (rows.length > MAX_ROWS) {
    throw new Error(`${table} contains more than ${MAX_ROWS.toLocaleString()} rows. Narrow the date range and export again.`);
  }
  return rows;
};

const fetchByIds = async (table, select, ids) => {
  if (!ids.length) return [];
  const rows = [];
  for (let index = 0; index < ids.length; index += ID_CHUNK) {
    const chunk = ids.slice(index, index + ID_CHUNK);
    const { data, error } = await supabase.from(table).select(select).in('id', chunk);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
  }
  return rows;
};

const shiftNumbers = async (ids) => {
  if (!ids.length) return [];
  try {
    return await fetchByIds('pos_shifts', 'id,shift_no', ids);
  } catch {
    // Legacy deployments still keep drawer numbers on cashier_shifts.
    return fetchByIds('cashier_shifts', 'id,shift_no', ids);
  }
};

const profileNames = async (ids) => {
  if (!ids.length) return [];
  try {
    return await fetchByIds('profiles', 'id,full_name,email', ids);
  } catch {
    return [];
  }
};

export const packExportDataService = {
  async loadSalesExport(propertyId, from, to, onProgress = () => {}) {
    const receipts = await fetchPaged('pos_receipts', {
      select: 'id,property_id,created_at,order_number,table_number,room_number,guest_name,waiter,items,subtotal,discount_amount,vat,total,payment_method,status,void_reason,folio_charge_id,created_by,shift_id,pos_shift_id',
      propertyId,
      from,
      to,
    }, onProgress);

    const [adjustments, voidItems] = await Promise.all([
      fetchPaged('cashier_adjustments', { select: '*', propertyId, from, to }, null),
      fetchPaged('pos_void_items', { select: '*', propertyId, from, to }, null),
    ]);

    const shiftIds = [...new Set(receipts.flatMap((receipt) => [receipt.shift_id, receipt.pos_shift_id]).filter(Boolean))];
    const profileIds = [...new Set([
      ...receipts.map((receipt) => receipt.created_by).filter(Boolean),
      ...adjustments.map((adjustment) => adjustment.created_by).filter(Boolean),
      ...voidItems.map((item) => item.removed_by).filter(Boolean),
    ])];
    const [shifts, profiles] = await Promise.all([shiftNumbers(shiftIds), profileNames(profileIds)]);

    return { receipts, adjustments, voidItems, shifts, profiles };
  },

  async loadStockExport(propertyId, { from, to, category = 'all', location = 'all' } = {}, onProgress = () => {}) {
    if (!propertyId) throw new Error('An active property is required to export stock reports.');
    if (from && to && from > to) throw new Error('The stock report start date must be on or before the end date.');
    const [products, movements, stockLocations, adjustments] = await Promise.all([
      inventoryService.listProducts(propertyId, { category, location }),
      inventoryService.listMovementsForReport(propertyId, { from, to, category, location }, onProgress),
      fetchPaged('product_stock_locations', {
        select: 'product_id,qty,location:inventory_locations(name)',
        propertyId,
        order: 'product_id',
      }, null),
      fetchPaged('stock_adjustments', {
        select: 'id,created_at,product_id,location_id,change_qty,reason,status,created_by,location:inventory_locations(name)',
        propertyId,
      }, null),
    ]);

    const stockLocationRows = stockLocations.map((row) => ({ ...row, location_name: row.location?.name || '' }));
    const profileIds = [...new Set(adjustments.map((adjustment) => adjustment.created_by).filter(Boolean))];
    const profiles = await profileNames(profileIds);
    const nameById = new Map(profiles.map((profile) => [profile.id, profile.full_name || profile.email || '']));
    const adjustmentsWithUser = adjustments.map((adjustment) => ({
      ...adjustment,
      location_name: adjustment.location?.name || '',
      created_by_name: nameById.get(adjustment.created_by) || '',
    }));

    return { products, movements, stockLocations: stockLocationRows, adjustments: adjustmentsWithUser };
  },

  async loadFrontOfficeExport(propertyId) {
    if (!propertyId) throw new Error('An active property is required to export front office reports.');
    const [reservations, rooms, folioCharges, payments] = await Promise.all([
      fetchPaged('reservations', { select: '*', propertyId, order: 'arrival' }, null),
      fetchPaged('rooms', { select: '*', propertyId, order: 'number' }, null),
      fetchPaged('folio_charges', { select: 'id,created_at,reservation_id,source,description,amount', propertyId }, null),
      fetchPaged('payments', { select: 'id,created_at,reservation_id,amount,method,status', propertyId }, null),
    ]);
    return { reservations, rooms, folioCharges, payments };
  },
};
