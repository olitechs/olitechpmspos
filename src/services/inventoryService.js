import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { supabase } from '@/lib/supabaseClient';
import { getSessionStaff } from '@/services/authService';

export const STORE_CATEGORIES = ['F&B', 'Housekeeping', 'Laundry', 'Bar', 'Room Amenities', 'General'];
export const STORE_UNITS = ['kg', 'ltr', 'pcs', 'bottle'];
export const STORE_LOCATIONS = ['Main Store', 'Kitchen Store', 'Bar Store', 'Housekeeping Store'];

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));

function cleanProduct(row, propertyId, supplierId = null) {
  return {
    property_id: propertyId,
    sku: String(row.sku || '').trim() || null,
    name: String(row.name || '').trim(),
    category: String(row.category || 'General').trim() || 'General',
    unit: String(row.unit || 'pcs').trim() || 'pcs',
    current_stock: Number(row.current_stock ?? row.quantity ?? 0) || 0,
    min_stock: Number(row.min_stock ?? row.low_stock_threshold ?? 5) || 0,
    max_stock: Number(row.max_stock ?? 0) || 0,
    cost_price: Number(row.cost_price ?? 0) || 0,
    selling_price: Number(row.selling_price ?? 0) || 0,
    supplier_id: supplierId || row.supplier_id || null,
    location: String(row.location || 'Main Store').trim() || 'Main Store',
    expiry_date: row.expiry_date || null,
  };
}

