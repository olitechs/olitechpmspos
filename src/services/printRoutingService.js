import { usePrinterStore } from '@/data/modules/printerStore';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { supabase } from '@/lib/supabaseClient';
import { groupCenter, resolveCategoryId } from '@/services/printRoutingCore';

export { groupCenter, resolveCategoryId };
export function isPrinterGroupRoutingEnabled() {
  return isFeatureEnabled('printerGroupRouting');
}

export function getPrinterGroupsForItem(categoryId) {
  return usePrinterStore.getState().getPrinterGroupsForCategory(categoryId);
}

export function splitLinesByPrinterGroup(lines = []) {
  const state = usePrinterStore.getState();
  const categories = state.categories || [];
  const groups = state.printerGroups || [];
  const buckets = new Map();
  const unrouted = [];
  const normalize = value => String(value ?? '').trim().toLowerCase();

  for (const line of lines) {
    const explicitId = line?.categoryId || line?.category_id;
    const categoryName = normalize(line?.pos_category || line?.categoryName || line?.category);
    const categoryId = explicitId || categories.find(category => normalize(category.name) === categoryName)?.id || null;
    const matched = categoryId ? groups.filter(group => (group.categoryIds || []).includes(categoryId)) : [];
    if (!matched.length) {
      unrouted.push(line);
      continue;
    }
    for (const group of matched) {
      if (!buckets.has(group.id)) buckets.set(group.id, { group, lines: [] });
      buckets.get(group.id).lines.push(line);
    }
  }
  return { buckets: [...buckets.values()], unrouted };
}

export function planPrinterJobs(lines = []) {
  const { printerGroups = [], printers = [] } = usePrinterStore.getState();
  const { buckets, unrouted } = splitLinesByPrinterGroup(lines);
  return {
    jobs: buckets.map(({ group, lines: groupLines }) => ({
      groupId: group.id,
      groupName: group.name,
      center: groupCenter(group),
      printers: printers.filter(printer => (group.printerIds || []).includes(printer.id)),
      lines: groupLines,
    })),
    unrouted,
  };
}

const encode = value => {
  if (typeof btoa !== 'function') throw new Error('Base64 encoding is unavailable in this browser.');
  return btoa(unescape(encodeURIComponent(String(value ?? ''))));
};

const ticket = (items, { orderNumber, table, waiter, center }) => [
  'OLITECHS PMS + POS',
  '--------------------------------',
  `${String(center || 'KITCHEN').toUpperCase()} ORDER TICKET`,
  `ORDER: ${orderNumber || '—'}`,
  `TABLE: ${table || '—'}`,
  `WAITER: ${waiter || '—'}`,
  `TIME: ${new Date().toLocaleString('en-KE')}`,
  '--------------------------------',
  ...(items || []).map(item => {
    const modifiers = Array.isArray(item.modifiers) ? item.modifiers.map(m => m.name || m.label || m).filter(Boolean).join(', ') : '';
    const note = item.notes || item.note || '';
    return [`${Number(item.qty || item.quantity || 1)} x ${item.name || item.item_name || 'Item'}`, modifiers ? `  + ${modifiers}` : '', note ? `  NOTE: ${note}` : ''].filter(Boolean).join('\n');
  }),
  '--------------------------------',
  '',
].join('\n');

export async function printOrder(order = {}) {
  const state = usePrinterStore.getState();
  if (!state.storeId || !state.workspaceId) {
    throw new Error('Printer-group routing is not ready: select a store and reload its printer configuration.');
  }
  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw new Error('No order lines were provided for printer routing.');
  }

  const { jobs: plans, unrouted } = planPrinterJobs(order.items);
  if (unrouted.length) {
    const names = unrouted.map(item => item.name || item.item_name || 'Unnamed item');
    throw new Error(`No printer group is assigned to: ${names.join(', ')}.`);
  }
  if (!plans.length) throw new Error('No printer groups match this order.');
  const missing = plans.filter(plan => !plan.printers.length);
  if (missing.length) {
    throw new Error(`No physical printer is assigned to group(s): ${missing.map(plan => plan.groupName).join(', ')}.`);
  }

  // Build all jobs first, then insert as one statement. This avoids a partial
  // dispatch where only some production centers receive their tickets.
  const rows = plans.flatMap(plan => plan.printers.map(printer => ({
    workspace_id: state.workspaceId,
    printer_id: printer.id,
    printer_group_id: plan.groupId,
    order_id: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(order.orderId || '')) ? order.orderId : null,
    content_escpos_base64: encode(ticket(plan.lines, {
      orderNumber: order.orderNumber || order.checkNo || order.id,
      table: order.table || order.tableNumber,
      waiter: order.waiter,
      center: plan.center || plan.groupName,
    })),
    status: 'pending',
    type: 'kitchen',
  })));

  if (!rows.length) throw new Error('No physical printer jobs could be prepared.');
  const { data, error } = await supabase.from('print_jobs').insert(rows).select();
  if (error) throw new Error(`Could not queue KOT/BOT print jobs: ${error.message}`);
  if (!Array.isArray(data) || data.length !== rows.length) {
    throw new Error('Print queue did not confirm every KOT/BOT job.');
  }
  return data;
}
