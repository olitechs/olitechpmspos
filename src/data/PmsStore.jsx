import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';
import { supabase } from '@/lib/supabaseClient';

// PMS data model — now backed by Supabase (see supabase/migrations/0002_pms_core.sql)
// and scoped to the signed-in user's property via RLS. The shapes returned
// by this hook (`rooms`, `reservations`) are kept identical to the
// original local-state version so every consumer component is unchanged:
//
//   room:        { id, number, floor, status, guest: {name,phone,checkIn,checkOut,rate,partySize} | null, reservationId }
//   reservation: { id, roomId, roomNumber, guest, phone, arrival, departure, partySize, status }

const PmsContext = createContext(null);


function buildRoomsView(rooms, reservations) {
	// A room's "active" reservation is its most recent booked/checked-in one.
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
		// The frontend's room grid only styles 'available' / 'booked' /
		// 'occupied' today — see the note in 0002_pms_core.sql. Housekeeping
		// states (dirty/cleaning/maintenance/out_of_service/blocked) pass
		// through as-is; Rooms.jsx currently renders them unstyled until
		// the Phase 3 housekeeping board adds their tile styles.
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
	const paymentStatus = r.payment_status || (Number(r.amount_paid || 0) >= Number(r.total_amount || r.rate || 0) && Number(r.total_amount || r.rate || 0) > 0 ? 'fully_paid' : Number(r.amount_paid || 0) > 0 ? 'partially_paid' : 'not_paid');
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

	const [rawRooms, setRawRooms] = useState([]);
	const [roomTypes, setRoomTypes] = useState([]);
	const [rawReservations, setRawReservations] = useState([]);
	const [guests, setGuests] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');

	const reload = useCallback(async () => {
		if (!propertyId) return;
		try {
			const results = await Promise.allSettled([
				pmsService.listRooms(propertyId),
				pmsService.listRoomTypes(propertyId),
				pmsService.listReservations(propertyId),
				pmsService.listGuests(propertyId),
			]);
			const [roomRows, typeRows, resRows, guestRows] = results;
			if (roomRows.status === 'rejected') throw roomRows.reason;
			setRawRooms(roomRows.value || []);
			setRoomTypes(typeRows.status === 'fulfilled' ? (typeRows.value || []) : []);
			setRawReservations(resRows.status === 'fulfilled' ? (resRows.value || []) : []);
			setGuests(guestRows.status === 'fulfilled' ? (guestRows.value || []) : []);
			setError(typeRows.status === 'rejected' ? 'Room type setup is unavailable. Run the latest Supabase room setup migration.' : '');
		} catch (err) {
			setError(err.message);
		} finally {
			setLoading(false);
		}
	}, [propertyId]);

	useEffect(() => {
		reload();
	}, [reload]);

	useEffect(() => {
		if (!propertyId) return undefined;
		const channel = supabase
			.channel('pms-property-' + propertyId)
			.on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: 'property_id=eq.' + propertyId }, () => reload())
			.on('postgres_changes', { event: '*', schema: 'public', table: 'reservations', filter: 'property_id=eq.' + propertyId }, () => reload())
			.on('postgres_changes', { event: '*', schema: 'public', table: 'guests', filter: 'property_id=eq.' + propertyId }, () => reload())
			.subscribe();
		return () => { supabase.removeChannel(channel); };
	}, [propertyId, reload]);

	const roomsById = useMemo(() => new Map(rawRooms.map((r) => [r.id, r])), [rawRooms]);
	const rooms = useMemo(() => {
		const typeMap = new Map(roomTypes.map((t) => [t.id, t.name]));
		return buildRoomsView(rawRooms, rawReservations).map((r) => ({ ...r, roomTypeName: typeMap.get(r.room_type_id) || r.room_type || '' }));
	}, [rawRooms, rawReservations, roomTypes]);
	const roomTypesById = useMemo(() => new Map(roomTypes.map((t) => [t.id, t])), [roomTypes]);
	const reservations = useMemo(
		() => rawReservations.filter((r) => r.status !== 'cancelled').map((r) => mapReservation(r, roomsById, roomTypesById)),
		[rawReservations, roomsById, roomTypesById]
	);

	const checkInRoom = useCallback(
		async (roomId, data) => {
			try {
				await pmsService.walkInCheckIn({
					propertyId,
					roomId,
					guestName: data.name,
					phone: data.phone,
					checkIn: data.checkIn,
					checkOut: data.checkOut,
					partySize: data.partySize,
					rate: data.rate,
				});
				await reload();
			} catch (err) {
				setError(err.message);
			}
		},
		[propertyId, reload]
	);

	const checkOutRoom = useCallback(
		async (roomId) => {
			try {
				await pmsService.checkOutRoom(roomId);
				await reload();
			} catch (err) {
				setError(err.message);
			}
		},
		[reload]
	);

	const checkInReservation = useCallback(
		async (resId) => {
			try {
				await pmsService.checkInReservation(resId);
				await reload();
			} catch (err) {
				setError(err.message);
			}
		},
		[reload]
	);

	const addReservation = useCallback(
		async (data) => {
			try {
				const nights = Math.max(1, Math.round((new Date(data.departure) - new Date(data.arrival)) / 86400000));
				const nightlyRate = Number(data.rate ?? 0);
				const totalAmount = Number(data.totalAmount ?? (nightlyRate * nights));
				const amountPaid = Number(data.amountPaid ?? 0);
				const paymentStatus = data.paymentStatus || (amountPaid >= totalAmount && totalAmount > 0 ? 'fully_paid' : amountPaid > 0 ? 'partially_paid' : 'not_paid');
				await pmsService.createReservationBundle({
					propertyId, roomIds: [data.roomId], groupId: null, guestName: data.guest, phone: data.phone,
					checkIn: data.arrival, checkOut: data.departure, paymentStatus, channel: data.channel || 'direct',
					mealPlan: data.mealPlan || 'bed_only', adults: Number(data.adults || data.partySize || 1), kidsCount: Number(data.kidsCount || 0),
					kidsAges: data.kidsAges || [], totalAmount, amountPaid, notes: data.notes || '',
				});
				await reload();
			} catch (err) { setError(err.message); throw err; }
		}, [propertyId, reload]
	);

	const updatePlannerReservation = useCallback(async (id, patch) => {
		try { await pmsService.updatePlannerReservation(id, patch); await reload(); } catch (err) { setError(err.message); throw err; }
	}, [reload]);
	const addRoomToReservationGroup = useCallback(async (payload) => {
		try { await pmsService.addRoomToReservationGroup(payload); await reload(); } catch (err) { setError(err.message); throw err; }
	}, [reload]);
	const removeRoomFromReservationGroup = useCallback(async (id) => {
		try { await pmsService.removeRoomFromReservationGroup(id); await reload(); } catch (err) { setError(err.message); throw err; }
	}, [reload]);
	const splitReservationGroup = useCallback(async (groupId) => {
		try { await pmsService.splitReservationGroup(groupId); await reload(); } catch (err) { setError(err.message); throw err; }
	}, [reload]);
	const deletePlannerReservation = useCallback(async (id) => {
		try { await pmsService.deletePlannerReservation(id); await reload(); } catch (err) { setError(err.message); throw err; }
	}, [reload]);
	const movePlannerReservation = useCallback(async (payload) => {
		try { await pmsService.movePlannerReservation(payload); await reload(); } catch (err) { setError(err.message); throw err; }
	}, [reload]);
	const moveReservationGroup = useCallback(async (payload) => {
		try { await pmsService.moveReservationGroup(payload); await reload(); } catch (err) { setError(err.message); throw err; }
	}, [reload]);

	const removeReservation = useCallback(
		async (resId) => {
			try {
				await pmsService.removeReservation(resId);
				await reload();
			} catch (err) {
				setError(err.message);
			}
		},
		[reload]
	);

	const setRoomStatus = useCallback(
		async (roomId, status) => {
			try {
				await pmsService.setRoomStatus(roomId, status);
				await reload();
			} catch (err) {
				setError(err.message);
			}
		},
		[reload]
	);

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
