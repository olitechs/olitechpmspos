import { supabase } from '@/lib/supabaseClient';

export const pmsService = {

	async listProducts(propertyId) {
		const { data, error } = await supabase.from('products').select('*').eq('property_id', propertyId).order('name');
		if (error) throw new Error(error.message);
		return data || [];
	},
	async listSuppliers(propertyId) {
		const { data, error } = await supabase.from('suppliers').select('*').eq('property_id', propertyId).order('name');
		if (error) throw new Error(error.message);
		return data || [];
	},
	async listPurchaseOrders(propertyId) {
		const { data, error } = await supabase.from('purchase_orders').select('*, supplier:suppliers(name)').eq('property_id', propertyId).order('purchase_date', { ascending: false });
		if (error) throw new Error(error.message);
		return data || [];
	},
	async createPurchaseOrder({ propertyId, supplierId, lines, invoiceNo }) {
		const { data, error } = await supabase.rpc('fn_create_purchase_order', { p_property_id: propertyId, p_supplier_id: supplierId || null, p_lines: lines, p_invoice_no: invoiceNo || null });
		if (error) throw new Error(error.message);
		return data;
	},
	async receivePurchaseOrder({ purchaseOrderId, receivedLines = null }) {
		const { data, error } = await supabase.rpc('fn_receive_purchase_order', { p_purchase_order_id: purchaseOrderId, p_received_lines: receivedLines });
		if (error) throw new Error(error.message);
		return data;
	},

	async listRecipes(propertyId) {
		const { data, error } = await supabase.from('recipes').select('*, recipe_ingredients(*, product:products(name,unit))').eq('property_id', propertyId).order('menu_item_name');
		if (error) throw new Error(error.message); return data || [];
	},
	async upsertRecipe({ propertyId, menuItemName, yieldQty=1, ingredients, notes }) {
		const { data, error } = await supabase.rpc('fn_upsert_recipe', { p_property_id: propertyId, p_menu_item_name: menuItemName, p_yield_qty: Number(yieldQty || 1), p_ingredients: ingredients || [], p_notes: notes || null });
		if (error) throw new Error(error.message); return data;
	},
	async listLaundryOrders(propertyId) {
		const { data, error } = await supabase.from('laundry_orders').select('*').eq('property_id', propertyId).order('created_at', { ascending: false });
		if (error) throw new Error(error.message); return data || [];
	},
	async createLaundryOrder(payload) {
		const { data, error } = await supabase.rpc('fn_create_laundry_order', { p_property_id: payload.propertyId, p_reservation_id: payload.reservationId || null, p_room_id: payload.roomId || null, p_guest_name: payload.guestName || null, p_items: payload.items || [], p_total: Number(payload.total || 0), p_notes: payload.notes || null });
		if (error) throw new Error(error.message); return data;
	},
	async updateLaundryOrder({ orderId, status, notes }) {
		const { data, error } = await supabase.rpc('fn_update_laundry_order', { p_order_id: orderId, p_status: status, p_notes: notes || null });
		if (error) throw new Error(error.message); return data;
	},
	async listInventoryLocations(propertyId) {
		const { data, error } = await supabase.rpc('fn_ensure_inventory_locations', { p_property_id: propertyId });
		if (error) throw new Error(error.message); return data || [];
	},
	async listStockTransfers(propertyId) {
		const { data, error } = await supabase.from('stock_transfers').select('*, from_location:inventory_locations!stock_transfers_from_location_id_fkey(name), to_location:inventory_locations!stock_transfers_to_location_id_fkey(name)').eq('property_id', propertyId).order('created_at', { ascending: false });
		if (error) throw new Error(error.message); return data || [];
	},
	async createStockTransfer({ propertyId, fromLocationId, toLocationId, lines, reference }) {
		const { data, error } = await supabase.from('stock_transfers').insert({ property_id: propertyId, from_location_id: fromLocationId, to_location_id: toLocationId, lines, reference: reference || null, created_by: (await supabase.auth.getUser()).data.user?.id }).select().single();
		if (error) throw new Error(error.message); return data;
	},
	async completeStockTransfer(transferId) {
		const { data, error } = await supabase.rpc('fn_complete_stock_transfer', { p_transfer_id: transferId });
		if (error) throw new Error(error.message); return data;
	},

	async getBookingEngineConfig(propertyId) { const { data,error }=await supabase.rpc('fn_public_booking_engine_config',{p_property_id:propertyId}); if(error) throw new Error(error.message); return data; },
	async listChannelConnections(propertyId) { const { data,error }=await supabase.from('channel_connections').select('*').eq('property_id',propertyId).order('channel'); if(error) throw new Error(error.message); return data||[]; },
	async upsertChannelConnection({propertyId,channel,externalPropertyId}) { const { data,error }=await supabase.rpc('fn_channel_connection_upsert',{p_property_id:propertyId,p_channel:channel,p_external_property_id:externalPropertyId||null}); if(error) throw new Error(error.message); return data; },
	async getSubscription(propertyId) { const {data,error}=await supabase.rpc('fn_get_subscription',{p_property_id:propertyId}); if(error) throw new Error(error.message); return data; },
	async getSubscriptionAccess(propertyId,module) { const {data,error}=await supabase.rpc('fn_subscription_access',{p_property_id:propertyId,p_module:module}); if(error) throw new Error(error.message); return data||{allowed:false}; },
	async upsertSubscription({propertyId,planCode,status,trialEndsAt=null,currentPeriodEndsAt=null,graceEndsAt=null,enabledModules=[]}) { const {data,error}=await supabase.rpc('fn_upsert_subscription',{p_property_id:propertyId,p_plan_code:planCode,p_status:status,p_trial_ends_at:trialEndsAt,p_current_period_ends_at:currentPeriodEndsAt,p_grace_ends_at:graceEndsAt,p_enabled_modules:enabledModules}); if(error) throw new Error(error.message); return data; },
	async listSubscriptionEvents(propertyId) { const {data,error}=await supabase.from('subscription_events').select('*').eq('property_id',propertyId).order('created_at',{ascending:false}).limit(100); if(error) throw new Error(error.message); return data||[]; },
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
		return data || [];
	},

	async checkRoomAvailability({ propertyId, roomId, arrival, departure, excludeReservationId = null }) {
		const { data, error } = await supabase.rpc('fn_check_room_availability', {
			p_property_id: propertyId,
			p_room_id: roomId,
			p_arrival: arrival,
			p_departure: departure,
			p_exclude_reservation_id: excludeReservationId,
		});
		if (error) throw new Error(error.message);
		return data?.[0] || { available: false, conflict_type: 'unknown', conflict_message: 'Unable to verify room availability.' };
	},

	async listAvailableRooms({ propertyId, arrival, departure, roomTypeId = null }) {
		const { data, error } = await supabase.rpc('fn_get_available_rooms', {
			p_property_id: propertyId,
			p_arrival: arrival,
			p_departure: departure,
			p_room_type_id: roomTypeId,
		});
		if (error) throw new Error(error.message);
		return data || [];
	},

	async listGuests(propertyId) {
		const { data, error } = await supabase.from('guests').select('*').eq('property_id', propertyId).order('name');
		if (error) throw new Error(error.message);
		return data;
	},

	async listGuestHistory({ propertyId, guestId }) {
		const { data, error } = await supabase
			.from('reservations')
			.select('id, room_id, guest_name, arrival, departure, status, rate, total_amount, amount_paid, payment_status, channel, meal_plan, created_at')
			.eq('property_id', propertyId)
			.eq('guest_id', guestId)
			.order('arrival', { ascending: false });
		if (error) throw new Error(error.message);
		return data || [];
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
		const { data, error } = await supabase.rpc('fn_record_folio_payment', {
			p_property_id: propertyId,
			p_reservation_id: reservationId,
			p_amount: Number(amount || 0),
			p_method: method,
			p_shift_id: shift?.id || null,
		});
		if (error) throw new Error(error.message);
		return data;
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

	async listHousekeepingTasks(propertyId) {
		const { data, error } = await supabase.rpc('fn_housekeeping_list_tasks', { p_property_id: propertyId });
		if (error) throw new Error(error.message);
		return data || [];
	},
	async createHousekeepingTask({ propertyId, roomId, taskType='checkout_clean', priority='normal', reservationId=null, notes=null }) {
		const { data, error } = await supabase.rpc('fn_create_housekeeping_task', {
			p_property_id: propertyId, p_room_id: roomId, p_task_type: taskType, p_priority: priority,
			p_reservation_id: reservationId, p_notes: notes,
		});
		if (error) throw new Error(error.message);
		return data;
	},
	async updateHousekeepingTask({ taskId, status, assignedTo=null, notes=null }) {
		const { data, error } = await supabase.rpc('fn_update_housekeeping_task', {
			p_task_id: taskId, p_status: status, p_assigned_to: assignedTo, p_notes: notes,
		});
		if (error) throw new Error(error.message);
		return data;
	},
	async inspectHousekeepingTask({ taskId, pass, notes=null }) {
		const { data, error } = await supabase.rpc('fn_inspect_housekeeping_task', {
			p_task_id: taskId, p_pass: Boolean(pass), p_notes: notes,
		});
		if (error) throw new Error(error.message);
		return data;
	},
	async getHousekeepingDashboard(propertyId) {
		const { data, error } = await supabase.rpc('fn_housekeeping_dashboard', { p_property_id: propertyId });
		if (error) throw new Error(error.message);
		return data || {};
	},

	// Maintenance 2.0 — room-safe workflow is enforced by server-side RPCs.
	async listMaintenanceTickets(propertyId) {
		const { data, error } = await supabase
			.from('maintenance_tickets')
			.select('*, room:rooms(number)')
			.eq('property_id', propertyId)
			.order('created_at', { ascending: false });
		if (error) throw new Error(error.message);
		return data || [];
	},

	async createMaintenanceTicket({ propertyId, roomId, issue, priority }) {
		const { data, error } = await supabase.rpc('fn_create_maintenance_ticket', {
			p_property_id: propertyId,
			p_room_id: roomId || null,
			p_issue: issue,
			p_priority: priority || 'medium',
		});
		if (error) throw new Error(error.message);
		return data;
	},

	async updateMaintenanceTicket(id, { status, assignedTo = null, resolutionNotes = null, returnStatus = null }) {
		const { data, error } = await supabase.rpc('fn_update_maintenance_ticket', {
			p_ticket_id: id,
			p_status: status,
			p_assigned_to: assignedTo,
			p_resolution_notes: resolutionNotes,
			p_return_status: returnStatus,
		});
		if (error) throw new Error(error.message);
		return data;
	},

	async getMaintenanceDashboard(propertyId) {
		const { data, error } = await supabase.rpc('fn_maintenance_dashboard', { p_property_id: propertyId });
		if (error) throw new Error(error.message);
		return data || {};
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
	async getBusinessDate(propertyId) {
		const { data, error } = await supabase.rpc('fn_get_business_date', { p_property_id: propertyId });
		if (error) throw new Error(error.message);
		return data;
	},

	async getNightAuditPrecheck(propertyId, businessDate) {
		const { data, error } = await supabase.rpc('fn_night_audit_precheck', { p_property_id: propertyId, p_business_date: businessDate });
		if (error) throw new Error(error.message);
		return data || {};
	},

	async runNightAudit({ propertyId, notes }) {
		const { data, error } = await supabase.rpc('fn_run_night_audit', { p_property_id: propertyId, p_notes: notes || null });
		if (error) throw new Error(error.message);
		return data;
	},

	async listNightAudits(propertyId) {
		const { data, error } = await supabase.rpc('fn_night_audit_history', { p_property_id: propertyId });
		if (error) throw new Error(error.message);
		return data || [];
	},

	async getDailyPosSummary(propertyId, businessDate) {
		const { data, error } = await supabase.rpc('fn_daily_pos_summary', { p_property_id: propertyId, p_business_date: businessDate || undefined });
		if (error) throw new Error(error.message);
		return data || { total_revenue: 0, transactions: 0, average_check: 0, payment_breakdown: [], top_items: [], hourly_revenue: [] };
	},

	async getRecentDashboardActivity(propertyId, limit = 8) {
		const { data, error } = await supabase.rpc('fn_recent_dashboard_activity', {
			p_property_id: propertyId,
			p_limit: limit,
		});
		if (error) throw new Error(error.message);
		return Array.isArray(data) ? data : [];
	},

	async addFolioCharge({ propertyId, reservationId, source = 'other', description, amount }) {
		const { data, error } = await supabase.rpc('fn_add_folio_charge', {
			p_property_id: propertyId,
			p_reservation_id: reservationId,
			p_source: source,
			p_description: description,
			p_amount: Number(amount || 0),
		});
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
