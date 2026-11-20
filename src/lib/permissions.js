// Client mirror of the server-side permission catalog.
//
// IMPORTANT: this file only DESCRIBES permissions for UI rendering. The
// authoritative source is the seeded employee_permission_codes table plus
// fn_employee_has_permission() in Postgres; a permission list supplied by the
// browser is never trusted by the server. Use this module to decide what the
// UI shows, and rely on RLS/RPCs to decide what the server accepts.

export const WORKSPACES = ['pos', 'frontoffice', 'stores', 'backoffice'];

export const WORKSPACE_LABELS = {
  pos: 'POS & F&B',
  frontoffice: 'Front Office',
  stores: 'Stores',
  backoffice: 'Back Office',
};

// Maps the workspace key used by permission codes to the MAIN_NAV app id.
export const WORKSPACE_TO_APP = { pos: 'pos', frontoffice: 'frontoffice', store: 'stores', stores: 'stores', backoffice: 'backoffice' };
export const APP_TO_WORKSPACE = { pos: 'pos', frontoffice: 'frontoffice', stores: 'store', backoffice: 'backoffice' };

export const PERMISSION_CODES = [
  // POS
  { code: 'pos.access', workspace: 'pos', label: 'Use the POS workspace', sensitive: false },
  { code: 'pos.open_shift', workspace: 'pos', label: 'Open a cashier shift', sensitive: false },
  { code: 'pos.close_shift', workspace: 'pos', label: 'Close a cashier shift', sensitive: true },
  { code: 'pos.process_sale', workspace: 'pos', label: 'Process sales and payments', sensitive: false },
  { code: 'pos.apply_discount', workspace: 'pos', label: 'Apply approved discounts', sensitive: true },
  { code: 'pos.refund', workspace: 'pos', label: 'Issue refunds', sensitive: true },
  { code: 'pos.void', workspace: 'pos', label: 'Void orders or sent items', sensitive: true },
  { code: 'pos.reprint_receipt', workspace: 'pos', label: 'Reprint receipts', sensitive: false },
  // Front Office
  { code: 'front_office.access', workspace: 'frontoffice', label: 'Use the Front Office workspace', sensitive: false },
  { code: 'front_office.reservations.view', workspace: 'frontoffice', label: 'View reservations', sensitive: false },
  { code: 'front_office.reservations.create', workspace: 'frontoffice', label: 'Create reservations and walk-ins', sensitive: false },
  { code: 'front_office.checkin', workspace: 'frontoffice', label: 'Check guests in', sensitive: false },
  { code: 'front_office.checkout', workspace: 'frontoffice', label: 'Check guests out', sensitive: true },
  { code: 'front_office.folio.view', workspace: 'frontoffice', label: 'View guest folios', sensitive: false },
  { code: 'front_office.folio.post_charge', workspace: 'frontoffice', label: 'Post charges to folios', sensitive: true },
  { code: 'front_office.folio.payment', workspace: 'frontoffice', label: 'Take guest payments', sensitive: true },
  // Stores
  { code: 'stores.access', workspace: 'store', label: 'Use the Stores workspace', sensitive: false },
  { code: 'stores.inventory.view', workspace: 'store', label: 'View inventory levels', sensitive: false },
  { code: 'stores.stock.receive', workspace: 'store', label: 'Receive stock (GRN)', sensitive: true },
  { code: 'stores.stock.issue', workspace: 'store', label: 'Issue stock', sensitive: true },
  { code: 'stores.stock.transfer', workspace: 'store', label: 'Transfer stock', sensitive: false },
  { code: 'stores.stock.adjust', workspace: 'store', label: 'Make stock adjustments', sensitive: true },
  { code: 'stores.stock.wastage.submit', workspace: 'store', label: 'Submit stock wastage requests', sensitive: true },
  { code: 'stores.stock.wastage.approve', workspace: 'store', label: 'Approve or reject stock wastage requests', sensitive: true },
  { code: 'stores.production.post', workspace: 'store', label: 'Post inventory production and assembly batches', sensitive: true },
  { code: 'stores.suppliers.manage', workspace: 'store', label: 'Manage suppliers and purchasing', sensitive: true },
  // Back Office
  { code: 'back_office.access', workspace: 'backoffice', label: 'Use the Back Office workspace', sensitive: false },
  { code: 'back_office.reports.view', workspace: 'backoffice', label: 'View financial and operational reports', sensitive: false },
  { code: 'back_office.settings.manage', workspace: 'backoffice', label: 'Manage property settings', sensitive: true },
  { code: 'back_office.employees.manage', workspace: 'backoffice', label: 'Manage employees, departments and permissions', sensitive: true },
  { code: 'back_office.billing.manage', workspace: 'backoffice', label: 'View subscription and licence billing', sensitive: false },
  { code: 'back_office.items.manage', workspace: 'backoffice', label: 'Manage catalogue items, categories, modifiers and discounts', sensitive: true },
  { code: 'pos.menu.manage', workspace: 'pos', label: 'Manage POS menu and pricing', sensitive: true },
];

