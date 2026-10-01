import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';
import {
  usePmsRoomsQuery,
  usePmsRoomTypesQuery,
  usePmsReservationsQuery,
  usePmsGuestsQuery,
} from '@/hooks/usePmsQuery';

const PmsContext = createContext(null);

function buildRoomsView(rooms, reservations) {
  const activeByRoom = new Map();
  for (const r of reservations) {
    if (r.status !== 'booked' && r.status !== 'checked-in') continue;
    const existing = activeByRoom.get(r.room_id);
    if (!existing || new Date(r.created_at) > new Date(existing.created_at)) {
      activeByRoom.set(r.room_id, r);
    }
  }

  return rooms.map((room) => {
    const res = activeByRoom.get(room.id);
    return {
      id: room.id,
      number: room.number,
      floor: room.floor,
      room_type_id: room.room_type_id,
      room_type: room.room_type,
      status: room.status,
      reservationId: res ? res.id : null,
      guest: res
        ? {
            name: res.guest_name,
            phone: res.phone,
            checkIn: res.arrival,
            checkOut: res.departure,
            rate: Number(res.rate) || 0,
            partySize: res.party_size,
          }
        : null,
    };
  });
}

function mapReservation(r, roomsById, roomTypesById = new Map()) {
  const room = roomsById.get(r.room_id);
  const paymentStatus = r.payment_status || (
    Number(r.amount_paid || 0) >= Number(r.total_amount || r.rate || 0) &&
    Number(r.total_amount || r.rate || 0) > 0
      ? 'fully_paid'
      : Number(r.amount_paid || 0) > 0
        ? 'partially_paid'
        : 'not_paid'
  );

  return {
    id: r.id,
    groupId: r.group_id || undefined,
    roomId: r.room_id,
    roomNumber: room?.number,
    roomTypeId: room?.room_type_id,
    roomType: roomTypesById.get(room?.room_type_id)?.name || room?.room_type || '',
    guestName: r.guest_name,
    guest: r.guest_name,
    phone: r.phone,
    checkIn: r.arrival,
    checkOut: r.departure,
    arrival: r.arrival,
    departure: r.departure,
    bookingStatus: String(r.status || 'booked').replace('-', '_'),
    status: r.status,
    paymentStatus,
    channel: r.channel || 'direct',
    mealPlan: r.meal_plan || 'bed_only',
    adults: Number(r.adults || 1),
    kidsCount: Number(r.kids_count ?? r.children ?? 0),
    kidsAges: Array.isArray(r.kids_ages) ? r.kids_ages : [],
    totalAmount: Number(r.total_amount ?? r.rate ?? 0),
    amountPaid: Number(r.amount_paid ?? 0),
    color: paymentStatus === 'fully_paid' ? '#2E7D32' : paymentStatus === 'partially_paid' ? '#F9A825' : '#EF6C00',
    rate: Number(r.rate || 0),
    partySize: Number(r.party_size || (Number(r.adults || 1) + Number(r.kids_count ?? r.children ?? 0))),
    notes: r.special_requests || r.notes || '',
  };
}

