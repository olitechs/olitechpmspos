import { useQuery } from '@tanstack/react-query';
import { pmsService } from '@/services/pmsService';

export const pmsQueryKeys = {
  rooms: (propertyId) => ['pms', 'rooms', propertyId],
  roomTypes: (propertyId) => ['pms', 'room-types', propertyId],
  reservations: (propertyId) => ['pms', 'reservations', propertyId],
  guests: (propertyId) => ['pms', 'guests', propertyId],
  ratePlans: (propertyId) => ['pms', 'rate-plans', propertyId],
  housekeeping: (propertyId) => ['pms', 'housekeeping', propertyId],
  housekeepingDashboard: (propertyId) => ['pms', 'housekeeping-dashboard', propertyId],
  laundry: (propertyId) => ['pms', 'laundry', propertyId],
};

export function usePmsRoomsQuery(propertyId) {
  return useQuery({
    queryKey: pmsQueryKeys.rooms(propertyId),
    queryFn: () => pmsService.listRooms(propertyId),
    enabled: Boolean(propertyId),
    staleTime: 30_000,
  });
}

export function usePmsRoomTypesQuery(propertyId) {
  return useQuery({
    queryKey: pmsQueryKeys.roomTypes(propertyId),
    queryFn: () => pmsService.listRoomTypes(propertyId),
    enabled: Boolean(propertyId),
    staleTime: 60_000,
  });
}

export function usePmsReservationsQuery(propertyId) {
  return useQuery({
    queryKey: pmsQueryKeys.reservations(propertyId),
    queryFn: () => pmsService.listReservations(propertyId),
    enabled: Boolean(propertyId),
    staleTime: 15_000,
  });
}

export function usePmsGuestsQuery(propertyId) {
  return useQuery({
    queryKey: pmsQueryKeys.guests(propertyId),
    queryFn: () => pmsService.listGuests(propertyId),
    enabled: Boolean(propertyId),
    staleTime: 60_000,
  });
}

export function usePmsRatePlansQuery(propertyId) {
  return useQuery({
    queryKey: pmsQueryKeys.ratePlans(propertyId),
    queryFn: () => pmsService.listRatePlans(propertyId),
    enabled: Boolean(propertyId),
    staleTime: 60_000,
  });
}

export function usePmsHousekeepingQuery(propertyId) {
  return useQuery({
    queryKey: pmsQueryKeys.housekeeping(propertyId),
    queryFn: () => pmsService.listHousekeepingTasks(propertyId),
    enabled: Boolean(propertyId),
    staleTime: 10_000,
  });
}

export function usePmsHousekeepingDashboardQuery(propertyId) {
  return useQuery({
    queryKey: pmsQueryKeys.housekeepingDashboard(propertyId),
    queryFn: () => pmsService.getHousekeepingDashboard(propertyId),
    enabled: Boolean(propertyId),
    staleTime: 10_000,
  });
}

export function usePmsLaundryQuery(propertyId) {
  return useQuery({
    queryKey: pmsQueryKeys.laundry(propertyId),
    queryFn: () => pmsService.listLaundryOrders(propertyId),
    enabled: Boolean(propertyId),
    staleTime: 10_000,
  });
}