export const PERMISSION_BY_CODE = new Map(PERMISSION_CODES.map((p) => [p.code, p]));

export function permissionLabel(code) {
  return PERMISSION_BY_CODE.get(code)?.label || code;
}

export function permissionWorkspace(code) {
  return PERMISSION_BY_CODE.get(code)?.workspace || null;
}

// Codes grouped for the Roles & Permissions editor, in catalog order.
export function permissionsByWorkspace() {
  const groups = new Map();
  for (const permission of PERMISSION_CODES) {
    if (!groups.has(permission.workspace)) groups.set(permission.workspace, []);
    groups.get(permission.workspace).push(permission);
  }
  return groups;
}

/**
 * Resolve the user's effective permission set from the auth user object.
 * `user.permissions` is loaded server-side via fn_employee_permission_summary
 * (see authService) and never authored by the client.
 *
 * Returns { codes: Set<string>, workspaces: Set<string>, isAdministrator }.
 * Administrators (property owner/admin and platform owners) implicitly hold
 * every permission, mirroring the server resolver.
 */
export function resolvePermissions(user) {
  if (!user) return { codes: new Set(), workspaces: new Set(), isAdministrator: false };
  const isAdministrator = user.isPlatformOwner
    || ['owner', 'admin'].includes(String(user.propertyRole || '').toLowerCase());
  if (isAdministrator) {
    return {
      codes: new Set(PERMISSION_CODES.map((p) => p.code)),
      workspaces: new Set(PERMISSION_CODES.map((p) => p.workspace)),
      isAdministrator: true,
    };
  }
  const summary = user.permissions || {};
  const codes = new Set(Array.isArray(summary.codes) ? summary.codes : []);
  const workspaces = new Set(Array.isArray(summary.workspaces) ? summary.workspaces : []);
  // Legacy compatibility: the pre-existing assigned_modules text[] on the
  // staff row still grants the workspace-level .access code.
  const assigned = user.staff?.assigned_modules || [];
  for (const module of assigned) {
    const accessCode = PERMISSION_CODES.find((p) => p.workspace === module && p.code.endsWith('.access'));
    if (accessCode) {
      codes.add(accessCode.code);
      workspaces.add(accessCode.workspace);
    }
  }
  return { codes, workspaces, isAdministrator: false };
}

/** Does the user hold one permission code? */
export function hasPermission(resolved, code) {
  return resolved.codes.has(code);
}

/** Does the user hold every one of the given codes (empty list = true)? */
export function hasAllPermissions(resolved, codes) {
  return (codes || []).every((code) => resolved.codes.has(code));
}

/** Does the user hold at least one code in the workspace (or .access itself)? */
export function hasWorkspaceAccess(resolved, workspace) {
  return resolved.workspaces.has(workspace);
}
