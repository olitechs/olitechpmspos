// Pure routing helpers for printer groups. No imports, no I/O.
const norm = (v) => String(v ?? '').trim().toLowerCase();

export function groupCenter(group) {
  return String(group?.productionCenter || group?.name || '').trim();
}
export function groupsForCategory(categoryId, groups = []) {
  if (!categoryId) return [];
  return groups.filter((g) => (g.categoryIds || []).includes(categoryId));
}
export function resolveCategoryId(line, categories = []) {
  if (line?.categoryId) return line.categoryId;
  const name = norm(line?.pos_category || line?.category);
  if (!name) return null;
  return categories.find((c) => norm(c.name) === name)?.id ?? null;
}
export function splitLinesByPrinterGroup(lines = [], { groups = [], categories = [] } = {}) {
  const buckets = new Map();
  const unrouted = [];
  for (const line of lines) {
    const matched = groupsForCategory(resolveCategoryId(line, categories), groups);
    if (!matched.length) { unrouted.push(line); continue; }
    for (const g of matched) {
      if (!buckets.has(g.id)) buckets.set(g.id, { group: g, lines: [] });
      buckets.get(g.id).lines.push(line);
    }
  }
  return { buckets: [...buckets.values()], unrouted };
}
export function pickOrderPrinter(center, printers = [], isReady = () => true) {
  return printers.find((p) =>
    (p.purposes || []).includes('order') && isReady(p) &&
    (!p.center || p.center === 'All' || norm(p.center) === norm(center))) || null;
}
export function planPrinterJobs(lines, { groups = [], categories = [], printers = [], isReady } = {}) {
  const { buckets, unrouted } = splitLinesByPrinterGroup(lines, { groups, categories });
  const jobs = buckets.map(({ group, lines: groupLines }) => {
    const center = groupCenter(group);
    return { groupId: group.id, groupName: group.name, center, printer: pickOrderPrinter(center, printers, isReady), lines: groupLines };
  });
  return { jobs, unrouted };
}
