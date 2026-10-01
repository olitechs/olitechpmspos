import { useQuery } from '@tanstack/react-query';
import { propertyService } from '@/services/propertyService';
import { useProperty } from '@/context/PropertyContext';
import { propertyQueryKeys } from '@/hooks/propertyQueryKeys';

export function useMyPropertiesQuery() {
  return useQuery({
    queryKey: propertyQueryKeys.mine(),
    queryFn: () => propertyService.listMyProperties(),
    staleTime: 60_000,
  });
}

export function useActivePropertyQuery() {
  const { propertyId } = useProperty();

  return useQuery({
    queryKey: propertyQueryKeys.detail(propertyId),
    queryFn: () => propertyService.getProperty(propertyId),
    enabled: Boolean(propertyId),
    staleTime: 60_000,
  });
}
