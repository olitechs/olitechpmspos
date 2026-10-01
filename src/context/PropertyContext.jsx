import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { propertyService } from '@/services/propertyService';
import { propertyQueryKeys } from '@/hooks/propertyQueryKeys';

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
  const queryClient = useQueryClient();

  const propertyId = user?.property?.id || null;
  const propertyQuery = useQuery({
    queryKey: propertyQueryKeys.detail(propertyId),
    queryFn: () => propertyService.getProperty(propertyId),
    enabled: Boolean(propertyId),
    staleTime: 60_000,
  });

  const property = propertyOverride || propertyQuery.data || user?.property || null;
  const refreshProperty = useCallback(async () => {
    if (!propertyId) {
      setPropertyOverride(null);
      return null;
    }

    const next = await queryClient.fetchQuery({
      queryKey: propertyQueryKeys.detail(propertyId),
      queryFn: () => propertyService.getProperty(propertyId),
    });
    setPropertyOverride(next);
    queryClient.setQueryData(propertyQueryKeys.detail(propertyId), next);
    return next;
  }, [propertyId, queryClient]);

  const updateProperty = useCallback(async (patch) => {
    if (!propertyId) throw new Error('No active property.');
    const next = await propertyService.updateProperty(propertyId, patch);
    setPropertyOverride(next);
    return next;
  }, [propertyId, queryClient]);

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
