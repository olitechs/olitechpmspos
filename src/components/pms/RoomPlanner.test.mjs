import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getRoomPlannerResponsiveMode } from '../../lib/roomPlannerResponsive.js';

const source = readFileSync(new URL('./RoomPlanner.jsx', import.meta.url), 'utf8');

test('reservation hover card shows booking, stay, meal plan, payment and Folio details', () => {
  assert.ok(source.includes('className="reservation-hover-card"'));
  assert.ok(source.includes('Reservation No. {getPlannerReservationNumber(hoverCard.reservation)}'));
  assert.ok(source.includes('formatPlannerDate(rv.checkIn)'));
  assert.ok(source.includes('differenceInCalendarDays(parseDate(rv.checkOut),parseDate(rv.checkIn))'));
  assert.ok(source.includes('Total room:'));
  assert.ok(source.includes('Booking notes:'));
  assert.ok(source.includes('getPlannerMealDescription(hoverCard.reservation.mealPlan)'));
  assert.ok(source.includes('getPlannerPaymentDetails(hoverCard.reservation).method'));
  assert.ok(source.includes('>Folio</button>'));
  assert.ok(source.includes('openFolio(hoverCard.reservation)'));
  assert.ok(source.includes('data-room-planner-hover-card'));
  assert.ok(source.includes('createPortal('));
  assert.ok(source.includes('showReservationHover(e,rv)'));
});

test('PMS reservation mapping supplies reference, currency and payment metadata to planner cards', () => {
  const store = readFileSync(new URL('../../data/PmsStore.jsx', import.meta.url), 'utf8');
  assert.ok(store.includes('reservationNumber: r.confirmation_code'));
  assert.ok(store.includes('currency: r.currency || r.booking_details?.currency'));
  assert.ok(store.includes('paymentMethod: r.payment_method'));
  assert.ok(store.includes('paidAt: r.paid_at'));
});

test('room planner defaults to a 15-day window centred around today', () => {
  assert.ok(source.includes('export const getRollingPlannerRange = (today) =>'));
  assert.ok(source.includes('from: dateKey(subDays(today, 2))'));
  assert.ok(source.includes('to: dateKey(addDays(today, 12))'));
  assert.ok(source.includes('useState(initialRange)'));
});

test('today action restores the same 15-day window and month mode clears custom dates', () => {
  assert.ok(source.includes('const { from, to } = getRollingPlannerRange(todayDate)'));
  assert.ok(source.includes('const switchView = (mode) => { setViewMode(mode); setRange(null)'));
  assert.ok(source.includes('eachDayOfInterval({ start, end: addDays(start, 14) })'));
});

test('custom date ranges remain bounded to 31 days and reject reversed dates', () => {
  assert.ok(source.includes("if (to < from) { setRangeError('End date must be on or after start date.');"));
  assert.ok(source.includes("if (days > 31) { setRangeError('Maximum visible range is 31 days.');"));
});

test('new reservation payment status uses three clean BB Planner legend buttons', () => {
  assert.ok(source.includes('<Field label="Payment status">'));
  assert.ok(source.includes("{value:'fully_paid',label:'Paid',amount:total}"));
  assert.ok(source.includes("{value:'partially_paid',label:'Deposit',amount:total*0.5}"));
  assert.ok(source.includes("{value:'not_paid',label:'Not paid',amount:0}"));
  assert.ok(source.includes('aria-pressed={selected}'));
  assert.ok(source.includes('background:style.background,color:style.color'));
  assert.ok(source.includes('Amount received: KES'));
});

test('room closures use the persisted property-scoped closure service', () => {
  assert.ok(source.includes('pmsService.listRoomClosures(propertyId)'));
  assert.ok(source.includes('pmsService.createRoomClosure({ property_id: propertyId'));
  assert.ok(source.includes('pmsService.deleteRoomClosure(closure.id)'));
  assert.ok(source.includes('item.start_date <= key && key < item.end_date'));
  assert.ok(!source.includes('closure-${Date.now()}'));
});

test('planner supports resize, touch moves, drag-to-create and move undo/redo', () => {
  assert.ok(source.includes('const beginResize ='));
  assert.ok(source.includes("beginResize(e,rv,'start')"));
  assert.ok(source.includes("beginResize(e,rv,'end')"));
  assert.ok(source.includes('const beginTouchDrag ='));
  assert.ok(source.includes('const beginCreateDrag ='));
  assert.ok(source.includes('const undoPlannerMove ='));
  assert.ok(source.includes('const redoPlannerMove ='));
  assert.ok(source.includes('recordPlannerMove(reservation, target)'));
});

test('planner filters by floor and can switch to a date-grouped day list', () => {
  assert.ok(source.includes('Filter by floor'));
  assert.ok(source.includes('collapsedRoomTypes.includes(typeName)'));
  assert.ok(source.includes('Room groups'));
  assert.ok(source.includes('const [mobileListMode, setMobileListMode]'));
  assert.ok(source.includes('filteredReservations.filter(rv=>rv.checkIn<=key&&rv.checkOut>key)'));
  assert.ok(source.includes('Day list'));
  assert.ok(source.includes('All tags'));
  assert.ok(source.includes('Filter by tag'));
});

