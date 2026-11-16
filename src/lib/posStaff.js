// POS staff helpers.
//
// The POS staff list comes from authService.listStaff() and is normalised to
// { id, name } by POSContainer. Everything that renders a person must read
// `name` only — there is no `full_name` or `avatar` field on those rows.

export function staffInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase() || '?';
}

// Keep the dock readable: show a bounded number of colleagues and report the
// rest instead of silently hiding them.
export function splitStaffForDock(staff = [], max = 6) {
  const list = Array.isArray(staff) ? staff : [];
  const visible = list.slice(0, Math.max(0, max));
  return { visible, hiddenCount: Math.max(0, list.length - visible.length) };
}
