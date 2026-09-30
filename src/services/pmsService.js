import { supabase } from '@/lib/supabaseClient';

export const pmsService = {
	async listRoomTypes(propertyId) {
		const { data, error } = await supabase.from('room_types').select('*').eq('property_id', propertyId).order('name');
		if (error) throw new Error(error.message);
		return data || [];
	},

	async createRoomType(payload) {
		const { data, error } = await supabase.from('room_types').insert(payload).select().single();
		if (error) throw new Error(error.message);
		return data;
	},

	async updateRoomType(id, patch) {
		const { data, error } = await supabase.from('room_types').update(patch).eq('id', id).select().single();
		if (error) throw new Error(error.message);
		return data;
	},

	async deleteRoomType(id) {
		const { error } = await supabase.from('room_types').delete().eq('id', id);
		if (error) throw new Error(error.message);
	},

	async createRoom(payload) {
		const { data, error } = await supabase.from('rooms').insert(payload).select().single();
		if (error) throw new Error(error.message);
		return data;
	},

	async updateRoom(id, patch) {
		const { data, error } = await supabase.from('rooms').update(patch).eq('id', id).select().single();
		if (error) throw new Error(error.message);
		return data;
	},

	async deleteRoom(id) {
		const { error } = await supabase.from('rooms').delete().eq('id', id);
		if (error) throw new Error(error.message);
	},

	async listRatePlans(propertyId) {
		const { data, error } = await supabase.from('rate_plans').select('*').eq('property_id', propertyId).order('name');
		if (error) throw new Error(error.message);
		return data || [];
	},

	async createRatePlan(payload) {
		const { data, error } = await supabase.from('rate_plans').insert(payload).select().single();
		if (error) throw new Error(error.message);
		return data;
	},

	async updateRatePlan(id, patch) {
		const { data, error } = await supabase.from('rate_plans').update(patch).eq('id', id).select().single();
		if (error) throw new Error(error.message);
		return data;
	},

	async deleteRatePlan(id) {
		const { error } = await supabase.from('rate_plans').delete().eq('id', id);
		if (error) throw new Error(error.message);
	},

	async listHousekeepingTasks(propertyId) {
		const { data, error } = await supabase.from('housekeeping_tasks').select('*, room:rooms(number), assignee:profiles(full_name,email)').eq('property_id', propertyId).order('created_at', { ascending: false });
		if (error) throw new Error(error.message);
		return data || [];
	},

	async createHousekeepingTask(payload) {
		const { data, error } = await supabase.from('housekeeping_tasks').insert(payload).select().single();
		if (error) throw new Error(error.message);
		return data;
	},

	async updateHousekeepingTask(id, patch) {
		const { data, error } = await supabase.from('housekeeping_tasks').update(patch).eq('id', id).select().single();
		if (error) throw new Error(error.message);
		return data;
	},

	async listRooms(propertyId) {
		const { data, error } = await supabase.from('rooms').select('*').eq('property_id', propertyId).order('number');
		if (error) throw new Error(error.message);
		return data;
	},

	async listReservations(propertyId) {
		const { data, error } = await supabase
			.from('reservations')
			.select('*')
			.eq('property_id', propertyId)
			.order('arrival');
		if (error) throw new Error(error.message);
		return data;
	},

	async listGuests(propertyId) {
		const { data, error } = await supabase.from('guests').select('*').eq('property_id', propertyId).order('name');
		if (error) throw new Error(error.message);
		return data;
	},

	async listGuestSummaries(propertyId) {
		const { data, error } = await supabase.from('guest_summary').select('*').eq('property_id', propertyId).order('name');
		if (error) throw new Error(error.message);
		return data;
	},

	async getFolio(reservationId) {
		const [{ data: charges, error: chargesError }, { data: totals, error: totalsError }] = await Promise.all([
			supabase.from('folio_charges').select('*').eq('reservation_id', reservationId).order('created_at'),
			supabase.from('folio_totals').select('*').eq('reservation_id', reservationId).maybeSingle(),
		]);
		if (chargesError) throw new Error(chargesError.message);
		if (totalsError) throw new Error(totalsError.message);
		return { charges: charges || [], totals: totals || { subtotal: 0, paid: 0, balance: 0 } };
	},

	async recordPayment({ propertyId, reservationId, amount, method }) {
		const shift = await this.getOpenCashierShift(propertyId);
		const { error } = await supabase.from('payments').insert({ property_id: propertyId, reservation_id: reservationId, amount, method, shift_id: shift?.id || null });
		if (error) throw new Error(error.message);
	},

	async createReservationBundle({ propertyId, roomIds, groupId, guestName, phone, checkIn, checkOut, paymentStatus, channel, mealPlan, adults, kidsCount, kidsAges, totalAmount, amountPaid, notes }) {
		const { data, error } = await supabase.rpc('fn_create_reservation_bundle', {
			p_property_id: propertyId, p_room_ids: roomIds, p_group_id: groupId, p_guest_name: guestName, p_phone: phone || null,
			p_arrival: checkIn, p_departure: checkOut, p_payment_status: paymentStatus, p_channel: channel, p_meal_plan: mealPlan,
			p_adults: adults, p_kids_count: kidsCount, p_kids_ages: kidsAges || [], p_total_amount: totalAmount, p_amount_paid: amountPaid, p_notes: notes || null,
		});
		if (error) throw new Error(error.message);
		return data || [];
	},

	async updatePlannerReservation(id, patch) {
		const { data, error } = await supabase.rpc('fn_update_planner_reservation', {
			p_reservation_id: id, p_room_id: patch.roomId, p_arrival: patch.checkIn, p_departure: patch.checkOut, p_guest_name: patch.guestName,
			p_payment_status: patch.paymentStatus, p_channel: patch.channel, p_meal_plan: patch.mealPlan, p_adults: patch.adults, p_kids_count: patch.kidsCount,
			p_kids_ages: patch.kidsAges || [], p_total_amount: patch.totalAmount, p_amount_paid: patch.amountPaid, p_notes: patch.notes || null,
		});
		if (error) throw new Error(error.message); return data;
	},

	async addRoomToReservationGroup({ reservationId, roomId }) {
		const { data, error } = await supabase.rpc('fn_add_room_to_reservation_group', { p_reservation_id: reservationId, p_room_id: roomId });
		if (error) throw new Error(error.message); return data;
	},

	async removeRoomFromReservationGroup(reservationId) {
		const { error } = await supabase.rpc('fn_delete_planner_reservation', { p_reservation_id: reservationId });
		if (error) throw new Error(error.message);
	},

	async splitReservationGroup(groupId) {
		const { error } = await supabase.rpc('fn_split_reservation_group', { p_group_id: groupId });
		if (error) throw new Error(error.message);
	},

	async deletePlannerReservation(id) {
		const { error } = await supabase.rpc('fn_delete_planner_reservation', { p_reservation_id: id });
		if (error) throw new Error(error.message);
	},

	async movePlannerReservation({ reservationId, roomId, checkIn, checkOut }) {
		const { data, error } = await supabase.rpc('fn_move_planner_reservation', { p_reservation_id: reservationId, p_room_id: roomId, p_arrival: checkIn, p_departure: checkOut });
		if (error) throw new Error(error.message); return data;
	},

	async moveReservationGroup({ groupId, movedReservationId, roomId, checkIn, checkOut }) {
		const { data, error } = await supabase.rpc('fn_move_reservation_group', { p_group_id: groupId, p_moved_reservation_id: movedReservationId, p_target_room_id: roomId, p_target_arrival: checkIn, p_target_departure: checkOut });
		if (error) throw new Error(error.message); return data;
	},

	async checkInReservation(reservationId) {
		const { data, error } = await supabase.rpc('fn_check_in_reservation', { p_reservation_id: reservationId });
		if (error) throw new Error(error.message);
		return data;
	},

	async walkInCheckIn({ propertyId, roomId, guestName, phone, checkIn, checkOut, partySize, rate }) {
		const { data, error } = await supabase.rpc('fn_walk_in_check_in', {
			p_property_id: propertyId,
			p_room_id: roomId,
			p_guest_name: guestName,
			p_phone: phone,
			p_check_in: checkIn,
			p_check_out: checkOut,
			p_party_size: partySize,
			p_rate: rate,
		});
		if (error) throw new Error(error.message);
		return data;
	},

	async checkOutRoom(roomId) {
		const { error } = await supabase.rpc('fn_check_out_room', { p_room_id: roomId });
		if (error) throw new Error(error.message);
	},

	async removeReservation(reservationId) {
		const { error } = await supabase.rpc('fn_remove_reservation', { p_reservation_id: reservationId });
		if (error) throw new Error(error.message);
	},

	async listRoomClosures(propertyId) {
		const { data, error } = await supabase
			.from('room_closures')
			.select('*')
			.eq('property_id', propertyId)
			.order('start_date');
		if (error) throw new Error(error.message);
		return data || [];
	},

	async createRoomClosure(payload) {
		const { data, error } = await supabase
			.from('room_closures')
			.insert(payload)
			.select()
			.single();
		if (error) throw new Error(error.message);
		return data;
	},

	async deleteRoomClosure(id) {
		const { error } = await supabase.from('room_closures').delete().eq('id', id);
		if (error) throw new Error(error.message);
	},

	// Housekeeping (spec section 31) — rooms already carry a status column
	// (0002_pms_core.sql); this just updates it directly, RLS-protected
	// the same as every other write in this file.
	async setRoomStatus(roomId, status) {
		const { error } = await supabase.from('rooms').update({ status }).eq('id', roomId);
		if (error) throw new Error(error.message);
	},

	// Maintenance (spec section 32).
	async listMaintenanceTickets(propertyId) {
		const { data, error } = await supabase
			.from('maintenance_tickets')
			.select('*, room:rooms(number)')
			.eq('property_id', propertyId)
			.order('created_at', { ascending: false });
		if (error) throw new Error(error.message);
		return data;
	},

	async createMaintenanceTicket({ propertyId, roomId, issue, priority }) {
		const { error } = await supabase
			.from('maintenance_tickets')
			.insert({ property_id: propertyId, room_id: roomId || null, issue, priority: priority || 'medium' });
		if (error) throw new Error(error.message);
	},

	async updateMaintenanceTicket(id, patch) {
		const { error } = await supabase.from('maintenance_tickets').update(patch).eq('id', id);
		if (error) throw new Error(error.message);
	},

	// POS → PMS room charge (spec section 30). Called from BillPayment.jsx
	// when the cashier selects "Room Charge" as the payment method.
	async listActiveStays(propertyId) {
		const { data, error } = await supabase.rpc('list_room_charge_stays', { p_property_id: propertyId });
		if (error) throw new Error(error.message);
		return (data || []).map((row) => ({ id: row.id, guest_name: row.guest_name, room: { number: row.room_number } }));
	},

	async chargeToRoom({ propertyId, reservationId, description, amount }) {
		const { error } = await supabase.rpc('charge_restaurant_to_room', { p_property_id: propertyId, p_reservation_id: reservationId, p_description: description, p_amount: amount });
		if (error) throw new Error(error.message);
	},
	async recordPosSale({ propertyId, tableNumber, orderNumber, items, subtotal, discountAmount, vat, total, paymentMethod, reservationId }) {
		const { data, error } = await supabase.rpc('fn_record_pos_sale', { p_property_id: propertyId, p_table_number: tableNumber, p_order_number: orderNumber, p_items: items, p_subtotal: subtotal, p_discount_amount: discountAmount || 0, p_vat: vat, p_total: total, p_payment_method: paymentMethod, p_reservation_id: reservationId || null });
		if (error) throw new Error(error.message);
		return data;
	},
	async listReceiptsForReservation(reservationId) {
		const { data, error } = await supabase.from('pos_receipts').select('*').eq('reservation_id', reservationId).order('created_at', { ascending: false });
		if (error) throw new Error(error.message);
		return data || [];
	},
	async listReceiptsForProperty(propertyId, { limit = 200 } = {}) {
		const { data, error } = await supabase.from('pos_receipts').select('*').eq('property_id', propertyId).order('created_at', { ascending: false }).limit(limit);
		if (error) throw new Error(error.message);
		return data || [];
	},
	async getDailyPosSummary(propertyId, businessDate) {
		const { data, error } = await supabase.rpc('fn_daily_pos_summary', { p_property_id: propertyId, p_business_date: businessDate || undefined });
		if (error) throw new Error(error.message);
		return data || { total_revenue: 0, transactions: 0, average_check: 0, payment_breakdown: [], top_items: [], hourly_revenue: [] };
	},

	async addFolioCharge({ propertyId, reservationId, source = 'other', description, amount }) {
		const { data, error } = await supabase.from('folio_charges').insert({
			property_id: propertyId, reservation_id: reservationId, source, description, amount: Number(amount || 0),
		}).select().single();
		if (error) throw new Error(error.message);
		return data;
	},

	async getOpenCashierShift(propertyId) {
		const { data, error } = await supabase
			.from('cashier_shifts')
			.select('*')
			.eq('property_id', propertyId)
			.eq('opened_by', (await supabase.auth.getUser()).data.user?.id)
			.eq('status', 'open')
			.order('opened_at', { ascending: false })
			.limit(1)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return data;
	},

	async openCashierShift({ propertyId, openingFloat = 0 }) {
		const { data, error } = await supabase.rpc('fn_open_cashier_shift', { p_property_id: propertyId, p_opening_float: Number(openingFloat || 0) });
		if (error) throw new Error(error.message);
		return data;
	},

	async closeCashierShift({ shiftId, closingCashCount, notes }) {
		const { data, error } = await supabase.rpc('fn_close_cashier_shift', { p_shift_id: shiftId, p_closing_cash_count: Number(closingCashCount || 0), p_notes: notes || null });
		if (error) throw new Error(error.message);
		return data;
	},

	async getCashierShiftSummary(shiftId) {
		const { data, error } = await supabase.rpc('fn_cashier_shift_summary', { p_shift_id: shiftId });
		if (error) throw new Error(error.message);
		return data || {};
	},

	async listCashierReceipts(propertyId, shiftId) {
		let query = supabase.from('pos_receipts').select('*').eq('property_id', propertyId).order('created_at', { ascending: false }).limit(100);
		if (shiftId) query = query.eq('shift_id', shiftId);
		const { data, error } = await query;
		if (error) throw new Error(error.message);
		return data || [];
	},

	async listCashierAdjustments(propertyId, shiftId) {
		let query = supabase.from('cashier_adjustments').select('*').eq('property_id', propertyId).order('created_at', { ascending: false }).limit(100);
		if (shiftId) query = query.eq('shift_id', shiftId);
		const { data, error } = await query;
		if (error) throw new Error(error.message);
		return data || [];
	},

	async recordCashierAdjustment({ propertyId, shiftId, adjustmentType, targetType, targetId, amount, reason }) {
		const { data, error } = await supabase.rpc('fn_record_cashier_adjustment', {
			p_property_id: propertyId, p_shift_id: shiftId || null, p_adjustment_type: adjustmentType,
			p_target_type: targetType, p_target_id: targetId, p_amount: Number(amount || 0), p_reason: reason,
		});
		if (error) throw new Error(error.message);
		return data;
	},

	async approveCashierAdjustment({ adjustmentId, approve, reason }) {
		const { data, error } = await supabase.rpc('fn_approve_cashier_adjustment', {
			p_adjustment_id: adjustmentId, p_approve: Boolean(approve), p_reason: reason || null,
		});
		if (error) throw new Error(error.message);
		return data;
	},

	async listPayments(reservationId) {
		const { data, error } = await supabase.from('payments').select('*').eq('reservation_id', reservationId).order('created_at', { ascending: false });
		if (error) throw new Error(error.message);
		return data || [];
	},

};