test('planner toolbar wraps and all three view modes remain reachable', () => {
  assert.ok(source.includes('Planner</button>'));
  assert.ok(source.includes('List</button>'));
  assert.ok(source.includes('Day list</button>'));
  assert.ok(source.includes('flex-wrap:wrap;min-width:0'));
  assert.ok(source.includes('Clear filters'));
});

test('planner exposes compact, comfortable and large row density settings', () => {
  assert.ok(source.includes("const [density, setDensity] = useState('compact')"));
  assert.ok(source.includes('value="comfortable">Comfortable'));
  assert.ok(source.includes('value="large">Large'));
  assert.ok(source.includes("const ROOM_ROW_HEIGHT = density === 'large' ? 80 : density === 'comfortable' ? 48 : 30"));
});

test('room rows are rendered through a bounded virtual window', () => {
  assert.ok(source.includes('const virtualRows = orderedRows.slice(virtualStart, virtualEnd)'));
  assert.ok(source.includes('topSpacerHeight'));
  assert.ok(source.includes('bottomSpacerHeight'));
});

test('option reservations persist a 24-hour expiry and require explicit confirmation', () => {
  assert.ok(source.includes('Optioned · valid for 24 hours'));
  assert.ok(source.includes('pmsService.createOptionedReservationBundle(createPayload)'));
  assert.ok(source.includes('pmsService.setReservationOption(selectedReservation.id,true)'));
  assert.ok(source.includes('pmsService.setReservationOption(selectedReservation.id,false)'));
  assert.ok(source.includes('Expires in'));
  assert.ok(source.includes('!selectedReservation.optionExpiresAt'));
});

test('option expiry is server-authoritative and does not silently extend on edits', () => {
  const service = readFileSync(new URL('../../services/pmsService.js', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../../../supabase/migrations/20261108100000_room_planner_option_expiry.sql', import.meta.url), 'utf8');
  assert.ok(service.includes("'fn_create_optioned_reservation_bundle'"));
  assert.ok(service.includes("'fn_set_reservation_option'"));
  assert.ok(service.includes("'fn_expire_room_planner_options'"));
  assert.ok(migration.includes("now() + interval '24 hours'"));
  assert.ok(migration.includes('coalesce(option_expires_at, now() + interval'));
  assert.ok(migration.includes("set status = 'cancelled'"));
  assert.ok(migration.includes('fn_check_room_availability'));
  assert.ok(migration.includes('pms_reservation_option_created'));
  assert.ok(migration.includes('pms_reservation_option_confirmed'));
  assert.ok(migration.includes('Every room in a joint reservation'));
  assert.ok(migration.includes('coalesce(r.option_expires_at, now() + interval'));
  assert.ok(migration.includes('Confirm the reservation option before check-in.'));
});


test('room-type groups render visible collapsible headers and stay inside virtual row geometry', () => {
  assert.ok(source.includes("kind: 'group', typeName, count: group.length"));
  assert.ok(source.includes('virtualRows.map((entry)'));
  assert.ok(source.includes('aria-expanded={!collapsed}'));
  assert.ok(source.includes('setCollapsedRoomTypes(current=>collapsed?'));
  assert.ok(source.includes('minHeight:ROOM_ROW_HEIGHT'));
  assert.ok(source.includes('orderedRows.length - virtualEnd'));
});


test('phone widths default to day-list mode and reservation bars stay within row density', () => {
  assert.ok(source.includes("window.matchMedia('(max-width: 767px)')"));
  assert.ok(source.includes("const syncMobileView = () => setMobileListMode(getRoomPlannerResponsiveMode(window.innerWidth).planner === 'day-list')"));
  assert.ok(source.includes('top:Math.max(2,(ROOM_ROW_HEIGHT-23)/2)'));
  assert.ok(source.includes('minHeight:ROOM_ROW_HEIGHT'));
});


test('target viewport widths select the correct navigation, toolbar and planner modes', () => {
  const cases = [
    [1920, 'rail', 'inline', 'timeline', 'inline'],
    [1440, 'rail', 'inline', 'timeline', 'inline'],
    [1366, 'rail', 'inline', 'timeline', 'inline'],
    [1280, 'rail', 'inline', 'timeline', 'inline'],
    [1024, 'drawer', 'inline', 'timeline', 'inline'],
    [768, 'drawer', 'stacked', 'timeline', 'inline'],
    [390, 'drawer', 'stacked', 'day-list', 'full-width'],
  ];
  for (const [width, navigation, toolbar, planner, toolbarActions] of cases) {
    assert.deepEqual(getRoomPlannerResponsiveMode(width), { navigation, toolbar, planner, toolbarActions }, `Unexpected layout mode at ${width}px`);
  }
});