export function PmsProvider({ children }) {
  const { user } = useAuth();
  const propertyId = user?.property?.id;

  const roomsQuery = usePmsRoomsQuery(propertyId);
  const roomTypesQuery = usePmsRoomTypesQuery(propertyId);
  const reservationsQuery = usePmsReservationsQuery(propertyId);
  const guestsQuery = usePmsGuestsQuery(propertyId);
  const [mutationError, setMutationError] = useState('');

  const rawRooms = roomsQuery.data || [];
  const roomTypes = roomTypesQuery.data || [];
  const rawReservations = reservationsQuery.data || [];
  const guests = guestsQuery.data || [];

  const roomsById = useMemo(() => new Map(rawRooms.map((r) => [r.id, r])), [rawRooms]);
  const rooms = useMemo(() => {
    const typeMap = new Map(roomTypes.map((t) => [t.id, t.name]));
    return buildRoomsView(rawRooms, rawReservations).map((r) => ({
      ...r,
      roomTypeName: typeMap.get(r.room_type_id) || r.room_type || '',
    }));
  }, [rawRooms, rawReservations, roomTypes]);

  const roomTypesById = useMemo(() => new Map(roomTypes.map((t) => [t.id, t])), [roomTypes]);
  const reservations = useMemo(
    () => rawReservations
      .filter((r) => r.status !== 'cancelled')
      .map((r) => mapReservation(r, roomsById, roomTypesById)),
    [rawReservations, roomsById, roomTypesById]
  );

  const loading = propertyId ? (
    roomsQuery.isLoading ||
    roomTypesQuery.isLoading ||
    reservationsQuery.isLoading ||
    guestsQuery.isLoading
  ) : false;

  const queryError = roomsQuery.error
    ? roomsQuery.error.message
    : roomTypesQuery.error
      ? 'Room type setup is unavailable. Run the latest Supabase room setup migration.'
      : reservationsQuery.error?.message || guestsQuery.error?.message || '';
  const error = mutationError || queryError;

  const reload = useCallback(async () => {
    if (!propertyId) return;
    await Promise.all([
      roomsQuery.refetch(),
      roomTypesQuery.refetch(),
      reservationsQuery.refetch(),
      guestsQuery.refetch(),
    ]);
  }, [propertyId, roomsQuery, roomTypesQuery, reservationsQuery, guestsQuery]);

  const runMutation = useCallback(async (operation, { rethrow = false } = {}) => {
    setMutationError('');
    try {
      const result = await operation();
      await reload();
      return result;
    } catch (err) {
      setMutationError(err?.message || 'Operation failed.');
      if (rethrow) throw err;
      return undefined;
    }
  }, [reload]);

  const checkInRoom = useCallback((roomId, data) => runMutation(() => pmsService.walkInCheckIn({
    propertyId,
    roomId,
    guestName: data.name,
    phone: data.phone,
    checkIn: data.checkIn,
    checkOut: data.checkOut,
    partySize: data.partySize,
    rate: data.rate,
  })), [propertyId, runMutation]);

  const checkOutRoom = useCallback((roomId) => runMutation(() => pmsService.checkOutRoom(roomId)), [runMutation]);

  const checkInReservation = useCallback((resId) => runMutation(() => pmsService.checkInReservation(resId)), [runMutation]);

  const addReservation = useCallback((data) => runMutation(() => pmsService.createReservationBundle({
    propertyId,
    roomIds: [data.roomId],
    groupId: null,
    guestName: data.guest,
    phone: data.phone,
    checkIn: data.arrival,
    checkOut: data.departure,
    paymentStatus: data.paymentStatus || 'not_paid',
    channel: data.channel || 'direct',
    mealPlan: data.mealPlan || 'bed_only',
    adults: Number(data.adults || data.partySize || 1),
    kidsCount: Number(data.kidsCount || 0),
    kidsAges: data.kidsAges || [],
    totalAmount: Number(data.totalAmount ?? data.rate ?? 0),
    amountPaid: Number(data.amountPaid || 0),
    notes: data.notes || '',
  }), { rethrow: true }), [propertyId, runMutation]);

  const updatePlannerReservation = useCallback((id, patch) =>
    runMutation(() => pmsService.updatePlannerReservation(id, patch), { rethrow: true }), [runMutation]);

  const addRoomToReservationGroup = useCallback((payload) =>
    runMutation(() => pmsService.addRoomToReservationGroup(payload), { rethrow: true }), [runMutation]);

  const removeRoomFromReservationGroup = useCallback((id) =>
    runMutation(() => pmsService.removeRoomFromReservationGroup(id), { rethrow: true }), [runMutation]);

  const splitReservationGroup = useCallback((groupId) =>
    runMutation(() => pmsService.splitReservationGroup(groupId), { rethrow: true }), [runMutation]);

  const deletePlannerReservation = useCallback((id) =>
    runMutation(() => pmsService.deletePlannerReservation(id), { rethrow: true }), [runMutation]);

  const movePlannerReservation = useCallback((payload) =>
    runMutation(() => pmsService.movePlannerReservation(payload), { rethrow: true }), [runMutation]);

  const moveReservationGroup = useCallback((payload) =>
    runMutation(() => pmsService.moveReservationGroup(payload), { rethrow: true }), [runMutation]);

  const removeReservation = useCallback((resId) =>
    runMutation(() => pmsService.removeReservation(resId)), [runMutation]);

  const setRoomStatus = useCallback((roomId, status) =>
    runMutation(() => pmsService.setRoomStatus(roomId, status)), [runMutation]);

  const value = {
    rooms,
    roomTypes,
    reservations,
    guests,
    loading,
    error,
    checkInRoom,
    checkOutRoom,
    checkInReservation,
    addReservation,
    updatePlannerReservation,
    addRoomToReservationGroup,
    removeRoomFromReservationGroup,
    splitReservationGroup,
    deletePlannerReservation,
    movePlannerReservation,
    moveReservationGroup,
    removeReservation,
    setRoomStatus,
    reload,
  };

  return <PmsContext.Provider value={value}>{children}</PmsContext.Provider>;
}

export const usePms = () => useContext(PmsContext);
