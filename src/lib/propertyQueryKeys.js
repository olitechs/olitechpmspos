/**
 * Canonical tenant-aware query-key factory for gradual service migration.
 * Every property-scoped cache key starts with the property ID so cache data
 * cannot be reused between tenants. This is a client cache boundary only;
 * Postgres RLS and RPC authorization remain the security boundary.
 */
export function requirePropertyId(propertyId) {
  if (typeof propertyId !== 'string' || !propertyId.trim()) {
    throw new Error('A property ID is required for this property-scoped operation.');
  }
  return propertyId.trim();
}

export const propertyQueryKeys = Object.freeze({
  all: ['property'],

  scope(propertyId) {
    return [...this.all, requirePropertyId(propertyId)];
  },

  rooms(propertyId, filters = {}) {
    return [...this.scope(propertyId), 'rooms', filters];
  },

  reservations(propertyId, filters = {}) {
    return [...this.scope(propertyId), 'reservations', filters];
  },

  guests(propertyId, filters = {}) {
    return [...this.scope(propertyId), 'guests', filters];
  },

  folios(propertyId, filters = {}) {
    return [...this.scope(propertyId), 'folios', filters];
  },

  posMenu(propertyId, filters = {}) {
    return [...this.scope(propertyId), 'pos-menu', filters];
  },

  posOrders(propertyId, filters = {}) {
    return [...this.scope(propertyId), 'pos-orders', filters];
  },

  inventory(propertyId, filters = {}) {
    return [...this.scope(propertyId), 'inventory', filters];
  },

  subscription(propertyId) {
    return [...this.scope(propertyId), 'subscription'];
  },
});

export function assertMutationProperty(propertyId, targetPropertyId = propertyId) {
  const source = requirePropertyId(propertyId);
  const target = requirePropertyId(targetPropertyId);
  if (source !== target) {
    throw new Error('Cross-property mutation rejected.');
  }
  return source;
}
