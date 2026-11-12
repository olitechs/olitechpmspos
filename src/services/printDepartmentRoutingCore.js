// Department routing: which production centre does an order line belong to,
// and which printer serves that centre?
//
// Before this, POS could only split an order into food and drinks. A category
// may name any production centre ("Grill", "Pastry", "Dessert"), and a printer
// may serve any of them, so routing is keyed on the centre rather than on the
// two legacy buckets.
//
// Printer groups are honoured first: a group maps categories to a production
// centre explicitly, which lets a manager treat several categories as one
// station. With no group, the category's own production centre is used, and
// finally the item's centre. Everything here is pure so the routing rules can
// be tested without a database or printer.

export const DEFAULT_DEPARTMENT = 'Kitchen';

const norm = (value) => String(value ?? '').trim().toLowerCase();

export function normalizeDepartment(value, fallback = DEFAULT_DEPARTMENT) {
  const trimmed = String(value ?? '').trim();
  return trimmed || fallback;
}

function groupsForCategory(categoryId, groups = []) {
  if (!categoryId) return [];
  return groups.filter((group) => (group.categoryIds || []).includes(categoryId));
}

export function resolveCategory(line, categories = []) {
  const explicitId = line?.categoryId || line?.category_id || null;
  if (explicitId) return categories.find((category) => category.id === explicitId) || null;
  const name = norm(line?.pos_category || line?.categoryName || line?.category);
  if (!name) return null;
  return categories.find((category) => norm(category.name) === name) || null;
}

/**
 * The department a line prints to, plus why. The order of authority is:
 * printer group → category production centre → line centre → Kitchen.
 */
export function resolveLineDepartment(line, { categories = [], groups = [] } = {}) {
  const category = resolveCategory(line, categories);
  const group = category ? groupsForCategory(category.id, groups)[0] || null : null;
  const groupCentre = group ? (group.productionCenter || group.production_center || group.name) : '';
  const department = normalizeDepartment(
    groupCentre || category?.production_center || line?.center || line?.department || DEFAULT_DEPARTMENT,
  );
  return { category, group, department, source: groupCentre ? 'group' : category?.production_center ? 'category' : line?.center ? 'item' : 'default' };
}

/** Case-insensitive match against the printer's configured department. */
export function printersForDepartment(department, printers = []) {
  const key = norm(department);
  if (!key) return [];
  return printers.filter((printer) => norm(printer?.department) === key);
}

/**
 * The legacy assignment a department falls back to when no printer has been
 * given that department yet: Bar-like centres keep printing drinks orders,
 * everything else keeps the food route.
 */
export function assignmentTypeForDepartment(department) {
  return /bar|drink|beverage|cocktail|wine/.test(norm(department)) ? 'drinks_orders' : 'food_orders';
}

/** Groups the lines by department, preserving first-seen order. */
export function planDepartmentTickets(lines = [], { categories = [], groups = [] } = {}) {
  const tickets = new Map();
  for (const line of lines) {
    if (!line) continue;
    const resolved = resolveLineDepartment(line, { categories, groups });
    const key = norm(resolved.department);
    if (!tickets.has(key)) {
      tickets.set(key, {
        department: resolved.department,
        departmentKey: key,
        groupId: resolved.group?.id || null,
        groupName: resolved.group?.name || null,
        assignmentType: assignmentTypeForDepartment(resolved.department),
        lines: [],
      });
    }
    tickets.get(key).lines.push(line);
  }
  return [...tickets.values()];
}