export const inventoryService = {
  async listProducts(propertyId, { category, location, search } = {}) {
    let query = supabase.from('products').select('*, supplier:suppliers(id,name)').eq('property_id', propertyId).order('name');
    if (category && category !== 'all') query = query.eq('category', category);
    if (location && location !== 'all') query = query.eq('location', location);
    if (search) query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%`);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const role = String(getSessionStaff()?.role || '').toLowerCase();
    const canSeeCost = ['store_manager','fb_manager','hotel_admin','super_admin'].includes(role);
    return (data || []).map((product) => canSeeCost ? product : { ...product, cost_price: null });
  },

  async listPosCategories(propertyId) {
    const { data, error } = await supabase.from('pos_menu_categories').select('*').eq('property_id', propertyId).eq('active', true).order('sort_order').order('name');
    if (error) throw new Error(error.message);
    return data || [];
  },

  async listPosMenu(propertyId) {
    const { data, error } = await supabase.rpc('fn_list_pos_menu', { p_property_id: propertyId });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async upsertPosCategory({ propertyId, name, productionCenter = 'Kitchen', sortOrder = 0 }) {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('Category name is required.');
    const { data, error } = await supabase.from('pos_menu_categories').upsert({
      property_id: propertyId, name: clean, production_center: productionCenter || 'Kitchen', sort_order: Number(sortOrder) || 0, active: true,
    }, { onConflict: 'property_id,name' }).select('*').single();
    if (error) throw new Error(error.message);
    return data;
  },

  async upsertPosMenuItem(item) {
    const { data, error } = await supabase.rpc('fn_upsert_pos_menu_item', {
      p_property_id: item.propertyId,
      p_id: item.id || null,
      p_sku: item.sku || null,
      p_name: item.name,
      p_category: item.category || 'General',
      p_unit: item.unit || 'pcs',
      p_selling_price: Number(item.sellingPrice) || 0,
      p_current_stock: Number(item.currentStock) || 0,
      p_min_stock: Number(item.minStock) || 0,
      p_max_stock: Number(item.maxStock) || 0,
      p_production_center: item.productionCenter || 'Kitchen',
      p_sort: Number(item.sortOrder) || 0,
      p_active: item.active !== false,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  async bulkUpsertPosMenu(propertyId, rows) {
    const payload = (rows || []).filter(r => String(r.name || '').trim()).map(r => ({
      id: r.id || null,
      sku: r.sku || null,
      name: r.name,
      category: r.category || 'General',
      unit: r.unit || 'pcs',
      selling_price: Number(r.selling_price ?? r.sellingPrice ?? 0) || 0,
      current_stock: Number(r.current_stock ?? r.currentStock ?? 0) || 0,
      min_stock: Number(r.min_stock ?? r.minStock ?? 0) || 0,
      max_stock: Number(r.max_stock ?? r.maxStock ?? 0) || 0,
      production_center: r.production_center || r.productionCenter || 'Kitchen',
      pos_sort: Number(r.pos_sort ?? r.sortOrder ?? 0) || 0,
      pos_active: r.pos_active !== false,
    }));
    if (!payload.length) return 0;
    const { data, error } = await supabase.rpc('fn_bulk_upsert_pos_menu', { p_property_id: propertyId, p_rows: payload });
    if (error) throw new Error(error.message);
    return Number(data) || payload.length;
  },

  async createProduct(product) {
    if (!product?.property_id || !String(product?.name || '').trim()) throw new Error('Product name and property are required.');
    await this.bulkUpsertProducts(product.property_id, [product]);
    let query = supabase.from('products').select('*, supplier:suppliers(id,name)').eq('property_id', product.property_id);
    query = product.sku ? query.eq('sku', product.sku) : query.ilike('name', product.name);
    const { data, error } = await query.limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },

  async updateProduct(id, patch) {
    const { data: existing, error: readError } = await supabase.from('products').select('*').eq('id', id).single();
    if (readError) throw new Error(readError.message);
    const merged = { ...existing, ...patch, current_stock: Number(patch.current_stock ?? existing.current_stock) };
    await this.bulkUpsertProducts(existing.property_id, [merged]);
    const { data, error } = await supabase.from('products').select('*, supplier:suppliers(id,name)').eq('id', id).single();
    if (error) throw new Error(error.message);
    return data;
  },

  async listRecipes(propertyId) { const { data, error } = await supabase.from('recipes').select('*, recipe_ingredients(*, product:products(id,name,unit))').eq('property_id', propertyId).eq('active', true).order('menu_item_name'); if (error) throw new Error(error.message); return data || []; },

  async listInventoryReconciliation(propertyId) { const { data,error }=await supabase.rpc('fn_inventory_reconciliation',{p_property_id:propertyId}); if(error) throw new Error(error.message); return data||[]; },
  async listGoodsReceipts(propertyId) { const { data,error }=await supabase.from('goods_receipts').select('*, purchase_order:purchase_orders(invoice_no), goods_receipt_lines(*)').eq('property_id',propertyId).order('received_at',{ascending:false}); if(error) throw new Error(error.message); return data||[]; },

  async listPurchaseReceiving(propertyId) { const { data,error }=await supabase.from('purchase_orders').select('*, supplier:suppliers(id,name)').eq('property_id',propertyId).order('purchase_date',{ascending:false}); if(error) throw new Error(error.message); return data||[]; },
  async createPurchaseOrder(payload) { const { data,error }=await supabase.rpc('fn_create_purchase_order',{p_property_id:payload.propertyId,p_supplier_id:payload.supplierId||null,p_lines:payload.lines||[],p_invoice_no:payload.invoiceNo||null}); if(error) throw new Error(error.message); return data; },
  async receivePurchaseOrder(purchaseOrderId, receivedLines=null) { const { data,error }=await supabase.rpc('fn_receive_purchase_order',{p_purchase_order_id:purchaseOrderId,p_received_lines:receivedLines}); if(error) throw new Error(error.message); return data; },

  async listInventoryHistory(propertyId, filters = {}) {
    let q = supabase.from('inventory_stock_history').select('*').eq('property_id', propertyId).order('created_at', { ascending: false }).limit(500);
    if (filters.productId) q = q.eq('product_id', filters.productId);
    const { data, error } = await q; if (error) throw new Error(error.message); return data || [];
  },
  async getInventoryValuation(propertyId) {
    const { data, error } = await supabase.rpc('fn_inventory_valuation', { p_property_id: propertyId });
    if (error) throw new Error(error.message); return data || [];
  },
  async getInventoryValuationSummary(propertyId) {
    const { data, error } = await supabase.rpc('fn_inventory_valuation_summary', { p_property_id: propertyId });
    if (error) throw new Error(error.message); return Array.isArray(data) ? data[0] || null : data;
  },
  async listExpiryWatch(propertyId) {
    const { data, error } = await supabase.from('inventory_expiry_watch').select('*').eq('property_id', propertyId).order('expiry_date', { ascending: true });
    if (error) throw new Error(error.message); return data || [];
  },
  async postAdjustment(payload) {
    const { data, error } = await supabase.rpc('fn_post_stock_adjustment', { p_property_id: payload.propertyId, p_product_id: payload.productId, p_change: Number(payload.changeQty), p_reason: payload.reason, p_location_id: payload.locationId || null });
    if (error) throw new Error(error.message); return data;
  },
  async createInventoryCount(payload) {
    const { data, error } = await supabase.rpc('fn_create_inventory_count', { p_property_id: payload.propertyId, p_location_id: payload.locationId, p_lines: payload.lines || [], p_reference: payload.reference || null });
    if (error) throw new Error(error.message); return data;
  },
  async approveInventoryCount(countId) {
    const { data, error } = await supabase.rpc('fn_approve_inventory_count', { p_count_id: countId });
    if (error) throw new Error(error.message); return data;
  },
  async postWastage(payload) {
    const { data, error } = await supabase.rpc('fn_post_wastage', { p_property_id: payload.propertyId, p_product_id: payload.productId, p_quantity: Number(payload.quantity), p_reason: payload.reason, p_location_id: payload.locationId || null, p_expiry_date: payload.expiryDate || null });
    if (error) throw new Error(error.message); return data;
  },
  async postProduction(payload) {
    const { data, error } = await supabase.rpc('fn_post_production', { p_property_id: payload.propertyId, p_recipe_id: payload.recipeId, p_output_product_id: payload.outputProductId, p_quantity: Number(payload.quantity), p_reference: payload.reference || null });
    if (error) throw new Error(error.message); return data;
  },

  async listSuppliers(propertyId) {
    const { data, error } = await supabase.from('suppliers').select('*').eq('property_id', propertyId).order('name');
    if (error) throw new Error(error.message);
    return data || [];
  },

  async createSupplier({ propertyId, name, contact, phone, email, productsSupplied }) {
    const { data, error } = await supabase.from('suppliers').insert({ property_id: propertyId, name, contact, phone, email, products_supplied: productsSupplied || null }).select('*').single();
    if (error) throw new Error(error.message);
    return data;
  },

  async listMovements(propertyId, { from, to, category } = {}) {
    let query = supabase.from('stock_movements').select('*, product:products(id,name,sku,category,unit), user_profile:profiles(full_name,email)').eq('property_id', propertyId).order('created_at', { ascending: false });
    if (from) query = query.gte('created_at', `${from}T00:00:00`);
    if (to) query = query.lte('created_at', `${to}T23:59:59`);
    const { data, error } = await query.limit(500);
    if (error) throw new Error(error.message);
    if (category && category !== 'all') return (data || []).filter((m) => m.product?.category === category);
    return data || [];
  },

  async listUsage(propertyId) {
    const { data, error } = await supabase.from('stock_usage').select('*, product:products(name,sku,unit)').eq('property_id', propertyId).order('created_at', { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    return data || [];
  },

  async recordUsage({ propertyId, date, department, productId, qty, reference, notes }) {
    const amount = Number(qty) || 0;
    if (!productId || amount <= 0) throw new Error('Select a product and enter a quantity greater than zero.');
    const { data, error } = await supabase.rpc('fn_record_stock_usage', {
      p_property_id: propertyId,
      p_usage_date: date || null,
      p_department: department || 'General',
      p_product_id: productId,
      p_qty: amount,
      p_reference: reference || null,
      p_notes: notes || null,
    });
    if (error) throw new Error(error.message);
    return data;
  },
  async listPurchases(propertyId) {
    const { data, error } = await supabase.from('purchase_orders').select('*, supplier:suppliers(id,name)').eq('property_id', propertyId).order('purchase_date', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async createPurchase({ propertyId, supplierId, invoiceNo, purchaseDate, lines }) {
    const cleanLines = (lines || []).filter((l) => l.productId && Number(l.qty) > 0).map((l) => ({
      product_id: l.productId,
      qty: Number(l.qty),
      cost_price: Number(l.costPrice) || 0,
    }));
    if (!cleanLines.length) throw new Error('Add at least one purchase line.');
    const { data, error } = await supabase.rpc('fn_create_and_receive_purchase', {
      p_property_id: propertyId,
      p_supplier_id: supplierId || null,
      p_invoice_no: invoiceNo || null,
      p_purchase_date: purchaseDate || null,
      p_lines: cleanLines.map((line) => ({
        product_id: line.product_id,
        qty: line.qty,
        unit_cost: line.cost_price,
      })),
    });
    if (error) throw new Error(error.message);
    return data;
  },
  async adjustProductStock(productId, change, reason) {
    const { data, error } = await supabase.rpc('fn_adjust_product_stock', { p_product_id: productId, p_change: Number(change), p_reason: reason || 'Stock adjustment' });
    if (error) throw new Error(error.message);
    return data;
  },

  async deductStock(productId, qty, reason) {
    return this.adjustProductStock(productId, -Math.abs(Number(qty) || 0), reason || 'Stock deduction');
  },

  // POS integration. Product IDs may already be UUIDs; legacy/mock menu IDs are
  // resolved by name so existing POS menu items continue to work after the Store
  // module is enabled. Missing mappings are deliberately skipped and surfaced as
  // a non-blocking result so inventory can never roll back a completed sale.
  async deductStockForOrder({ propertyId, orderItems = [], reference = 'POS Sale' }) {
    if (!propertyId || !orderItems.length) return { deducted: [], skipped: [] };
    const deducted = [], skipped = [];
    for (const item of orderItems) {
      try {
        let product = null;
        if (isUuid(item.productId)) {
          const { data } = await supabase.from('products').select('*').eq('property_id', propertyId).eq('id', item.productId).maybeSingle();
          product = data;
        }
        if (!product && item.name) {
          const { data } = await supabase.from('products').select('*').eq('property_id', propertyId).ilike('name', item.name).limit(1).maybeSingle();
          product = data;
        }
        if (!product) { skipped.push({ ...item, reason: 'Product not mapped in Store' }); continue; }
        const result = await this.deductStock(product.id, Number(item.qty) || 0, `${reference} - ${item.qty}x ${product.name}`);
        deducted.push({ product, qty: Number(item.qty) || 0, result });
      } catch (error) {
        skipped.push({ ...item, reason: error.message });
      }
    }
    return { deducted, skipped };
  },

  async deductRoomAmenities({ propertyId, items = [], roomNumber }) {
    return this.deductStockForOrder({ propertyId, orderItems: items, reference: `PMS Check-in - Room ${roomNumber || ''}`.trim() });
  },

  async deductHousekeepingUsage({ productId, qty, roomNumber }) {
    return this.deductStock(productId, qty, `Housekeeping - Room ${roomNumber || ''}`.trim());
  },

  async deductLaundryUsage({ productId, qty, reference = 'Laundry Issue' }) {
    return this.deductStock(productId, qty, reference);
  },

  async getAlerts(propertyId) {
    const products = await this.listProducts(propertyId);
    const today = new Date();
    const in30 = new Date(today.getTime() + 30 * 86400000);
    return products.map((p) => {
      const stock = Number(p.current_stock || 0);
      const expiry = p.expiry_date ? new Date(p.expiry_date) : null;
      if (stock <= 0) return { id: `out-${p.id}`, product: p, type: 'out_of_stock', severity: 'critical', message: 'Out of stock' };
      if (stock <= Number(p.min_stock || 0)) return { id: `low-${p.id}`, product: p, type: 'low_stock', severity: 'critical', message: `Low stock: ${stock} ${p.unit}` };
      if (expiry && expiry <= in30) return { id: `exp-${p.id}`, product: p, type: 'expiry', severity: 'warning', message: `Expires ${expiry.toLocaleDateString('en-KE')}` };
      return null;
    }).filter(Boolean);
  },

  async exportStockReport(movements, filename = 'olitechs-stock-report.xlsx') {
    const rows = movements.map((m) => ({ Date: m.created_at, Product: m.product?.name || '', SKU: m.product?.sku || '', Category: m.product?.category || '', Type: m.type || (Number(m.qty) >= 0 ? 'in' : 'out'), Qty: Math.abs(Number(m.qty) || 0), Reason: m.reason || '', User: m.user_profile?.full_name || '' }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Stock Report');
    XLSX.writeFile(workbook, filename);
  },

  async exportPosMenu(menu, filename = 'olitechs-pos-menu.xlsx') {
    const rows = (menu || []).map(p => ({
      SKU: p.sku || '', Name: p.name || '', Category: p.category || '', Unit: p.unit || 'pcs',
      Selling_Price: p.selling_price || 0, Current_Stock: p.current_stock || 0, Min_Stock: p.min_stock || 0,
      Max_Stock: p.max_stock || 0, Production_Center: p.production_center || 'Kitchen',
      POS_Active: p.pos_active !== false,
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'POS Menu');
    XLSX.writeFile(workbook, filename);
  },

  async exportProducts(products, filename = 'olitechs-products.xlsx') {
    const rows = products.map((p) => ({ SKU: p.sku || '', Name: p.name, Category: p.category, Unit: p.unit, Current_Stock: p.current_stock, Min_Stock: p.min_stock, Max_Stock: p.max_stock, Cost_Price: p.cost_price, Selling_Price: p.selling_price, Supplier: p.supplier?.name || '', Location: p.location || '', Expiry_Date: p.expiry_date || '' }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Products');
    XLSX.writeFile(workbook, filename);
  },

  parseImportFile(file) {
    return new Promise((resolve, reject) => {
      const name = file.name.toLowerCase();
      if (name.endsWith('.csv')) {
        Papa.parse(file, { header: true, skipEmptyLines: true, complete: (result) => resolve(normalizeImportRows(result.data)), error: reject });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const workbook = XLSX.read(reader.result, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          resolve(normalizeImportRows(XLSX.utils.sheet_to_json(sheet, { defval: '' })));
        } catch (error) { reject(error); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  },

  async bulkUpsertProducts(propertyId, rows) {
    const suppliers = await this.listSuppliers(propertyId);
    const payload = (rows || []).map((row) => {
      let supplierId = row.supplier_id || null;
      if (!supplierId && row.supplier) {
        const found = suppliers.find((s) => s.name.toLowerCase() === String(row.supplier).toLowerCase());
        supplierId = found?.id || null;
      }
      return {
        ...cleanProduct(row, propertyId, supplierId),
        pos_enabled: row.pos_enabled === true || ['true','1','yes','y'].includes(String(row.pos_enabled || '').toLowerCase()),
        pos_category: String(row.pos_category || row.category || 'General').trim() || 'General',
        production_center: String(row.production_center || row.center || 'Kitchen').trim() || 'Kitchen',
        pos_sort: Number(row.pos_sort ?? row.sort_order ?? 0) || 0,
        pos_active: row.pos_active !== false,
      };
    }).filter((p) => p.name);
    if (!payload.length) return { processed: 0, created: 0, updated: 0, stock_adjusted: 0, errors: [] };
    const { data, error } = await supabase.rpc('fn_bulk_upsert_store_products', {
      p_property_id: propertyId,
      p_rows: payload.map(({ property_id, ...row }) => row),
    });
    if (error) throw new Error(error.message);
    return data || { processed: payload.length, created: 0, updated: 0, stock_adjusted: 0, errors: [] };
  },
};

function normalizeImportRows(rows) {
  return rows.map((raw) => {
    const normalized = {};
    Object.entries(raw || {}).forEach(([key, value]) => {
      normalized[String(key).trim().toLowerCase().replace(/[\s-]+/g, '_')] = value;
    });
    return normalized;
  }).map((row) => ({
    name: row.name,
    sku: row.sku,
    category: row.category || 'General',
    unit: row.unit || 'pcs',
    current_stock: row.current_stock ?? row.quantity ?? 0,
    min_stock: row.min_stock ?? row.low_stock_threshold ?? 5,
    max_stock: row.max_stock ?? 0,
    cost_price: row.cost_price ?? 0,
    selling_price: row.selling_price ?? 0,
    supplier: row.supplier || '',
    location: row.location || 'Main Store',
    expiry_date: row.expiry_date || null,
    pos_enabled: row.pos_enabled === true || ['true','1','yes','y'].includes(String(row.pos_enabled || '').toLowerCase()),
    pos_category: row.pos_category || row.poscategory || '',
    production_center: row.production_center || row.center || 'Kitchen',
    pos_sort: row.pos_sort ?? row.sort_order ?? 0,
    pos_active: row.pos_active !== false,
  }));
}

export function downloadImportTemplate() {
  const rows = [{ name: 'Tusker Lager', sku: 'B4', category: 'F&B', pos_enabled: true, pos_category: 'Beers', unit: 'bottle', current_stock: 100, min_stock: 20, max_stock: 300, cost_price: 180, selling_price: 450, supplier: 'Sample Supplier', location: 'Bar Store', production_center: 'Bar', pos_sort: 10, pos_active: true, expiry_date: '' }];
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'olitechs-store-import-template.csv'; a.click(); URL.revokeObjectURL(url);
}
