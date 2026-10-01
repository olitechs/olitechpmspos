// Centralized authorization predicates for route/UI decisions.
// These helpers are derived from the server-hydrated AuthContext user object.
// They are UX guards only; Supabase Auth + Postgres RLS remain authoritative.

const PROPERTY_ADMIN_ROLES = new Set(['owner', 'admin']);
const STAFF_ADMIN_ROLES = new Set(['hotel_admin', 'super_admin']);

export function isPlatformOwner(user) {
  return user?.platformRole === 'platform_owner' || user?.isPlatformOwner === true;
}

export function getPropertyRole(user) {
  return String(user?.propertyRole || '').toLowerCase().trim();
}

export function isPropertyAdmin(user) {
  return PROPERTY_ADMIN_ROLES.has(getPropertyRole(user));
}

export function getStaffRole(user) {
  return String(user?.staff?.role || '').toLowerCase().trim();
}

export function isHotelStaffAdmin(user) {
  return STAFF_ADMIN_ROLES.has(getStaffRole(user));
}

export function canAccessPlatformAdmin(user) {
  // /admin is the OliTechs platform-admin surface. Hotel administrators
  // manage their hotel inside the protected hotel workspace and must not
  // inherit platform-owner access from a property role.
  return isPlatformOwner(user);
}

export function hasActivePropertyAccess(user) {
  const property = user?.property;
  return Boolean(property?.status === 'active' && property?.package && property.package !== 'none');
}
