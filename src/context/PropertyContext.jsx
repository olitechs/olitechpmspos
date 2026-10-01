import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { propertyService } from '@/services/propertyService';

const PropertyContext = createContext(null);

const EMPTY_PROPERTY = {
  id: null,
  name: '',
  business_name: '',
  currency: 'USD',
  timezone: 'UTC',
  status: 'pending',
  package: 'none',
};

export function PropertyProvider({ children }) {
  const { user } = useAuth();
  const [propertyOverride, setPropertyOverride] = useState(null);

  const property = propertyOverride || user?.property || null;
  const propertyId = property?.id || null;

  const refreshProperty = useCallback(async () => {
    if (!propertyId) {
      setPropertyOverride(null);
      return null;
    }

    const next = await propertyService.getProperty(propertyId);
    setPropertyOverride(next);
    return next;
  }, [propertyId]);

  const updateProperty = useCallback(async (patch) => {
    if (!propertyId) throw new Error('No active property.');
    const next = await propertyService.updateProperty(propertyId, patch);
    setPropertyOverride(next);
    return next;
  }, [propertyId]);

  const value = useMemo(() => ({
    property: property || EMPTY_PROPERTY,
    propertyId,
    branch: null,
    currency: property?.currency || 'USD',
    timezone: property?.timezone || 'UTC',
    businessDate: new Date().toISOString().slice(0, 10),
    taxSettings: property?.tax_settings || {},
    hotelName: property?.business_name || property?.name || '',
    hotelLogo: property?.logo_url || null,
    refreshProperty,
    updateProperty,
  }), [property, propertyId, refreshProperty, updateProperty]);

  return <PropertyContext.Provider value={value}>{children}</PropertyContext.Provider>;
}

export function useProperty() {
  const context = useContext(PropertyContext);
  if (!context) throw new Error('useProperty must be used within a PropertyProvider');
  return context;
}
