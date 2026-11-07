import { supabase } from '@/lib/supabaseClient';
import { inventoryService } from '@/services/inventoryService';
import { reportingService } from '@/services/reportingService';

const PAGE_SIZE = 1000;
const MAX_ROWS = 5000;

function eatBoundary(date, end = false) {
  return new Date(`${date}T${end ? '23:59:59.999' : '00:00:00'}+03:00`).toISOString();
}

function shiftBack(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

async function pagePropertyRows(table, columns, propertyId, from, to, { orderBy = 'created_at', limit = MAX_ROWS } = {}) {
  const collected = [];
  let offset = 0;
  while (offset < limit) {
    const size = Math.min(PAGE_SIZE, limit - offset);
    let query = supabase.from(table).select(columns).eq('property_id', propertyId).order(orderBy, { ascending: false }).range(offset, offset + size - 1);
    if (from) query = query.gte(orderBy, eatBoundary(from));
    if (to) query = query.lte(orderBy, eatBoundary(to, true));
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = data || [];
    collected.push(...rows);
    if (rows.length < size) return { rows: collected, truncated: false };
    offset += rows.length;
  }
  return { rows: collected, truncated: true };
}

async function readSection(errors, key, task, fallback) {
  try {
    return await task();
  } catch (error) {
    errors[key] = error?.message || 'This data source is not available.';
    return fallback;
  }
}

export const storekeeperDashboardService = {
  async load(propertyId, { today, weekFrom, monthFrom, from, to, includeCosts = true } = {}) {
    if (!propertyId) throw new Error('Select an active property to load the Storekeeper dashboard.');
    const errors = {};
    const movementFrom = from < shiftBack(today, 29) ? from : shiftBack(today, 29);
    const cappedMovementFrom = movementFrom < shiftBack(today, 89) ? shiftBack(today, 89) : movementFrom;
    const costField = includeCosts ? ',cost_price' : '';
    const movementColumns = `id,property_id,product_id,type,qty,reason,user_id,source_type,source_id,created_at,product:products(id,name,sku,category,unit,location${costField}),user_profile:profiles(full_name,email)`;
    const wastageColumns = `id,property_id,product_id,quantity,reason,created_at,product:products(id,name,sku,category,unit,location${costField})`;
    const countColumns = includeCosts
      ? '*, inventory_count_lines(*, product:products(id,name,cost_price))'
      : '*, inventory_count_lines(*)';

    const [products, valuation, expiry, purchases, movements, wastage, wastageToday, counts, transfers, salesToday, salesWeek, salesMonth, salesDetail, salesTodayDetail, salesItems, goodsReceipts] = await Promise.all([
      readSection(errors, 'products', () => inventoryService.listProducts(propertyId), []),
      includeCosts ? readSection(errors, 'valuation', () => inventoryService.getInventoryValuation(propertyId), []) : Promise.resolve([]),
      readSection(errors, 'expiry', () => inventoryService.listExpiryWatch(propertyId), []),
      readSection(errors, 'purchases', () => inventoryService.listPurchases(propertyId), []),
      readSection(errors, 'movements', () => pagePropertyRows('stock_movements', movementColumns, propertyId, cappedMovementFrom, today), { rows: [], truncated: false }),
      readSection(errors, 'wastage', () => pagePropertyRows('inventory_wastage', wastageColumns, propertyId, from, to), { rows: [], truncated: false }),
      readSection(errors, 'wastageToday', () => pagePropertyRows('inventory_wastage', wastageColumns, propertyId, today, today), { rows: [], truncated: false }),
      readSection(errors, 'counts', async () => {
        const { data, error } = await supabase.from('inventory_counts').select(countColumns).eq('property_id', propertyId).order('created_at', { ascending: false }).limit(100);
        if (error) throw new Error(error.message);
        return data || [];
      }, []),
      readSection(errors, 'transfers', () => pagePropertyRows('stock_transfers', '*', propertyId, shiftBack(today, 89), today, { limit: 1000 }), { rows: [], truncated: false }),
      readSection(errors, 'salesToday', () => reportingService.getManagementReport(propertyId, today, today), null),
      readSection(errors, 'salesWeek', () => reportingService.getManagementReport(propertyId, weekFrom, today), null),
      readSection(errors, 'salesMonth', () => reportingService.getManagementReport(propertyId, monthFrom, today), null),
      readSection(errors, 'salesDetail', () => reportingService.getSalesDetail(propertyId, from, to), null),
      readSection(errors, 'salesTodayDetail', () => reportingService.getSalesDetail(propertyId, today, today), null),
      readSection(errors, 'salesItems', () => pagePropertyRows('pos_receipts', 'id,property_id,status,items,total,created_at', propertyId, from, to), { rows: [], truncated: false }),
      readSection(errors, 'deliveries', async () => {
        const { data, error } = await supabase.from('goods_receipts').select('id,property_id,purchase_order_id,grn_no,received_at,goods_receipt_lines(id,product_id,qty,unit_cost,product:products(id,name,category,unit))').eq('property_id', propertyId).gte('received_at', eatBoundary(today)).lte('received_at', eatBoundary(today, true)).order('received_at', { ascending: false }).limit(100);
        if (error) throw new Error(error.message);
        return data || [];
      }, []),
    ]);

    return {
      products,
      valuation,
      expiry,
      purchases,
      movements: movements.rows,
      movementTruncated: movements.truncated,
      movementCoverageFrom: cappedMovementFrom,
      wastage: wastage.rows,
      wastageTruncated: wastage.truncated,
      wastageToday: wastageToday.rows,
      counts,
      transfers: transfers.rows,
      salesToday,
      salesWeek,
      salesMonth,
      salesDetail,
      salesTodayDetail,
      salesItems: salesItems.rows,
      salesItemsTruncated: salesItems.truncated,
      goodsReceipts,
      errors,
    };
  },
};
