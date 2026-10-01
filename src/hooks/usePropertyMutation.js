import { useMutation, useQueryClient } from '@tanstack/react-query';
import { propertyService } from '@/services/propertyService';

export function useUpdatePropertyMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ propertyId, patch }) => propertyService.updateProperty(propertyId, patch),
    onSuccess: (property) => {
      queryClient.setQueryData(['property', property.id], property);
      queryClient.invalidateQueries({ queryKey: ['properties', 'mine'] });
    },
  });
}
