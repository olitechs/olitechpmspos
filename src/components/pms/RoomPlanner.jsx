import React, { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDays, ChevronLeft, ChevronRight, Link2, Plus, RefreshCw, X, Save, Trash2, Ban,
  FileDown, BedDouble, AlertTriangle, Settings2, Search, Users, CreditCard, StickyNote, Clock, LogIn, LogOut, Pencil, SlidersHorizontal, ChevronDown,
} from 'lucide-react';
import {
  format, addDays, differenceInCalendarDays, eachDayOfInterval, endOfMonth, startOfMonth, subDays,
} from 'date-fns';
import { toast } from 'sonner';
import { pmsService } from '@/services/pmsService';
import { Select } from '@/components/ui/select';
import { useAuth } from '@/lib/AuthContext';
import DocumentExportMenu from '@/components/shared/DocumentExportMenu';
import ReportDataTable from '@/components/shared/ReportDataTable';
import Folio from '@/components/modules/Folio';
import { buildRoomPlannerDefinition } from '@/services/reportDefinitions';
import { findRoomReservationOverlap, getPmsTodayDate, overlapsStayRanges } from '@/lib/pmsDateUtils';
import { getRoomPlannerResponsiveMode } from '@/lib/roomPlannerResponsive';
import { NAVY, TEAL, SAND, SURFACE, SURFACE2, BORDER, MUTED, DESTRUCTIVE } from '@/data/palette';
import { getStayBarGeometry, getPastStayOpacity, getPaymentStatusFromAmounts as derivePaymentStatus } from '@/lib/roomPlannerGeometry';

export const CHANNELS = ['direct', 'booking_com', 'unknown'];
export const MEAL_PLANS = ['bed_only', 'bb', 'half_board', 'full_board'];
export const BOOKING_STATUSES = ['booked', 'checked_in', 'checked_out'];

const DAY_WIDTH = 56;
const ROOM_COL_WIDTH = 208;

// CALENDAR THEME: Green/Yellow/Orange - Rectangle bars, English
export const getReservationBarStyle = (status = 'occupied') => ({
  optioned:{background:'var(--stay-optioned)',color:'var(--payment-text)',border:'var(--stay-optioned)',label:'Optioned'},
  confirmed:{background:'transparent',color:'var(--text)',border:'var(--stay-occupied)',label:'Confirmed / arriving'},
  occupied:{background:'var(--stay-occupied)',color:'var(--payment-text)',border:'var(--stay-occupied)',label:'In-house'},
  checkout:{background:'var(--stay-checkout)',color:'var(--payment-text)',border:'var(--stay-checkout)',label:'Checking out today'},
  checked_out:{background:'var(--stay-occupied)',color:'var(--payment-text)',border:'var(--stay-occupied)',label:'Checked out'},
  closed:{background:'var(--stay-closed)',color:'var(--text)',border:'var(--stay-closed)',label:'Out of order / closure'},
}[status] || {background:'var(--stay-occupied)',color:'var(--payment-text)',border:'var(--stay-occupied)',label:'In-house'});

export const getPaymentStatusFromAmounts = derivePaymentStatus;
export const getPaymentStyle = (status) => ({
  fully_paid: { background: 'var(--pay-paid)', color: 'var(--pay-paid-fg)', border: 'var(--pay-paid-bd)', label: 'Total Paid' },
  partially_paid: { background: 'var(--pay-part)', color: 'var(--pay-part-fg)', border: 'var(--pay-part-bd)', label: 'Partially Paid' },
  not_paid: { background: 'var(--pay-none)', color: 'var(--pay-none-fg)', border: 'var(--pay-none-bd)', label: 'No Amount Paid' },
}[status] || { background: 'var(--pay-none)', color: 'var(--pay-none-fg)', border: 'var(--pay-none-bd)', label: 'No Amount Paid' });

export function getBarOpacity(bookingStatus, checkOut, today) { return checkOut && today ? getPastStayOpacity(checkOut, today) : bookingStatus === 'checked_out' ? 0.55 : 1; }
export function isOverlapping(r1, r2) {
  return r1.roomId === r2.roomId && overlapsStayRanges(r1.checkIn, r1.checkOut, r2.checkIn, r2.checkOut);
}
export function checkOverlap(reservationList, newRoomId, newCheckIn, newCheckOut, excludeReservationId) {
  return findRoomReservationOverlap(reservationList, newRoomId, newCheckIn, newCheckOut, excludeReservationId);
}
export function calculateDailyStats(reservations, date) {
  const key = typeof date === 'string' ? date : format(date, 'yyyy-MM-dd');
  const active = reservations.filter((r) => r.status !== 'cancelled');
  return {
    arrivals: active.filter((r) => (r.checkIn || r.arrival)?.slice(0, 10) === key).length,
    inHouse: active.filter((r) => {
      const ci = (r.checkIn || r.arrival)?.slice(0, 10);
      const co = (r.checkOut || r.departure)?.slice(0, 10);
      return ci <= key && co > key && (r.bookingStatus || normalizeBookingStatus(r.status)) !== 'checked_out';
    }).length,
    checkOuts: active.filter((r) => (r.checkOut || r.departure)?.slice(0, 10) === key).length,
  };
}

const ROOM_STATUS = {
  available: { fill: 'var(--text-muted)', label: 'Available' }, booked: { fill: 'var(--primary)', label: 'Booked' }, occupied: { fill: 'var(--room-occupied)', label: 'Occupied' },
  dirty: { fill: 'var(--room-dirty)', label: 'Dirty' }, cleaning: { fill: 'var(--room-clean)', label: 'Cleaning' }, maintenance: { fill: 'var(--room-out-of-order)', label: 'Maintenance' },
  out_of_service: { fill: 'var(--room-out-of-order)', label: 'Out of Service' }, blocked: { fill: 'var(--room-out-of-order)', label: 'Blocked' },
};
const channelLabel = { direct: 'Direct', booking_com: 'Booking.com', unknown: 'Unknown' };
const mealLabel = { bed_only: 'Bed Only', bb: 'BB', half_board: 'HB', full_board: 'FB' };
const paymentLabel = { fully_paid: 'Fully Paid', partially_paid: 'Deposit / Partially Paid', not_paid: 'Not Paid' };

const dateKey = (d) => format(d, 'yyyy-MM-dd');

// The rolling planner is a 15-day window: two days before today plus today and
// twelve following days, keeping today visible immediately beside the room column.
export const getRollingPlannerRange = (today) => ({
  from: dateKey(subDays(today, 2)),
  to: dateKey(addDays(today, 12)),
});
const parseDate = (v) => { if (!v) return null; const [y, m, d] = String(v).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const normalizeBookingStatus = (status) => ({ 'checked-in': 'checked_in', 'checked-out': 'checked_out', booked: 'booked' }[status] || status || 'booked');
const normalizeReservation = (r) => ({
  ...r,
  guestName: r.guestName || r.guest || r.guest_name || '',
  roomId: r.roomId || r.room_id,
  roomType: r.roomType || r.room_type || '',
  checkIn: (r.checkIn || r.arrival || r.check_in || '')?.slice(0, 10),
  checkOut: (r.checkOut || r.departure || r.check_out || '')?.slice(0, 10),
  bookingStatus: r.bookingStatus || normalizeBookingStatus(r.status),
  optionExpiresAt: r.optionExpiresAt || r.option_expires_at || null,
  plannerStatus: r.plannerStatus || ((r.optionExpiresAt || r.option_expires_at) && new Date(r.optionExpiresAt || r.option_expires_at).getTime() > Date.now() ? 'optioned' : undefined),
  paymentStatus: r.paymentStatus || 'not_paid',
  channel: r.channel || 'direct',
  mealPlan: r.mealPlan || 'bed_only',
  adults: Number(r.adults ?? r.partySize ?? 1),
  kidsCount: Number(r.kidsCount ?? 0),
  kidsAges: Array.isArray(r.kidsAges) ? r.kidsAges : [],
  totalAmount: Number(r.totalAmount ?? r.total ?? r.rate ?? 0),
  amountPaid: Number(r.amountPaid ?? 0),
});
const formatGuests = (r) => `${r.adults || 1}A${r.kidsCount ? `,${r.kidsCount}K` : ''}`;
const formatPlannerDate = (value) => {
  const date = parseDate(value);
  return date ? format(date, 'dd/MM/yyyy') : '—';
};
const formatPlannerAmount = (value) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const getPlannerReservationNumber = (rv) => rv.reservationNumber || rv.reservation_number || rv.bookingReference || rv.booking_reference || String(rv.id || '').slice(0, 6).toUpperCase() || '—';
const getPlannerCurrency = (rv) => rv.currency || rv.bookingDetails?.currency || rv.booking_details?.currency || 'USD';
const getPlannerMealDescription = (mealPlan) => ({
  bed_only: 'Room only',
  bb: 'Breakfast included',
  half_board: 'Breakfast and dinner included',
  full_board: 'Breakfast, lunch and dinner included',
}[mealPlan] || 'Meal plan not specified');
const getPlannerPaymentDetails = (rv) => {
  const details = rv.bookingDetails || rv.booking_details || {};
  const method = rv.paymentMethod || rv.payment_method || details.paymentMethod || details.payment_method || '';
  const paidAt = rv.paidAt || rv.paid_at || rv.paymentDate || rv.payment_date || details.paidAt || details.paid_at || details.paymentDate || details.payment_date || '';
  return { method, paidAt };
};


function SelectField({ value, onChange, children, className = '' }) { return <Select value={value} onValueChange={onChange} className={className}>{children}</Select>; }
function InputField({ className = '', ...props }) { return <input {...props} className={`room-planner-input w-full h-10 rounded-lg px-3 text-sm outline-none ${className}`} style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: NAVY }} />; }
function Field({ label, children }) { return <label className="block text-xs font-semibold" style={{ color: NAVY }}>{label}<div className="mt-1">{children}</div></label>; }
function Modal({ title, children, onClose, wide = false }) { return <div className="room-planner-modal-backdrop fixed inset-0 z-[100] bg-[var(--overlay-scrim)] flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} className={`room-planner-modal w-full ${wide ? 'max-w-6xl' : 'max-w-xl'} max-h-[92vh] overflow-y-auto rounded-2xl`} style={{ background: SURFACE }}><div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5" style={{ background: SURFACE, borderBottom: `1px solid ${BORDER}` }}><h2 className="text-base font-semibold" style={{ color: NAVY }}>{title}</h2><button type="button" aria-label="Close" onClick={onClose} className="room-planner-icon-close rounded-lg p-2" style={{ color: MUTED }}><X size={18}/></button></div>{children}</div></div>; }

const emptyForm = (room, date) => ({
  guestName: '', firstName: '', lastName: '', phone: '', alternativePhone: '', email: '', nationality: '', residenceCountry: '', address: '', idType: 'passport', idNumber: '', guestNotes: '',
  checkIn: dateKey(date), checkOut: dateKey(addDays(date, 1)), arrivalTime: '14:00', departureTime: '10:00', paymentStatus: 'not_paid', bookingStatus: 'confirmed', channel: 'direct', mealPlan: 'bed_only',
  adults: 1, kidsCount: 0, kidsAges: [], totalAmount: Number(room?.base_rate || 0), amountPaid: 0, depositRequired: 0, depositMethod: 'cash', rate: Number(room?.base_rate || 0), ratePlanId: '', services: 0, discount: 0, tax: 0,
  company: '', agent: '', externalReference: '', groupReference: '', specialRequests: '', bookingNotes: '',
  roomTypeId: room?.room_type_id || '', roomId: room?.id || '', joint: false, selectedRoomIds: room?.id ? [room.id] : [], notes: '',
});


export default function RoomPlanner({ rooms = [], reservations = [], onRefresh }) {
  const plannerRooms = rooms;
  const plannerReservations = reservations;
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const todayDate = useMemo(() => getPmsTodayDate(), []);
  const today = dateKey(todayDate);
  useEffect(() => { const timer = setInterval(() => setClockNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!propertyId) return undefined;
    const timer = setInterval(async () => {
      try { const expired = await pmsService.expireRoomPlannerOptions(propertyId); if (expired > 0) onRefresh?.(); }
      catch (error) { console.error('[Room Planner] Option expiry reconciliation failed:', error); }
    }, 60000);
    return () => clearInterval(timer);
  }, [propertyId, onRefresh]);
    const initialRange = useMemo(() => getRollingPlannerRange(todayDate), [todayDate]);
  const [month, setMonth] = useState(startOfMonth(todayDate));
  const [clockNow, setClockNow] = useState(Date.now());
  const [viewMode, setViewMode] = useState('rolling');
  const [windowStart, setWindowStart] = useState(subDays(todayDate, 2));
  const [range, setRange] = useState(initialRange);
  const [fromInput, setFromInput] = useState(initialRange.from);
  const [toInput, setToInput] = useState(initialRange.to);
  const [rangeError, setRangeError] = useState('');
  const [focusToday, setFocusToday] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm(plannerRooms[0], todayDate));
  const [ratePlans, setRatePlans] = useState([]);
  const [ratePlansError, setRatePlansError] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [drag, setDrag] = useState(null);
  const [dragTarget, setDragTarget] = useState(null);
  const [moveConfirmation, setMoveConfirmation] = useState(null);
  const [groupMoveConfirmation, setGroupMoveConfirmation] = useState(null);
  const [linked, setLinked] = useState([]);
  const [addGroupRoomId, setAddGroupRoomId] = useState('');
  const [actionModal, setActionModal] = useState(null);
  const [folio, setFolio] = useState(null);
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeDescription, setChargeDescription] = useState('Room charge');
  const [exportPreview, setExportPreview] = useState(false);
  const [plannerToolsOpen, setPlannerToolsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [plannerWidth, setPlannerWidth] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [roomTypeFilter, setRoomTypeFilter] = useState('all');
  const [floorFilter, setFloorFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [mobileListMode, setMobileListMode] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const media = window.matchMedia('(max-width: 767px)');
    const syncMobileView = () => setMobileListMode(getRoomPlannerResponsiveMode(window.innerWidth).planner === 'day-list');
    syncMobileView();
    media.addEventListener?.('change', syncMobileView);
    return () => media.removeEventListener?.('change', syncMobileView);
  }, []);
  const [reservationListMode, setReservationListMode] = useState(false);
  const [collapsedRoomTypes, setCollapsedRoomTypes] = useState([]);
  const [viewLength, setViewLength] = useState('15');
  const [density, setDensity] = useState('compact');
  const [dateFormat, setDateFormat] = useState('dd/MM/yyyy');
  const [selectedReservation, setSelectedReservation] = useState(null);
  const [hoverCard, setHoverCard] = useState(null);
  const [closures, setClosures] = useState([]);
  const [closureModal, setClosureModal] = useState(false);
  const [closureForm, setClosureForm] = useState({ roomId: plannerRooms[0]?.id || '', startDate: dateKey(addDays(todayDate, 2)), endDate: dateKey(addDays(todayDate, 4)), reason: 'Out of order' });
  const [closureSaving, setClosureSaving] = useState(false);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [plannerScrollTop, setPlannerScrollTop] = useState(0);
  const [plannerViewportHeight, setPlannerViewportHeight] = useState(600);
  const scrollRef = useRef(null);
  const todayRef = useRef(null);
  const suppressCellClick = useRef(false);
  const resizeStartRef = useRef(null);
  const touchDragRef = useRef(null);
  const createDragRef = useRef(null);

  const normalizedReservations = useMemo(() => plannerReservations.filter(r => r.status !== 'cancelled').map(normalizeReservation), [plannerReservations]);
  useEffect(() => {
    if (!propertyId) { setClosures([]); return; }
    let active = true;
    pmsService.listRoomClosures(propertyId).then(rows => { if (active) setClosures(rows || []); }).catch(error => { if (active) toast.error(`Room closures could not be loaded: ${error.message}`); });
    return () => { active = false; };
  }, [propertyId]);
  useEffect(() => {
    if (!propertyId) return;
    let active = true;
    pmsService.listRatePlans(propertyId).then(rows => { if (active) { setRatePlans(rows || []); setRatePlansError(''); } }).catch(error => { if (active) setRatePlansError(error.message || 'Rate plans could not be loaded.'); });
    return () => { active = false; };
  }, [propertyId]);
  const roomTypeMap = useMemo(() => new Map(plannerRooms.map(r => [r.room_type_id, r.roomTypeName || r.room_type || 'Unassigned'])), [plannerRooms]);
  const filteredReservations = useMemo(() => normalizedReservations.filter(rv => {
    const room = plannerRooms.find(item => item.id === rv.roomId);
    const status = getPaymentStatusFromAmounts(rv.amountPaid, rv.totalAmount);
    const query = searchQuery.trim().toLowerCase();
    const matchesQuery = !query || [rv.guestName, rv.id, rv.reservationNumber, rv.reservation_number, rv.bookingReference, rv.booking_reference, rv.channel, room?.number, room?.name].some(value => String(value || '').toLowerCase().includes(query));
    const reservationTags = Array.isArray(rv.tags) ? rv.tags.map(tag => typeof tag === 'string' ? tag : tag?.name).filter(Boolean) : rv.tag ? [String(rv.tag)] : [];
    return matchesQuery && (paymentFilter === 'all' || status === paymentFilter) && (sourceFilter === 'all' || (rv.channel || 'direct') === sourceFilter) && (roomTypeFilter === 'all' || roomTypeMap.get(room?.room_type_id) === roomTypeFilter) && (floorFilter === 'all' || String(room?.floor ?? 'Unassigned') === floorFilter) && (tagFilter === 'all' || reservationTags.includes(tagFilter));
  }), [normalizedReservations, plannerRooms, searchQuery, paymentFilter, sourceFilter, roomTypeFilter, floorFilter, tagFilter, roomTypeMap]);
  const filteredRooms = useMemo(() => plannerRooms.filter(room => {
    const type = roomTypeMap.get(room.room_type_id) || room.roomTypeName || room.room_type || 'Unassigned';
    if (roomTypeFilter !== 'all' && type !== roomTypeFilter) return false;
    if (floorFilter !== 'all' && String(room.floor ?? 'Unassigned') !== floorFilter) return false;
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return [room.number, room.name, type].some(value => String(value || '').toLowerCase().includes(query)) || filteredReservations.some(rv => rv.roomId === room.id);
  }), [plannerRooms, roomTypeMap, roomTypeFilter, floorFilter, searchQuery, filteredReservations]);
  const groupedRooms = useMemo(() => {
    const groups = new Map();
    [...filteredRooms].sort((a,b) => Number(a.number) - Number(b.number)).forEach(r => { const key = roomTypeMap.get(r.room_type_id) || r.roomTypeName || r.room_type || 'Unassigned'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); });
    return [...groups.entries()];
  }, [filteredRooms, roomTypeMap]);

  const ROOM_ROW_HEIGHT = density === 'large' ? 80 : density === 'comfortable' ? 48 : 30;
  const orderedRows = useMemo(() => groupedRooms.flatMap(([typeName, group]) => [{ kind: 'group', typeName, count: group.length }, ...(collapsedRoomTypes.includes(typeName) ? [] : group.map(room => ({ kind: 'room', room, typeName })))]), [groupedRooms, collapsedRoomTypes]);
  const VIRTUAL_OVERSCAN = 6;
  const virtualStart = Math.max(0, Math.floor(Math.max(0, plannerScrollTop - 78) / ROOM_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
  const virtualEnd = Math.min(orderedRows.length, Math.ceil((plannerViewportHeight + Math.max(0, plannerScrollTop - 78)) / ROOM_ROW_HEIGHT) + VIRTUAL_OVERSCAN);
  const virtualRows = orderedRows.slice(virtualStart, virtualEnd);
  const topSpacerHeight = virtualStart * ROOM_ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(0, orderedRows.length - virtualEnd) * ROOM_ROW_HEIGHT;

  const columns = useMemo(() => {
    if (range) return eachDayOfInterval({ start: parseDate(range.from), end: parseDate(range.to) });
    if (viewMode === 'rolling') {
      const start = parseDate(dateKey(windowStart));
      return eachDayOfInterval({ start, end: addDays(start, 14) });
    }
    const monthDays = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
    if (focusToday && month.getTime() === startOfMonth(todayDate).getTime() && todayDate.getDate() <= 2) {
      return [subDays(startOfMonth(month), 2), subDays(startOfMonth(month), 1), ...monthDays];
    }
    return monthDays;
  }, [range, month, focusToday, todayDate, viewMode, windowStart]);

  // Stretch day columns to fill the viewport (never narrower than DAY_WIDTH). Bar geometry scales with dayWidth.
  const dayWidth = columns.length && plannerWidth
    ? Math.min(120, Math.max(DAY_WIDTH, Math.floor((plannerWidth - 32 - ROOM_COL_WIDTH - 2) / columns.length)))
    : DAY_WIDTH;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    setPlannerWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setPlannerWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [reservationListMode, mobileListMode]);

  const monthSegments = useMemo(() => columns.reduce((segments, day) => {
    const key = format(day, 'yyyy-MM');
    const last = segments[segments.length - 1];
    if (last?.key === key) last.span += 1;
    else segments.push({ key, label: format(day, 'MMMM yyyy'), span: 1 });
    return segments;
  }, []), [columns]);

  const filteredReservationsByRoom = useMemo(() => {
    const byRoom = new Map();
    const firstDay = dateKey(columns[0] || todayDate);
    const lastDayExclusive = dateKey(addDays(columns[columns.length - 1] || todayDate, 1));
    filteredReservations.forEach(rv => {
      if (!rv.checkIn || !rv.checkOut || rv.checkOut <= firstDay || rv.checkIn >= lastDayExclusive) return;
      if (!byRoom.has(rv.roomId)) byRoom.set(rv.roomId, []);
      byRoom.get(rv.roomId).push(rv);
    });
    return byRoom;
  }, [filteredReservations, columns, todayDate]);

  useEffect(() => {
    if (modal?.reservationId) setLinked(normalizedReservations.filter(r => r.groupId && r.groupId === modal.groupId));
  }, [modal?.reservationId, modal?.groupId, normalizedReservations]);

  useEffect(() => {
    if (!focusToday || !scrollRef.current || !todayRef.current) return;
    const timer = setTimeout(() => {
      // Keep two dates before today visible: today becomes the third date beside Rooms.
      const todayIndex = columns.findIndex(day => dateKey(day) === today);
      if (todayIndex >= 0) scrollRef.current.scrollLeft = Math.max(0, (todayIndex - 2) * dayWidth);
      setFocusToday(false);
    }, 50);
    return () => clearTimeout(timer);
  }, [columns, focusToday, range, viewMode, dayWidth]);

  const openCreate = (room, date) => { const next = emptyForm(room, date); setForm(next); setFormError(''); setLinked([]); setAddGroupRoomId(''); setModal({ mode: 'create' }); };
  const openEdit = (r) => {
    setSelectedReservation(null);
    setForm({ guestName: r.guestName, phone: r.phone || '', checkIn: r.checkIn, checkOut: r.checkOut, paymentStatus: r.paymentStatus, bookingStatus: r.plannerStatus === 'optioned' ? 'optioned' : 'confirmed', channel: r.channel, mealPlan: r.mealPlan, adults: r.adults || 1, kidsCount: r.kidsCount || 0, kidsAges: r.kidsAges || [], totalAmount: r.totalAmount, amountPaid: r.amountPaid, roomTypeId: r.roomTypeId || plannerRooms.find(x => x.id === r.roomId)?.room_type_id || '', roomId: r.roomId, joint: !!r.groupId, selectedRoomIds: [r.roomId], notes: r.notes || '' });
    setFormError(''); setAddGroupRoomId(''); setModal({ mode: 'edit', reservationId: r.id, groupId: r.groupId });
  };

  const calculatedReservationTotal = Math.max(0, Number(form.rate || 0) * Math.max(0, differenceInCalendarDays(parseDate(form.checkOut), parseDate(form.checkIn))) * (form.joint ? form.selectedRoomIds.length : 1) + Number(form.services || 0) + Number(form.tax || 0) - Number(form.discount || 0));

  const validateForm = () => {
    if (modal?.mode === 'create' && (!form.firstName.trim() || !form.lastName.trim())) return 'Guest first and last names are required.';
    if (modal?.mode === 'create' && !form.phone.trim()) return 'A primary contact phone number is required.';
    if (!form.guestName.trim()) return 'Guest name is required.';
    if (!form.checkIn || !form.checkOut || form.checkOut <= form.checkIn) return 'Check-out must be after check-in.';
    if (!form.adults || form.adults < 1 || form.adults > 10) return 'Adults must be between 1 and 10.';
    if (form.kidsCount < 0 || form.kidsCount > 6) return 'Kids must be between 0 and 6.';
    if (form.kidsAges.length !== Number(form.kidsCount) || form.kidsAges.some(a => a === '' || a === null || a === undefined || !Number.isInteger(Number(a)) || Number(a) < 0 || Number(a) > 17)) return 'Select a valid age between 0 and 17 for every child.';
    const totalForValidation = modal?.mode === 'create' ? calculatedReservationTotal : Number(form.totalAmount || 0);
    if (Number(form.amountPaid) < 0 || Number(form.amountPaid) > totalForValidation) return 'Deposit received cannot exceed the booking total.';
    if (modal?.mode === 'create' && (Number(form.depositRequired || 0) < 0 || Number(form.depositRequired || 0) > totalForValidation)) return 'Required deposit must be between zero and the booking total.';
    if (modal?.mode === 'create' && Number(form.amountPaid || 0) > 0 && Number(form.amountPaid) < totalForValidation * 0.5) return 'The current reservation workflow requires at least 50% for an initial deposit. Use Guest Folio for smaller advance payments.';
    const ids = form.joint ? form.selectedRoomIds : [form.roomId];
    if (!ids.length || ids.some(Boolean) === false) return 'Select at least one room.';
    const guestCount = Number(form.adults || 0) + Number(form.kidsCount || 0);
    const selectedRoomRows = plannerRooms.filter(room => ids.includes(room.id));
    if (selectedRoomRows.length !== ids.length) return 'One or more selected rooms are no longer available.';
    if (selectedRoomRows.some(room => room.active === false || ['maintenance','out_of_service','blocked'].includes(room.status))) return 'A selected room is inactive, blocked or out of service.';
    const totalCapacity = selectedRoomRows.reduce((sum, room) => sum + Number(room.capacity || 2), 0);
    if (guestCount > totalCapacity) return `Selected rooms accommodate ${totalCapacity} guests, but ${guestCount} guests are entered.`;
    for (const roomId of ids) {
      const hit = checkOverlap(normalizedReservations, roomId, form.checkIn, form.checkOut, modal?.mode === 'edit' ? modal.reservationId : undefined);
      if (hit) { const room = plannerRooms.find(x => x.id === roomId); return `Room ${room?.number || roomId} is already booked from ${hit.checkIn} to ${hit.checkOut} by ${hit.guestName}.`; }
    }
    return '';
  };

  const saveReservation = async () => {
    const error = validateForm(); setFormError(error); if (error) return;
    setSaving(true);
    try {
      if (modal.mode === 'create') {
        const roomIds = form.joint ? form.selectedRoomIds : [form.roomId];
        const totalAmount = calculatedReservationTotal; const amountPaid = Number(form.amountPaid || 0); const paymentStatus = getPaymentStatusFromAmounts(amountPaid, totalAmount);
        const nights = differenceInCalendarDays(parseDate(form.checkOut), parseDate(form.checkIn));
        const details = {
          guest: { firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim(), alternativePhone: form.alternativePhone.trim(), nationality: form.nationality.trim(), residenceCountry: form.residenceCountry.trim(), address: form.address.trim(), idType: form.idType, idNumber: form.idNumber.trim(), notes: form.guestNotes.trim() },
          booking: { submissionId: crypto.randomUUID(), ratePlanId: form.ratePlanId || null, source: form.channel, company: form.company.trim(), agent: form.agent.trim(), externalReference: form.externalReference.trim(), groupReference: form.groupReference.trim(), accommodationSubtotal: Number(form.rate || 0) * nights * roomIds.length, services: Number(form.services || 0), discount: Number(form.discount || 0), tax: Number(form.tax || 0), depositRequired: Number(form.depositRequired || 0), depositMethod: form.depositMethod, specialRequests: form.specialRequests.trim(), arrivalTime: form.arrivalTime, departureTime: form.departureTime, roomCount: roomIds.length, nightlyRate: Number(form.rate || 0) },
        };
        const createPayload = { propertyId, groupId: roomIds.length > 1 ? crypto.randomUUID() : null, roomIds, guestName: form.guestName.trim(), phone: form.phone.trim(), checkIn: form.checkIn, checkOut: form.checkOut, paymentStatus, channel: form.channel, mealPlan: form.mealPlan, adults: Number(form.adults), kidsCount: Number(form.kidsCount), kidsAges: form.kidsAges.map(Number), totalAmount, amountPaid, notes: form.bookingNotes || form.notes, details };
        if (form.bookingStatus === 'optioned') await pmsService.createOptionedReservationBundle(createPayload);
        else await pmsService.createReservationBundle(createPayload);
        toast.success('Reservation created');
      } else {
        const totalAmount = Number(form.totalAmount || 0); const amountPaid = Number(form.amountPaid || 0); const paymentStatus = getPaymentStatusFromAmounts(amountPaid, totalAmount);
        await pmsService.updatePlannerReservation(modal.reservationId, { guestName: form.guestName.trim(), roomId: form.roomId, checkIn: form.checkIn, checkOut: form.checkOut, paymentStatus, channel: form.channel, mealPlan: form.mealPlan, adults: Number(form.adults), kidsCount: Number(form.kidsCount), kidsAges: form.kidsAges.map(Number), totalAmount, amountPaid, notes: form.notes });
        toast.success('Reservation updated');
      }
      setModal(null); onRefresh?.();
    } catch (e) { setFormError(e.message); toast.error(e.message); } finally { setSaving(false); }
  };

  const addLinkedRoom = async () => { if (!modal?.reservationId || !addGroupRoomId) return; try { await pmsService.addRoomToReservationGroup({ reservationId: modal.reservationId, roomId: addGroupRoomId }); toast.success('Room added to joint reservation'); setAddGroupRoomId(''); onRefresh?.(); } catch (e) { toast.error(e.message); } };
  const removeLinkedRoom = async (id) => { if (!confirm('Remove this room from the joint reservation? This deletes only this linked reservation.')) return; try { await pmsService.removeRoomFromReservationGroup(id); toast.success('Room removed'); if (id === modal.reservationId) setModal(null); onRefresh?.(); } catch (e) { toast.error(e.message); } };
  const splitGroup = async () => { if (!modal?.groupId || !confirm('Split this joint reservation into independent plannerReservations?')) return; try { await pmsService.splitReservationGroup(modal.groupId); toast.success('Joint reservation split'); setModal(null); onRefresh?.(); } catch (e) { toast.error(e.message); } };
  const handleDelete = async () => { if (!modal?.reservationId || !confirm('Delete this reservation?')) return; try { await pmsService.deletePlannerReservation(modal.reservationId); toast.success('Reservation deleted'); setModal(null); onRefresh?.(); } catch (e) { toast.error(e.message); } };

  const recordPlannerMove = (reservation, target) => {
    setUndoStack(current => [...current.slice(-19), { reservationId: reservation.id, from: { roomId: reservation.roomId, checkIn: reservation.checkIn, checkOut: reservation.checkOut }, to: target }]);
    setRedoStack([]);
  };
  const undoPlannerMove = async () => {
    const action = undoStack[undoStack.length - 1]; if (!action) return;
    try {
      await pmsService.movePlannerReservation({ reservationId: action.reservationId, ...action.from });
      setUndoStack(current => current.slice(0, -1)); setRedoStack(current => [...current, action]);
      toast.success('Last planner move undone.'); onRefresh?.();
    } catch (error) { toast.error(error.message || 'Undo failed. The room may no longer be available.'); }
  };
  const redoPlannerMove = async () => {
    const action = redoStack[redoStack.length - 1]; if (!action) return;
    try {
      await pmsService.movePlannerReservation({ reservationId: action.reservationId, ...action.to });
      setRedoStack(current => current.slice(0, -1)); setUndoStack(current => [...current, action]);
      toast.success('Planner move redone.'); onRefresh?.();
    } catch (error) { toast.error(error.message || 'Redo failed. The room may no longer be available.'); }
  };

  const beginDrag = (e, r) => { e.stopPropagation(); setDrag({ reservation: r, originalRoomId: r.roomId, originalCheckIn: r.checkIn, originalCheckOut: r.checkOut }); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r.id); };
  const handleCellDragOver = (e, room, day) => { if (!drag) return; e.preventDefault(); setDragTarget({ roomId: room.id, date: dateKey(day) }); };
  const beginCreateDrag = (event, room, day) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    createDragRef.current = { roomId: room.id, startDate: dateKey(day) };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const finishCreateDrag = (event) => {
    if (event.pointerType !== 'mouse') return;
    const start = createDragRef.current; createDragRef.current = null;
    if (!start) return;
    const cell = document.elementsFromPoint(event.clientX, event.clientY).find(element => element?.dataset?.roomId && element?.dataset?.date);
    if (!cell || cell.dataset.roomId !== start.roomId || cell.dataset.date === start.startDate) return;
    const room = plannerRooms.find(item => item.id === start.roomId);
    if (!room) return;
    const endDay = cell.dataset.date < start.startDate ? start.startDate : cell.dataset.date;
    const checkIn = cell.dataset.date < start.startDate ? cell.dataset.date : start.startDate;
    const checkOut = dateKey(addDays(parseDate(endDay), 1));
    const next = emptyForm(room, parseDate(checkIn));
    next.checkIn = checkIn; next.checkOut = checkOut;
    setForm(next); setFormError(''); setLinked([]); setAddGroupRoomId(''); setModal({ mode: 'create' });
    suppressCellClick.current = true; setTimeout(() => { suppressCellClick.current = false; }, 0);
  };
  const beginTouchDrag = (event, reservation) => {
    if (event.pointerType !== 'touch') return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    touchDragRef.current = { reservation, pointerId: event.pointerId };
  };
  const finishTouchDrag = (event) => {
    if (event.pointerType !== 'touch') return;
    event.stopPropagation();
    const active = touchDragRef.current; touchDragRef.current = null;
    if (!active) return;
    const cell = document.elementsFromPoint(event.clientX, event.clientY).find(element => element?.dataset?.roomId && element?.dataset?.date);
    if (!cell) return;
    const room = plannerRooms.find(item => item.id === cell.dataset.roomId);
    const reservation = active.reservation;
    if (!room) return;
    const nights = differenceInCalendarDays(parseDate(reservation.checkOut), parseDate(reservation.checkIn));
    const checkIn = cell.dataset.date;
    const checkOut = dateKey(addDays(parseDate(checkIn), Math.max(1, nights)));
    if (room.id === reservation.roomId && checkIn === reservation.checkIn) return;
    if (range && (checkIn < range.from || checkOut > dateKey(addDays(parseDate(range.to), 1)))) { toast.error('Cannot move reservation outside the selected date range.'); return; }
    const overlap = checkOverlap(normalizedReservations, room.id, checkIn, checkOut, reservation.id);
    if (overlap) { toast.error(`Cannot move: Room ${room.number || room.id} already booked from ${overlap.checkIn} to ${overlap.checkOut}.`); return; }
    setMoveConfirmation({ reservation, target: { roomId: room.id, checkIn, checkOut }, nights });
  };
  const beginResize = (event, reservation, edge = 'end') => {
    event.stopPropagation(); event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeStartRef.current = { reservation, startX: event.clientX, edge };
  };
  const finishResize = async (event) => {
    event.stopPropagation();
    const active = resizeStartRef.current;
    resizeStartRef.current = null;
    if (!active) return;
    const delta = Math.round((event.clientX - active.startX) / dayWidth);
    if (!delta) return;
    const { reservation } = active;
    const nextCheckIn = active.edge === 'start' ? dateKey(addDays(parseDate(reservation.checkIn), delta)) : reservation.checkIn;
    const nextCheckOut = active.edge === 'end' ? dateKey(addDays(parseDate(reservation.checkOut), delta)) : reservation.checkOut;
    if (nextCheckOut <= nextCheckIn) { toast.error('A reservation must be at least one night.'); return; }
    if (range && (nextCheckOut > dateKey(addDays(parseDate(range.to), 1)) || nextCheckIn < range.from)) { toast.error('Resize must stay within the selected date range.'); return; }
    const conflict = checkOverlap(normalizedReservations, reservation.roomId, nextCheckIn, nextCheckOut, reservation.id);
    if (conflict) { toast.error(`Cannot resize: the room is already booked from ${conflict.checkIn} to ${conflict.checkOut}.`); return; }
    try {
      const target = { roomId: reservation.roomId, checkIn: nextCheckIn, checkOut: nextCheckOut };
      await pmsService.movePlannerReservation({ reservationId: reservation.id, ...target });
      recordPlannerMove(reservation, target);
      toast.success(`Reservation dates updated to ${nextCheckIn} – ${nextCheckOut}.`); onRefresh?.();
    } catch (error) { toast.error(error.message || 'Could not resize reservation.'); onRefresh?.(); }
  };
  const handleCellDrop = (e, room, day) => {
    e.preventDefault(); if (!drag) return;
    const r = drag.reservation; const nights = differenceInCalendarDays(parseDate(r.checkOut), parseDate(r.checkIn)); const newCheckIn = dateKey(day); const newCheckOut = dateKey(addDays(day, Math.max(1, nights)));
    if (range && (newCheckIn < range.from || newCheckOut > dateKey(addDays(parseDate(range.to), 1)))) { toast.error('Cannot move reservation outside the selected date range.'); setDrag(null); setDragTarget(null); return; }
    const overlap = checkOverlap(normalizedReservations, room.id, newCheckIn, newCheckOut, r.id);
    if (overlap) { const targetRoom = plannerRooms.find(x => x.id === room.id); toast.error(`Cannot move: Room ${targetRoom?.number || room.id} already booked from ${overlap.checkIn}–${overlap.checkOut} by ${overlap.guestName}`); setDrag(null); setDragTarget(null); return; }
    suppressCellClick.current = true; setMoveConfirmation({ reservation: r, target: { roomId: room.id, checkIn: newCheckIn, checkOut: newCheckOut }, nights }); setDrag(null); setDragTarget(null); setTimeout(() => { suppressCellClick.current = false; }, 0);
  };
  const confirmMove = async (moveGroup = false) => {
    const { reservation, target } = moveConfirmation;
    if (moveGroup && reservation.groupId) { setGroupMoveConfirmation({ reservation, target }); setMoveConfirmation(null); return; }
    try { await pmsService.movePlannerReservation({ reservationId: reservation.id, roomId: target.roomId, checkIn: target.checkIn, checkOut: target.checkOut }); recordPlannerMove(reservation, target); toast.success('Reservation moved'); setMoveConfirmation(null); onRefresh?.(); } catch (e) { toast.error(e.message); setMoveConfirmation(null); onRefresh?.(); }
  };
  const performGroupMove = async (all) => { const { reservation, target } = groupMoveConfirmation; try { if (!all) { await pmsService.movePlannerReservation({ reservationId: reservation.id, roomId: target.roomId, checkIn: target.checkIn, checkOut: target.checkOut }); recordPlannerMove(reservation, target); } else await pmsService.moveReservationGroup({ groupId: reservation.groupId, movedReservationId: reservation.id, roomId: target.roomId, checkIn: target.checkIn, checkOut: target.checkOut }); toast.success('Reservation moved'); setGroupMoveConfirmation(null); onRefresh?.(); } catch (e) { toast.error(e.message); setGroupMoveConfirmation(null); onRefresh?.(); } };

  const applyViewLength = (days) => {
    const count = Number(days);
    const start = range?.from || dateKey(columns[0] || todayDate);
    const nextEnd = dateKey(addDays(parseDate(start), count - 1));
    setViewLength(String(count));
    setFromInput(start); setToInput(nextEnd); setRange({ from: start, to: nextEnd });
    setRangeError(''); setFocusToday(false); setViewMode('rolling');
  };

  const applyRange = (from = fromInput, to = toInput) => {
    setRangeError('');
    if (!from || !to) { setRangeError('Select both start and end dates.'); return; }
    if (to < from) { setRangeError('End date must be on or after start date.'); return; }
    const days = differenceInCalendarDays(parseDate(to), parseDate(from)) + 1;
    if (days > 31) { setRangeError('Maximum visible range is 31 days.'); return; }
    if (days < 1) { setRangeError('Minimum range is 1 day.'); return; }
    setRange({ from, to }); setFocusToday(false); setViewMode('rolling');
  };
  const updateRangeDate = (field, value) => {
    const nextFrom = field === 'from' ? value : fromInput;
    const nextTo = field === 'to' ? value : toInput;
    if (field === 'from') setFromInput(value); else setToInput(value);
    if (nextFrom && nextTo && nextTo >= nextFrom) applyRange(nextFrom, nextTo);
    else if (nextFrom && nextTo) setRangeError('End date must be on or after start date.');
  };
  const shiftVisibleRange = (delta) => {
    const from = range?.from || dateKey(columns[0] || todayDate);
    const to = range?.to || dateKey(columns[columns.length - 1] || todayDate);
    const nextFrom = dateKey(addDays(parseDate(from), delta));
    const nextTo = dateKey(addDays(parseDate(to), delta));
    setFromInput(nextFrom); setToInput(nextTo); setRange({ from: nextFrom, to: nextTo });
    setRangeError(''); setFocusToday(false); setViewMode('rolling');
  };
  const addClosure = () => {
    if (!plannerRooms.length || !propertyId) return;
    const start = addDays(todayDate, 2);
    setClosureForm({ roomId: plannerRooms[0].id, startDate: dateKey(start), endDate: dateKey(addDays(start, 2)), reason: 'Out of order' });
    setClosureModal(true);
  };
  const saveClosure = async () => {
    if (!closureForm.roomId || !closureForm.startDate || !closureForm.endDate || closureForm.endDate <= closureForm.startDate || !closureForm.reason.trim()) {
      toast.error('Choose a room, a valid date range and a reason.'); return;
    }
    setClosureSaving(true);
    try {
      const created = await pmsService.createRoomClosure({ property_id: propertyId, room_id: closureForm.roomId, start_date: closureForm.startDate, end_date: closureForm.endDate, reason: closureForm.reason.trim() });
      setClosures(current => [...current, created].sort((a, b) => String(a.start_date).localeCompare(String(b.start_date))));
      setClosureModal(false);
      toast.success('Room closure saved. New reservations in this period will be blocked.');
    } catch (error) { toast.error(error.message || 'Could not save room closure.'); }
    finally { setClosureSaving(false); }
  };
  const deleteClosure = async (closure) => {
    if (!confirm(`Remove the closure for Room ${plannerRooms.find(room => room.id === closure.room_id)?.number || ''} (${closure.start_date} to ${closure.end_date})?`)) return;
    try {
      await pmsService.deleteRoomClosure(closure.id);
      setClosures(current => current.filter(item => item.id !== closure.id));
      toast.success('Room closure removed.');
    } catch (error) { toast.error(error.message || 'Could not remove room closure.'); }
  };
  const clearRange = () => { setRange(null); setRangeError(''); setFromInput(''); setToInput(''); setMonth(startOfMonth(todayDate)); setWindowStart(todayDate); setFocusToday(true); };
  const goToday = () => {
    const { from, to } = getRollingPlannerRange(todayDate);
    setRange({ from, to }); setFromInput(from); setToInput(to); setMonth(startOfMonth(todayDate));
    setWindowStart(subDays(todayDate, 2)); setViewMode('rolling'); setRangeError(''); setFocusToday(true);
  };
  const shiftMonth = (delta) => { setRange(null); setFromInput(''); setToInput(''); setFocusToday(false); setMonth((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1)); };
  const shiftWindow = (delta) => { setRange(null); setFromInput(''); setToInput(''); setFocusToday(false); setWindowStart((d) => addDays(parseDate(dateKey(d)), delta)); };
  const switchView = (mode) => { setViewMode(mode); setRange(null); setFromInput(''); setToInput(''); setFocusToday(mode === 'month'); if (mode === 'rolling') setWindowStart(todayDate); else setMonth(startOfMonth(todayDate)); };

  const visibleReservation = (rv) => {
    const arrival = parseDate(rv.checkIn), departure = parseDate(rv.checkOut); if (!arrival || !departure) return null;
    const viewStart = columns[0], viewEndExclusive = addDays(columns[columns.length - 1], 1);
    if (departure <= viewStart || arrival >= viewEndExclusive) return null;
    const clippedStart = arrival < viewStart ? viewStart : arrival;
    const clippedEnd = departure > viewEndExclusive ? viewEndExclusive : departure;
    return { start: differenceInCalendarDays(clippedStart, viewStart), span: Math.max(1, differenceInCalendarDays(clippedEnd, clippedStart)), continuesBefore: arrival < viewStart, continuesAfter: departure > viewEndExclusive };
  };

  const showReservationHover = (event, reservation) => {
    if (typeof window === 'undefined') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const cardWidth = Math.min(310, window.innerWidth - 16);
    const estimatedHeight = 230;
    setHoverCard({
      reservation,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - cardWidth - 8)),
      top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - estimatedHeight - 8)),
    });
  };
  const hideReservationHover = (event) => {
    if (event.relatedTarget?.closest?.('[data-room-planner-hover-card]')) return;
    setHoverCard(null);
  };
  const leaveReservationHoverCard = (event) => {
    if (event.relatedTarget?.closest?.('[data-room-planner-bar]')) return;
    setHoverCard(null);
  };

  const openFolio = (rv) => {
    if (rv.groupId) { setActionModal({ type: 'groupFolioChoice', reservation: rv }); return; }
    setActionModal({ type: 'folio', reservation: rv });
  };
  const openRoomFolio = (rv, entireGroup = false) => {
    if (entireGroup && rv.groupId) { setActionModal(null); setFolio({ reservation: rv, group: normalizedReservations.filter(x => x.groupId === rv.groupId) }); setActionModal({ type: 'groupFolio', reservation: rv }); return; }
    setActionModal({ type: 'folio', reservation: rv });
  };
  const submitCharge = async () => { const rv = actionModal.reservation; const amount = Number(chargeAmount); if (!(amount > 0)) { toast.error('Enter a charge amount greater than 0.'); return; } try { await pmsService.chargeToRoom({ propertyId, reservationId: rv.id, description: chargeDescription || 'Room charge', amount }); toast.success(`KES ${amount.toLocaleString()} posted to Room ${rv.roomNumber || plannerRooms.find(x => x.id === rv.roomId)?.number}`); setActionModal(null); } catch (e) { toast.error(e.message); } };

  const propertyName = user?.property?.business_name || user?.property?.name || 'OliTechs';
  const generatedBy = user?.full_name || user?.name || user?.email || 'Authorized staff';
  const roomPlannerDefinition = useMemo(() => buildRoomPlannerDefinition({ rooms: plannerRooms, reservations: normalizedReservations, columns, propertyName, generatedBy }), [plannerRooms, normalizedReservations, columns, propertyName, generatedBy]);

  return <div className="room-planner flex flex-col h-full min-h-0" style={{ background: SAND }}>
    <style>{`.room-planner-scroll { overscroll-behavior: contain; scrollbar-gutter: stable; } .room-planner-scroll:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; } .room-planner-room-cell { position: sticky; left: 0; isolation: isolate; background-clip: padding-box; } .room-planner-toolbar-top,.room-planner-toolbar-date-row{flex-wrap:wrap;min-width:0} .room-planner-toolbar-date-row>*{width:auto!important;flex:1 1 150px;min-width:0} .room-planner-month-select{flex:1 1 180px} .room-planner-toolbar{max-width:100%;min-width:0} .room-planner-toolbar-button{white-space:normal;text-align:center} .room-planner-scroll{max-width:100%;}
    /* Do not put overflow:hidden between the timeline scrollport and sticky cells: it clips the pinned room rail. */
    .room-planner-grid-frame { position: relative; overflow: visible; border-radius: 12px; }
    .room-planner-scroll { position: relative; min-width: 0; }
    .room-planner-room-cell { box-shadow: 5px 0 8px -6px color-mix(in srgb,var(--deep-lagoon) 34%,transparent); }
    .room-planner-room-cell::after { content: ''; position: absolute; top: 0; right: -1px; bottom: 0; width: 1px; background: var(--border); pointer-events: none; } .room-planner-date-cell { scroll-margin-left: 2px; transition: background-color 120ms ease; } .room-planner-date-cell:hover { filter: brightness(.97); } .room-planner-date-cell.room-planner-today { box-shadow: inset 0 -3px 0 var(--primary); }  .room-planner-day-cell { transition: background-color 100ms ease; } .room-planner-day-cell:hover { background-color: color-mix(in srgb, var(--primary) 9%, var(--surface)); } .room-planner-day-cell.room-planner-weekend { background-color: color-mix(in srgb, var(--grid-weekend) 78%, var(--surface)); } .room-planner-day-cell.room-planner-today-cell { box-shadow: inset 1px 0 0 color-mix(in srgb, var(--primary) 40%, transparent), inset -1px 0 0 color-mix(in srgb, var(--primary) 40%, transparent); } .reservation-bar { display:flex; align-items:center; padding:0 10px; font-size:11px; font-weight:700; border-radius:0; clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-height:23px; box-shadow:0 2px 4px color-mix(in srgb,var(--deep-lagoon) 14%,transparent); transition:box-shadow 120ms ease,filter 120ms ease; } .reservation-bar:hover { box-shadow: 0 4px 9px color-mix(in srgb,var(--deep-lagoon) 20%,transparent); filter: saturate(1.04); z-index:80 !important; overflow:visible; } .reservation-hover-card{cursor:default;pointer-events:auto}.reservation-hover-card .reservation-hover-title{font-size:13px;font-weight:700;color:var(--text);margin-bottom:3px}.reservation-hover-card .reservation-hover-line{display:flex;align-items:center;gap:5px;min-width:0;margin-top:4px}.reservation-hover-card .reservation-hover-muted{color:var(--muted)}.reservation-hover-card .reservation-hover-pill{display:inline-flex;align-items:center;border-radius:999px;padding:1px 7px;background:var(--surface-2);color:var(--text);font-size:10px;font-weight:600;white-space:nowrap}.reservation-hover-card .reservation-hover-folio{display:inline-flex;align-items:center;justify-content:center;gap:6px;margin-top:9px;padding:6px 11px;border-radius:7px;background:var(--primary);color:var(--on-primary);font-size:11px;font-weight:700;cursor:pointer}.reservation-hover-card .reservation-hover-folio:hover{filter:brightness(.96)}  .room-planner-grid-row { min-height: 30px; } @media (prefers-reduced-motion: reduce) { .room-planner-date-cell, .room-planner-day-cell, .reservation-bar { transition: none; } }
    .room-planner-toolbar{background:var(--cal-page);padding:6px 7px 8px;display:flex;flex-direction:column;gap:12px}
    .room-planner-toolbar-top,.room-planner-toolbar-date-row{display:flex;align-items:center;gap:6px;min-width:0}
     .room-planner-toolbar-top{min-height:38px;flex-wrap:wrap}
     .room-planner-toolbar-button{height:44px;min-height:44px;max-width:100%;min-width:44px;flex:1 1 auto;border-radius:3px;padding:0 10px;display:inline-flex;align-items:center;justify-content:center;gap:7px;font-size:16px;font-weight:500;line-height:1;white-space:nowrap}
    .room-planner-neutral{background:var(--btn-neutral-bg);color:var(--btn-neutral-fg);border:1px solid var(--btn-neutral-bd)}
    .room-planner-danger{background:var(--btn-danger-bg);color:var(--btn-danger-fg);border:1px solid var(--btn-danger-bg)}
    .room-planner-today{background:var(--btn-today-bg);color:var(--btn-today-fg);border:1px solid var(--btn-today-bg)}
    .room-planner-action{background:var(--btn-action-bg);color:var(--btn-action-fg);border:1px solid var(--btn-action-bg)}
    .room-planner-primary{background:var(--primary);color:var(--on-primary);border:1px solid var(--primary);padding:0 16px}
     .room-planner-date-input{height:44px;min-height:44px;flex:1 1 180px;width:auto!important;min-width:0;display:flex;align-items:center;gap:8px;padding:0 10px;background:var(--btn-neutral-bg);color:var(--btn-neutral-fg);border:1px solid var(--btn-neutral-bd);border-radius:3px}
    .room-planner-date-input input{min-width:0;width:100%;height:34px;background:transparent;border:0;outline:0;color:var(--btn-neutral-fg);font-size:16px;font-family:inherit}
    .room-planner-month-select{font-family:inherit;font-weight:500}
    .room-planner-settings-panel{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;color:var(--cal-text);font-size:13px}
     .room-planner-filter-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
    .room-planner-search{height:36px;min-width:230px;flex:1 1 250px;display:flex;align-items:center;gap:8px;padding:0 10px;border:1px solid var(--btn-neutral-bd);border-radius:6px;background:var(--surface);color:var(--muted)}
    .room-planner-search input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:var(--text);font:inherit;font-size:13px}
     .room-planner-filter{height:44px;min-height:44px;min-width:0;max-width:none;flex:1 1 150px;padding:0 9px;border:1px solid var(--btn-neutral-bd);border-radius:6px;background:var(--surface);color:var(--text);font-size:12px}
    .room-planner-filter-count{margin-left:auto;color:var(--muted);font-size:11px;font-weight:600}
    .room-planner-detail{position:absolute;right:16px;top:16px;bottom:16px;z-index:80;width:min(420px,calc(100vw - 32px));overflow:auto;border:1px solid var(--border);border-radius:14px;background:var(--surface);box-shadow:0 18px 50px color-mix(in srgb,var(--deep-lagoon) 22%,transparent)}
    .room-planner-detail-action{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--border);border-radius:8px;padding:9px 11px;font-size:12px;font-weight:600;color:var(--text);background:var(--surface)}
    @media(max-width:600px){.room-planner-filter-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.room-planner-search{grid-column:span 2;min-width:0}.room-planner-filter{width:100%;max-width:none}.room-planner-filter-count{grid-column:span 2;margin-left:0}}
    .room-planner-filter-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .room-planner-search{height:36px;min-width:230px;flex:1 1 250px;display:flex;align-items:center;gap:8px;padding:0 10px;border:1px solid var(--btn-neutral-bd);border-radius:6px;background:var(--surface);color:var(--muted)}
    .room-planner-search input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:var(--text);font:inherit;font-size:13px}
    .room-planner-filter{height:36px;min-width:145px;max-width:220px;padding:0 9px;border:1px solid var(--btn-neutral-bd);border-radius:6px;background:var(--surface);color:var(--text);font-size:12px}
    .room-planner-filter-count{margin-left:auto;color:var(--muted);font-size:11px;font-weight:600}
    .room-planner-detail{position:absolute;right:16px;top:16px;bottom:16px;z-index:80;width:min(420px,calc(100vw - 32px));overflow:auto;border:1px solid var(--border);border-radius:14px;background:var(--surface);box-shadow:0 18px 50px color-mix(in srgb,var(--deep-lagoon) 22%,transparent)}
    .room-planner-detail-action{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--border);border-radius:8px;padding:9px 11px;font-size:12px;font-weight:600;color:var(--text);background:var(--surface)}
    @media(max-width:600px){.room-planner-filter-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.room-planner-search{grid-column:span 2;min-width:0}.room-planner-filter{width:100%;max-width:none}.room-planner-filter-count{grid-column:span 2;margin-left:0}}
    @media(max-width:1099px){.room-planner-toolbar-date-row{flex-wrap:wrap}.room-planner-toolbar-date-row>*{flex:0 0 auto}}
    @media(max-width:600px){.room-planner-toolbar-date-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.room-planner-toolbar-date-row>*{width:100%!important;min-width:0}.room-planner-date-input{width:100%!important}.room-planner-month-select{grid-column:span 2}.room-planner-toolbar-top>*{flex:1 1 0}.room-planner-toolbar-button{font-size:14px}}
    /* Redesign: compact toolbar, segmented controls, quiet actions. Tokens only. */
    .room-planner .room-planner-toolbar{padding:10px 16px 8px;gap:8px;background:var(--cal-page)}
    .room-planner .room-planner-toolbar-main{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px}
    .room-planner .room-planner-toolbar-group{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
    .room-planner .room-planner-toolbar-end{margin-left:auto}
    .room-planner .room-planner-toolbar-button{height:38px;min-height:38px;flex:0 0 auto;border-radius:8px;padding:0 12px;font-size:13px;font-weight:600;transition:transform 120ms ease-out,background-color 120ms ease-out,border-color 120ms ease-out}
    .room-planner .room-planner-toolbar-button:active,.room-planner .room-planner-segment:active{transform:scale(.97)}
    .room-planner .room-planner-toolbar-button:focus-visible,.room-planner .room-planner-segment:focus-visible,.room-planner .room-planner-filter:focus-visible,.room-planner .room-planner-search:focus-within,.room-planner .room-planner-date-input:focus-within{outline:2px solid var(--primary);outline-offset:2px}
    .room-planner .room-planner-square{width:38px;padding:0}
    .room-planner .room-planner-pair{display:inline-flex;gap:2px}
    .room-planner .room-planner-neutral:hover{border-color:var(--primary)}
    .room-planner .room-planner-primary{box-shadow:0 1px 2px color-mix(in srgb,var(--deep-lagoon) 18%,transparent)}
    .room-planner .room-planner-date-input{height:38px;min-height:38px;flex:0 0 auto;width:148px!important;padding:0 8px;border-radius:8px;gap:6px}
    .room-planner .room-planner-date-input input{font-size:13px;font-variant-numeric:tabular-nums}
    .room-planner .room-planner-range-arrow{color:var(--text-muted);font-size:13px}
    .room-planner .room-planner-month-select{width:auto;min-width:150px;padding:0 8px}
    .room-planner .room-planner-segmented{display:inline-flex;gap:2px;padding:3px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}
    .room-planner .room-planner-segment{height:30px;padding:0 12px;border-radius:7px;font-size:12px;font-weight:600;color:var(--text);transition:transform 120ms ease-out,background-color 120ms ease-out}
    .room-planner .room-planner-segment:hover{background:var(--cal-group)}
    .room-planner .room-planner-segment[aria-pressed="true"]{background:var(--primary);color:var(--on-primary)}
    .room-planner .room-planner-filter-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
    .room-planner .room-planner-search{height:38px;flex:0 1 300px;min-width:200px;border-radius:8px}
    .room-planner .room-planner-filter-badge{min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--primary);color:var(--on-primary);font-size:11px;line-height:18px;text-align:center}
    .room-planner .room-planner-chip{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 4px 0 10px;border:1px solid var(--border);border-radius:999px;background:var(--surface);font-size:12px;font-weight:600;color:var(--text)}
    .room-planner .room-planner-chip button{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:999px;color:var(--text-muted)}
    .room-planner .room-planner-chip button:hover{background:var(--cal-group);color:var(--text)}
    .room-planner .room-planner-clear{font-size:12px;font-weight:600;color:var(--primary);padding:4px 6px;border-radius:6px}
    .room-planner .room-planner-clear:hover{background:var(--cal-group)}
    .room-planner .room-planner-legend{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin-left:auto}
    .room-planner .room-planner-legend-key{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--text)}
    .room-planner .room-planner-legend-key i{display:inline-block;width:14px;height:10px;border-radius:3px}
    .room-planner .room-planner-filter-count{margin-left:0;font-size:12px;font-variant-numeric:tabular-nums}
    .room-planner .room-planner-filter-panel{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;padding:10px;border:1px solid var(--border);border-radius:12px;background:var(--surface);box-shadow:var(--shadow-overlay)}
    .room-planner .room-planner-filter-panel .room-planner-filter{height:38px;min-height:38px;max-width:none;border-radius:8px;font-size:13px}
    .room-planner .reservation-bar{border-radius:6px;clip-path:none;box-shadow:0 1px 1px color-mix(in srgb,var(--deep-lagoon) 14%,transparent)}
    .room-planner .room-planner-handle{opacity:0;transition:opacity 120ms ease-out}
    .room-planner .reservation-bar:hover .room-planner-handle,.room-planner .room-planner-handle:focus-visible{opacity:1}
    @media (pointer:coarse),(max-width:900px){.room-planner .room-planner-toolbar-button,.room-planner .room-planner-date-input,.room-planner .room-planner-search,.room-planner .room-planner-filter-panel .room-planner-filter{height:44px;min-height:44px}.room-planner .room-planner-square{width:44px}.room-planner .room-planner-segment{height:36px}.room-planner .room-planner-handle{opacity:1}}
    @media (max-width:900px){.room-planner .room-planner-toolbar-end{margin-left:0}.room-planner .room-planner-legend{margin-left:0;width:100%}}
    @media (prefers-reduced-motion:reduce){.room-planner *{transition:none!important}}

    /* Second pass: modals, detail drawer, motion. Tokens only. */
    @keyframes rp-modal-in{from{opacity:0;transform:scale(.98) translateY(4px)}to{opacity:1;transform:none}}
    @keyframes rp-drawer-in{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:none}}
    @keyframes rp-fade-in{from{opacity:0}to{opacity:1}}
    .room-planner .room-planner-modal-backdrop{animation:rp-fade-in 140ms ease-out}
    .room-planner .room-planner-modal{box-shadow:var(--shadow-overlay);border:1px solid var(--border);animation:rp-modal-in 180ms cubic-bezier(.23,1,.32,1)}
    .room-planner .room-planner-icon-close{transition:background-color 120ms ease-out,transform 120ms ease-out}
    .room-planner .room-planner-icon-close:hover{background:var(--cal-group);color:var(--text)}
    .room-planner .room-planner-icon-close:active{transform:scale(.94)}
    .room-planner .room-planner-icon-close:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
    .room-planner .room-planner-input:focus-visible{outline:2px solid var(--primary);outline-offset:1px;border-color:var(--primary)!important}
    .room-planner .room-planner-detail{border-radius:16px;animation:rp-drawer-in 200ms cubic-bezier(.23,1,.32,1)}
    .room-planner .room-planner-tile{padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}
    .room-planner .room-planner-tile>b{display:block;margin-top:2px;font-size:14px;font-weight:600;color:var(--text);font-variant-numeric:tabular-nums}
    .room-planner .room-planner-tile-label{font-size:11px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:var(--muted)}
    .room-planner .room-planner-detail-action{min-height:40px;justify-content:center;border-radius:10px;transition:transform 120ms ease-out,background-color 120ms ease-out,border-color 120ms ease-out}
    .room-planner .room-planner-detail-action:hover{border-color:var(--primary);background:var(--cal-group)}
    .room-planner .room-planner-detail-action:active{transform:scale(.97)}
    .room-planner .room-planner-detail-action:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
    .room-planner .room-planner-detail-primary{grid-column:1/-1;min-height:44px;background:var(--primary);color:var(--on-primary);border-color:var(--primary);font-size:13px}
    .room-planner .room-planner-detail-primary:hover{background:var(--primary-hover);border-color:var(--primary-hover)}
    @media (max-width:600px){.room-planner .room-planner-detail{left:8px;right:8px;top:8px;bottom:8px;width:auto}}
    @media (prefers-reduced-motion:reduce){.room-planner .room-planner-modal,.room-planner .room-planner-modal-backdrop,.room-planner .room-planner-detail{animation:none}}
`}
</style>
    <div className="room-planner-toolbar shrink-0">
      <div className="room-planner-toolbar-main">
        <div className="room-planner-toolbar-group">
          <button onClick={goToday} className="room-planner-toolbar-button room-planner-today">Today</button>
          <div role="group" aria-label="Shift visible dates" className="room-planner-pair">
            <button type="button" aria-label={`Previous ${viewLength} days`} title={`Previous ${viewLength} days`} onClick={()=>shiftVisibleRange(-(Number(viewLength)||15))} className="room-planner-toolbar-button room-planner-neutral room-planner-square"><ChevronLeft size={16}/></button>
            <button type="button" aria-label={`Next ${viewLength} days`} title={`Next ${viewLength} days`} onClick={()=>shiftVisibleRange(Number(viewLength)||15)} className="room-planner-toolbar-button room-planner-neutral room-planner-square"><ChevronRight size={16}/></button>
          </div>
          <label className="room-planner-date-input">
            <CalendarDays size={16} aria-hidden="true"/>
            <input lang="en-GB" type="date" aria-label="Start date" value={fromInput} onChange={e=>updateRangeDate('from',e.target.value)}/>
          </label>
          <span aria-hidden="true" className="room-planner-range-arrow">→</span>
          <label className="room-planner-date-input">
            <CalendarDays size={16} aria-hidden="true"/>
            <input lang="en-GB" type="date" aria-label="End date" value={toInput} onChange={e=>updateRangeDate('to',e.target.value)}/>
          </label>
          <select aria-label="Select month" value={format(month,'yyyy-MM')} onChange={e=>{const [year,mo]=e.target.value.split('-').map(Number);setRange(null);setFromInput('');setToInput('');setRangeError('');setFocusToday(false);setViewMode('month');setMonth(new Date(year,mo-1,1));}} className="room-planner-toolbar-button room-planner-neutral room-planner-month-select">
            {Array.from({length:25},(_,i)=>{const d=new Date(todayDate.getFullYear(),todayDate.getMonth()-12+i,1);return <option key={format(d,'yyyy-MM')} value={format(d,'yyyy-MM')}>{format(d,'MMMM yyyy')}</option>})}
          </select>
          <div role="group" aria-label="View length" className="room-planner-segmented">
            {['7','15','30'].map(days=><button key={days} type="button" aria-pressed={viewLength===days} onClick={()=>applyViewLength(days)} className="room-planner-segment">{days}d</button>)}
          </div>
        </div>
        <div className="room-planner-toolbar-group room-planner-toolbar-end">
          <div role="group" aria-label="Planner view" className="room-planner-segmented">
            <button type="button" aria-pressed={!mobileListMode&&!reservationListMode} onClick={()=>{setMobileListMode(false);setReservationListMode(false);}} className="room-planner-segment">Planner</button>
            <button type="button" aria-pressed={reservationListMode} onClick={()=>{setMobileListMode(false);setReservationListMode(true);}} className="room-planner-segment">List</button>
            <button type="button" aria-pressed={mobileListMode} onClick={()=>{setReservationListMode(false);setMobileListMode(true);}} className="room-planner-segment">Day list</button>
          </div>
          <button title="Export calendar" aria-label="Export calendar" onClick={()=>setExportPreview(true)} className="room-planner-toolbar-button room-planner-neutral room-planner-square"><FileDown size={17}/></button>
          <button title="Planner settings and date range" aria-label="Planner settings and date range" aria-expanded={plannerToolsOpen} onClick={()=>setPlannerToolsOpen(v=>!v)} className="room-planner-toolbar-button room-planner-neutral room-planner-square"><Settings2 size={17}/></button>
          <button onClick={addClosure} className="room-planner-toolbar-button room-planner-neutral"><Ban size={16}/><span>Add Closures</span></button>
          <button onClick={() => openCreate(plannerRooms[0], range ? parseDate(range.from) : todayDate)} className="room-planner-toolbar-button room-planner-primary"><Plus size={16}/><span>New reservation</span></button>
        </div>
      </div>
      {(() => {
        const paymentLabels={not_paid:'No Amount Paid',partially_paid:'Partially Paid',fully_paid:'Total Paid'};
        const sourceLabels={direct:'Direct',booking_com:'Booking.com',unknown:'Other / Unknown'};
        const activeFilters=[
          paymentFilter!=='all'&&{key:'pay',label:paymentLabels[paymentFilter]||paymentFilter,clear:()=>setPaymentFilter('all')},
          sourceFilter!=='all'&&{key:'src',label:sourceLabels[sourceFilter]||sourceFilter,clear:()=>setSourceFilter('all')},
          roomTypeFilter!=='all'&&{key:'type',label:roomTypeFilter,clear:()=>setRoomTypeFilter('all')},
          floorFilter!=='all'&&{key:'floor',label:floorFilter==='Unassigned'?floorFilter:`Floor ${floorFilter}`,clear:()=>setFloorFilter('all')},
          tagFilter!=='all'&&{key:'tag',label:tagFilter,clear:()=>setTagFilter('all')},
        ].filter(Boolean);
        const clearAll=()=>{setSearchQuery('');setPaymentFilter('all');setSourceFilter('all');setRoomTypeFilter('all');setFloorFilter('all');setTagFilter('all');};
        return <>
          <div className="room-planner-filter-row">
            <label className="room-planner-search"><Search size={15}/><input aria-label="Search guest, reservation number or room" placeholder="Search guest, reservation no. or room" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}/></label>
            <button type="button" aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(v=>!v)} className="room-planner-toolbar-button room-planner-neutral"><SlidersHorizontal size={15}/><span>Filters</span>{activeFilters.length>0&&<span className="room-planner-filter-badge">{activeFilters.length}</span>}</button>
            {activeFilters.map(chip=><span key={chip.key} className="room-planner-chip">{chip.label}<button type="button" aria-label={`Remove filter ${chip.label}`} onClick={chip.clear}><X size={12}/></button></span>)}
            {(activeFilters.length>0||searchQuery)&&<button type="button" onClick={clearAll} className="room-planner-clear">Clear filters</button>}
            <div className="room-planner-legend" aria-label="Payment status legend">
              <span className="room-planner-legend-key"><i style={{background:'var(--pay-none)'}}/>No amount paid</span>
              <span className="room-planner-legend-key"><i style={{background:'var(--pay-part)'}}/>Partially paid</span>
              <span className="room-planner-legend-key"><i style={{background:'var(--pay-paid)'}}/>Total paid</span>
              <span className="room-planner-legend-key"><i style={{background:'var(--pay-opt)',border:'1px dashed var(--pay-opt-bd)'}}/>Optioned</span>
            </div>
            <span className="room-planner-filter-count">{filteredRooms.length} {filteredRooms.length===1?'room':'rooms'} · {filteredReservations.length} {filteredReservations.length===1?'reservation':'reservations'}</span>
          </div>
          {filtersOpen&&<div className="room-planner-filter-panel">
            <select aria-label="Filter by payment status" value={paymentFilter} onChange={e=>setPaymentFilter(e.target.value)} className="room-planner-filter"><option value="all">All payment statuses</option><option value="not_paid">No Amount Paid</option><option value="partially_paid">Partially Paid</option><option value="fully_paid">Total Paid</option></select>
            <select aria-label="Filter by booking source" value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)} className="room-planner-filter"><option value="all">All sources</option><option value="direct">Direct</option><option value="booking_com">Booking.com</option><option value="unknown">Other / Unknown</option></select>
            <select aria-label="Filter by room type" value={roomTypeFilter} onChange={e=>setRoomTypeFilter(e.target.value)} className="room-planner-filter"><option value="all">All room types</option>{[...new Set(plannerRooms.map(room=>roomTypeMap.get(room.room_type_id)||room.roomTypeName||room.room_type||'Unassigned'))].sort().map(type=><option key={type} value={type}>{type}</option>)}</select>
            <select aria-label="Filter by floor" value={floorFilter} onChange={e=>setFloorFilter(e.target.value)} className="room-planner-filter"><option value="all">All floors</option>{[...new Set(plannerRooms.map(room=>String(room.floor ?? 'Unassigned')))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(floor=><option key={floor} value={floor}>{floor === 'Unassigned' ? floor : `Floor ${floor}`}</option>)}</select>
            <select aria-label="Filter by tag" value={tagFilter} onChange={e=>setTagFilter(e.target.value)} className="room-planner-filter"><option value="all">All tags</option>{[...new Set(normalizedReservations.flatMap(rv => Array.isArray(rv.tags) ? rv.tags.map(tag => typeof tag === 'string' ? tag : tag?.name).filter(Boolean) : rv.tag ? [String(rv.tag)] : []))].sort().map(tag=><option key={tag} value={tag}>{tag}</option>)}</select>
          </div>}
        </>;
      })()}
      {plannerToolsOpen && <div className="room-planner-settings-panel">
        <span>{plannerRooms.length} rooms · {normalizedReservations.length} active stays</span>
        {onRefresh && <button onClick={onRefresh} className="room-planner-toolbar-button room-planner-neutral"><RefreshCw size={15}/>Refresh reservations</button>}
        <button onClick={undoPlannerMove} disabled={!undoStack.length} className="room-planner-toolbar-button room-planner-neutral disabled:opacity-40" title="Undo last planner move (Ctrl+Z)">Undo</button>
        <button onClick={redoPlannerMove} disabled={!redoStack.length} className="room-planner-toolbar-button room-planner-neutral disabled:opacity-40" title="Redo planner move (Ctrl+Shift+Z)">Redo</button>
        <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold" style={{color:'var(--muted)'}}>Room groups</span>{groupedRooms.map(([typeName,group])=>{const collapsed=collapsedRoomTypes.includes(typeName);return <button key={typeName} type="button" onClick={()=>setCollapsedRoomTypes(current=>collapsed?current.filter(item=>item!==typeName):[...current,typeName])} className="room-planner-toolbar-button room-planner-neutral">{collapsed?'Show':'Hide'} {typeName} ({group.length})</button>})}</div>
        <label className="flex items-center gap-2 text-xs" style={{color:'var(--muted)'}}>Density <select aria-label="Room row density" value={density} onChange={e=>setDensity(e.target.value)} className="room-planner-filter"><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="large">Large</option></select></label>
        <label className="flex items-center gap-2 text-xs" style={{color:'var(--muted)'}}>Date format <select aria-label="Date format" value={dateFormat} onChange={e=>setDateFormat(e.target.value)} className="room-planner-filter"><option value="dd/MM/yyyy">DD/MM/YYYY</option><option value="MM/dd/yyyy">MM/DD/YYYY</option></select></label>
        <span className="text-xs" style={{color:'var(--muted)'}}>Shortcuts: T today · Esc close · ←/→ scroll · Ctrl/Cmd+Z undo</span>
        <button onClick={clearRange} className="room-planner-toolbar-button room-planner-neutral">Clear date range</button>
      </div>}
      {rangeError && <div className="mt-2 flex items-center gap-2 text-xs font-semibold" style={{color:'var(--danger-text)'}}><AlertTriangle size={14}/>{rangeError}</div>}
    </div>

    <div ref={scrollRef} onScroll={e=>{setPlannerScrollTop(e.currentTarget.scrollTop);setPlannerViewportHeight(e.currentTarget.clientHeight || 600);setHoverCard(null)}} tabIndex={0} role="region" aria-label="Room availability timeline. Use arrow keys to navigate, T for today and Escape to close details." onKeyDown={e=>{if(['INPUT','SELECT','TEXTAREA'].includes(e.target?.tagName))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)redoPlannerMove();else undoPlannerMove()}else if(e.key.toLowerCase()==='t'){e.preventDefault();goToday()}else if(e.key==='Escape'){setSelectedReservation(null);setModal(null);setActionModal(null)}else if(e.key==='ArrowLeft'){e.preventDefault();scrollRef.current.scrollBy({left:-dayWidth,behavior:'smooth'})}else if(e.key==='ArrowRight'){e.preventDefault();scrollRef.current.scrollBy({left:dayWidth,behavior:'smooth'})}else if(e.key==='ArrowUp'){e.preventDefault();scrollRef.current.scrollBy({top:-54,behavior:'smooth'})}else if(e.key==='ArrowDown'){e.preventDefault();scrollRef.current.scrollBy({top:54,behavior:'smooth'})}}} className="room-planner-scroll flex-1 min-h-0 overflow-auto px-4 pb-4">
      {!mobileListMode && !reservationListMode && <div className="room-planner-grid-frame rounded-xl shadow-sm" style={{background:'var(--surface)',border:`1px solid var(--border)`, minWidth: `${ROOM_COL_WIDTH + columns.length * dayWidth}px`}}>
        <div className="grid sticky top-0 z-40" style={{gridTemplateColumns:`${ROOM_COL_WIDTH}px repeat(${columns.length}, ${dayWidth}px)`,gridTemplateRows:'30px 42px'}}>
          <div className="room-planner-room-cell sticky left-0 z-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide flex items-center" style={{gridRow:'span 2',background:'var(--deep-lagoon)',color:'var(--white)',borderRight:`1px solid var(--border)`,borderBottom:`1px solid var(--border)`}}>Rooms</div>
          {monthSegments.map(segment=><div key={segment.key} className="flex items-center justify-center text-xs font-semibold" style={{gridColumn:`span ${segment.span}`,background:'var(--coastal-teal)',color:'var(--white)',borderRight:`1px solid var(--border)`,borderBottom:`1px solid var(--border)`}}>{segment.label}</div>)}
          {columns.map(d=>{const weekend=d.getDay()===0||d.getDay()===6;const isT=dateKey(d)===today;return <div key={dateKey(d)} ref={isT?todayRef:null} className={`room-planner-date-cell text-center relative ${isT?'room-planner-today':weekend?'room-planner-weekend':''}`} style={{background:isT?'var(--cal-today)':weekend?'var(--cal-weekend)':'var(--soft-white)',color:'var(--text)',borderRight:`1px solid var(--border)`,borderBottom:`1px solid var(--border)`,height:42,fontWeight:isT?800:600}}><div className="text-[10px] uppercase tracking-wide">{format(d,'EEE')}</div><div className="text-sm leading-5 font-semibold">{d.getDate()}</div>{isT&&<span className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 text-[8px] px-2 py-0.5 rounded-full font-semibold" style={{background:'var(--coastal-teal)',color:'var(--white)'}}>TODAY</span>}</div>})}
        </div>

        {topSpacerHeight > 0 && <div aria-hidden="true" style={{height:topSpacerHeight,gridColumn:'1 / -1'}}/>}
        {virtualRows.map((entry)=>{if(entry.kind==='group'){const collapsed=collapsedRoomTypes.includes(entry.typeName);return <div key={`group-${entry.typeName}`} className="room-planner-grid-row grid relative" style={{gridTemplateColumns:`${ROOM_COL_WIDTH}px repeat(${columns.length}, ${dayWidth}px)`,height:ROOM_ROW_HEIGHT,minHeight:ROOM_ROW_HEIGHT}}><div className="room-planner-room-cell sticky left-0 z-20 flex items-center px-3" style={{background:'var(--soft-white)',borderRight:`2px solid var(--border)`,borderBottom:`1px solid var(--border)`}}><button type="button" aria-expanded={!collapsed} onClick={()=>setCollapsedRoomTypes(current=>collapsed?current.filter(item=>item!==entry.typeName):[...current,entry.typeName])} className="flex w-full items-center justify-between gap-2 text-left text-[11px] font-bold" style={{color:'var(--text)',minHeight:ROOM_ROW_HEIGHT===30?24:32}}><span className="truncate">{entry.typeName}</span><span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold tabular-nums" style={{color:'var(--muted)'}}>{entry.count}<ChevronDown size={13} aria-hidden="true" style={{transform:collapsed?'rotate(-90deg)':'none',transition:'transform 160ms ease-out'}}/><span className="sr-only">{collapsed?'Show':'Hide'} {entry.typeName}</span></span></button></div><div className="flex items-center px-3 text-[10px] font-semibold" style={{gridColumn:'2 / -1',background:'var(--soft-white)',color:'var(--muted)',borderBottom:`1px solid var(--border)`}}>{entry.count} {entry.count===1?'room':'rooms'} in this group</div></div>;}const {room,typeName}=entry;const roomReservations=filteredReservationsByRoom.get(room.id)||[]; return <div key={room.id} className="room-planner-grid-row grid relative" style={{gridTemplateColumns:`${ROOM_COL_WIDTH}px repeat(${columns.length}, ${dayWidth}px)`, height:ROOM_ROW_HEIGHT,minHeight:ROOM_ROW_HEIGHT}}>
            <div className="room-planner-room-cell sticky left-0 z-20 px-3 flex items-center gap-2" style={{background:'var(--surface)',borderRight:`2px solid var(--border)`,borderBottom:`1px solid var(--border)`,paddingTop:ROOM_ROW_HEIGHT===30?0:8,paddingBottom:ROOM_ROW_HEIGHT===30?0:8}}><div><div className="flex items-center gap-2"><div className="font-medium text-[13px] leading-3" style={{color:'var(--text)'}}>{room.number}</div>{roomReservations.length>0&&<span className="rounded-full px-1.5 py-0.5 text-[9px] font-medium tabular-nums" style={{background:'var(--bg)',color:'var(--muted)'}}>{roomReservations.length} stay{roomReservations.length===1?'':'s'}</span>}</div><div className="text-[10px] font-semibold leading-3 truncate max-w-[160px]" style={{color:'var(--muted)'}}>{room.name || typeName}</div></div></div>
            {columns.map(d=>{const weekend=d.getDay()===0||d.getDay()===6;const key=dateKey(d);const target=dragTarget?.roomId===room.id&&dragTarget?.date===key;return <div key={key} data-room-id={room.id} data-date={key} onPointerDown={e=>beginCreateDrag(e,room,d)} onPointerUp={finishCreateDrag} onPointerCancel={()=>{createDragRef.current=null}} onClick={()=>{if(!drag&&!suppressCellClick.current)openCreate(room,d)}} onDragOver={e=>handleCellDragOver(e,room,d)} onDrop={e=>handleCellDrop(e,room,d)} className={`room-planner-day-cell cursor-pointer ${weekend?'room-planner-weekend':''} ${key===today?'room-planner-today-cell':''}`} style={{background:target?'color-mix(in srgb, var(--primary) 28%, var(--surface))':closures.some(item => item.room_id === room.id && item.start_date <= key && key < item.end_date) ? 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--stay-closed) 72%, var(--surface)) 0 5px, var(--surface) 5px 10px)' : key===today?'color-mix(in srgb, var(--primary) 9%, var(--surface))':weekend?'color-mix(in srgb, var(--grid-weekend) 78%, var(--surface))':'var(--surface)',borderRight:`1px solid var(--border)`,borderBottom:`1px solid var(--border)`, minHeight:ROOM_ROW_HEIGHT}} title={closures.filter(item => item.room_id === room.id && item.start_date <= key && key < item.end_date).map(item => `${item.reason} · ${item.start_date} to ${item.end_date}`).join(' | ') || undefined}/>})}
            {roomReservations.filter(rv=>filteredReservations.some(item=>item.id===rv.id)).map(rv=>{
              const l=visibleReservation(rv);if(!l)return null;
              const stayStatus=rv.plannerStatus || (rv.bookingStatus==='checked_out'?'checked_out':rv.bookingStatus==='checked_in'?'occupied':'confirmed');
              const ps=getReservationBarStyle(stayStatus); const pay=getPaymentStyle(getPaymentStatusFromAmounts(rv.amountPaid, rv.totalAmount));
              const checked=rv.bookingStatus==='checked_out';
              const geometry=getStayBarGeometry({startIndex:l.start,span:l.span,dayWidth,roomColumnWidth:ROOM_COL_WIDTH,continuesBefore:l.continuesBefore,continuesAfter:l.continuesAfter});
              const left=geometry.left;
              const width=geometry.width;
              const pastOpacity=getBarOpacity(rv.bookingStatus,rv.checkOut,today);
              const firstTag = Array.isArray(rv.tags) ? rv.tags[0] : rv.tag;
              const tagName = typeof firstTag === 'string' ? firstTag : firstTag?.name;
              const tagColor = typeof firstTag === 'object' ? firstTag?.color : null;
              return <div key={rv.id} draggable onPointerDown={e=>beginTouchDrag(e,rv)} onPointerUp={finishTouchDrag} onPointerCancel={()=>{touchDragRef.current=null}} onDragStart={e=>beginDrag(e,rv)} onDragEnd={()=>{setDrag(null);setDragTarget(null)}} onClick={e=>{e.stopPropagation();setSelectedReservation(rv)}} className="reservation-bar absolute h-[23px] cursor-grab active:cursor-grabbing group" data-room-planner-bar="true" onMouseEnter={e=>showReservationHover(e,rv)} onMouseLeave={hideReservationHover} style={{top:Math.max(2,(ROOM_ROW_HEIGHT-23)/2),left,width,background:stayStatus==='optioned'?'var(--pay-opt)':pastOpacity<1?`color-mix(in srgb, ${pay.background} 55%, transparent)`:pay.background,color:stayStatus==='optioned'?'var(--pay-opt-fg)':pay.color,border:`1.5px ${stayStatus==='optioned'?'dashed':'solid'} ${stayStatus==='optioned'?'var(--pay-opt-bd)':pay.border}`,borderLeft:stayStatus==='optioned'?'1.5px dashed var(--pay-opt-bd)':`1.5px solid ${pay.border}`,zIndex:10}} aria-label={`Reservation ${getPlannerReservationNumber(rv)} for ${rv.guestName || 'Guest'}`}>
              {tagName && <span aria-label={`Tag: ${tagName}`} title={tagName} className="mr-1 inline-block h-2 w-2 shrink-0 rounded-full" style={{background:tagColor || 'var(--accent)'}}/>}<span className="min-w-0 flex-1 truncate font-semibold text-[11px]" title={`${rv.guestName} · ${rv.checkIn} → ${rv.checkOut}`}>{geometry.continuesBefore?'‹ ':''}{rv.guestName || 'Guest'}{geometry.continuesAfter?' ›':''}</span><span className="ml-1.5 shrink-0 text-[10px] opacity-90 font-medium tabular-nums">♙ {formatGuests(rv)}</span>

              <span role="separator" aria-label={`Resize ${rv.guestName || 'reservation'} check-in`} title="Drag to change check-in date" onPointerDown={e=>beginResize(e,rv,'start')} onPointerUp={finishResize} onPointerCancel={()=>{resizeStartRef.current=null}} onClick={e=>e.stopPropagation()} className="room-planner-handle absolute left-0 top-0 h-full w-2 cursor-ew-resize touch-none rounded-l" style={{background:'color-mix(in srgb,var(--text) 22%,transparent)',zIndex:20}}/>
              <span role="separator" aria-label={`Resize ${rv.guestName || 'reservation'} check-out`} title="Drag to change check-out date" onPointerDown={e=>beginResize(e,rv,'end')} onPointerUp={finishResize} onPointerCancel={()=>{resizeStartRef.current=null}} onClick={e=>e.stopPropagation()} className="room-planner-handle absolute right-0 top-0 h-full w-2 cursor-ew-resize touch-none rounded-r" style={{background:'color-mix(in srgb,var(--text) 22%,transparent)',zIndex:20}}/>
            </div>})}
          </div>})}
        {bottomSpacerHeight > 0 && <div aria-hidden="true" style={{height:bottomSpacerHeight,gridColumn:'1 / -1'}}/>}

        <div className="grid sticky bottom-0 z-30" style={{gridTemplateColumns:`${ROOM_COL_WIDTH}px repeat(${columns.length}, ${dayWidth}px)`,background:'var(--bg)',borderTop:'2px solid var(--border)'}}>
          {['arrivals','inHouse','checkOuts'].map((kind,idx)=><React.Fragment key={kind}><div className="room-planner-room-cell sticky left-0 z-40 px-3 py-2 text-xs font-medium" style={{background:'var(--cal-group)',color:'var(--text)',fontWeight:600,borderBottom:idx===2?'none':`1px solid var(--border)`}}>{kind==='arrivals'?'Arrivals':kind==='inHouse'?'In-House':'Departures'}</div>{columns.map(d=>{const s=calculateDailyStats(normalizedReservations,d);const value=s[kind];return <div key={`${kind}-${dateKey(d)}`} className="text-center py-2 text-xs tabular-nums" style={{color:value?'var(--text)':'var(--text-muted)',fontWeight:value?700:400,opacity:value?1:.55,background:'var(--surface)',borderRight:`1px solid var(--border)`,borderBottom:idx===2?'none':`1px solid var(--border)`}}>{value}</div>})}</React.Fragment>)}
        </div>
      </div>}
      {reservationListMode && <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]"><table className="w-full min-w-[760px] text-left text-xs"><thead className="sticky top-0 bg-[var(--deep-lagoon)] text-[var(--white)]"><tr><th className="p-3">Guest</th><th className="p-3">Room</th><th className="p-3">Arrival</th><th className="p-3">Departure</th><th className="p-3">Guests</th><th className="p-3">Source</th><th className="p-3">Payment</th></tr></thead><tbody>{filteredReservations.map(rv=>{const room=plannerRooms.find(item=>item.id===rv.roomId);const pay=getPaymentStyle(getPaymentStatusFromAmounts(rv.amountPaid,rv.totalAmount));return <tr key={rv.id} className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--surface-2)]" onClick={()=>setSelectedReservation(rv)}><td className="p-3 font-semibold">{rv.guestName||'Guest'}</td><td className="p-3">{room?.number||'—'}</td><td className="p-3">{format(parseDate(rv.checkIn),dateFormat)}</td><td className="p-3">{format(parseDate(rv.checkOut),dateFormat)}</td><td className="p-3">{formatGuests(rv)}</td><td className="p-3">{channelLabel[rv.channel]||rv.channel||'—'}</td><td className="p-3"><span className="rounded px-2 py-1 font-semibold" style={{background:pay.background,color:pay.color}}>{pay.label}</span></td></tr>})}{filteredReservations.length===0&&<tr><td colSpan={7} className="p-6 text-center text-[var(--text-muted)]">No reservations match the current filters.</td></tr>}</tbody></table></div>}
      {mobileListMode && <div className="space-y-3 py-2">
        {columns.map(day=>{
          const key=dateKey(day);
          const dayReservations=filteredReservations.filter(rv=>rv.checkIn<=key&&rv.checkOut>key);
          const dayClosures=closures.filter(item=>item.start_date<=key&&key<item.end_date);
          return <section key={key} className="overflow-hidden rounded-xl" style={{background:'var(--surface)',border:'1px solid var(--border)'}}>
            <div className="flex items-center justify-between gap-3 px-4 py-3" style={{background:'var(--deep-lagoon)',color:'var(--white)'}}><strong>{format(day,dateFormat)}</strong><span className="text-xs">{dayReservations.length} stay{dayReservations.length===1?'':'s'}</span></div>
            {dayClosures.map(item=><div key={item.id} className="px-4 py-2 text-xs font-medium" style={{background:'repeating-linear-gradient(135deg, color-mix(in srgb, var(--stay-closed) 72%, var(--surface)) 0 5px, var(--surface) 5px 10px)',color:'var(--text)'}}>Room {plannerRooms.find(room=>room.id===item.room_id)?.number || '—'} · {item.reason} · Closed</div>)}
            {dayReservations.length===0&&dayClosures.length===0&&<div className="px-4 py-4 text-sm" style={{color:'var(--muted)'}}>No stays or closures.</div>}
            {dayReservations.map(rv=>{
              const room=plannerRooms.find(item=>item.id===rv.roomId);
              const payment=getPaymentStyle(getPaymentStatusFromAmounts(rv.amountPaid,rv.totalAmount));
              return <button key={rv.id} type="button" onClick={()=>setSelectedReservation(rv)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" style={{borderTop:'1px solid var(--border)',color:'var(--text)'}}>
                <span className="min-w-0"><span className="block truncate text-sm font-semibold">{rv.guestName || 'Guest'} · Room {room?.number || '—'}</span><span className="block text-xs" style={{color:'var(--muted)'}}>{format(parseDate(rv.checkIn),dateFormat)} → {format(parseDate(rv.checkOut),dateFormat)} · {formatGuests(rv)} · {channelLabel[rv.channel] || rv.channel || '—'}</span></span>
                <span className="shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold" style={{background:payment.background,color:payment.color}}>{payment.label}</span>
              </button>;
            })}
          </section>;
        })}
      </div>}
    </div>

    {closureModal && <Modal title="Add room closure" onClose={() => setClosureModal(false)}><div className="p-5 space-y-4">
      <p className="text-sm" style={{color:MUTED}}>The end date is exclusive, matching reservation check-out dates. Existing reservations are not changed.</p>
      <Field label="Room"><select className="w-full h-10 rounded-lg px-3 text-sm" value={closureForm.roomId} onChange={e=>setClosureForm(current=>({...current,roomId:e.target.value}))} style={{background:SURFACE2,border:`1px solid ${BORDER}`,color:NAVY}}>{plannerRooms.map(room=><option key={room.id} value={room.id}>Room {room.number} · {room.name || roomTypeMap.get(room.room_type_id) || 'Room'}</option>)}</select></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Start date"><InputField type="date" value={closureForm.startDate} onChange={e=>setClosureForm(current=>({...current,startDate:e.target.value}))}/></Field><Field label="End date (exclusive)"><InputField type="date" value={closureForm.endDate} min={closureForm.startDate} onChange={e=>setClosureForm(current=>({...current,endDate:e.target.value}))}/></Field></div>
      <Field label="Reason"><InputField value={closureForm.reason} maxLength={160} onChange={e=>setClosureForm(current=>({...current,reason:e.target.value}))} placeholder="Maintenance, repair, owner use…"/></Field>
      <div className="flex justify-between items-center gap-3"><span className="text-xs" style={{color:MUTED}}>{closures.length} saved closure{closures.length===1?'':'s'}</span><div className="flex gap-2"><button onClick={()=>setClosureModal(false)} className="px-4 py-2 rounded-lg" style={{border:`1px solid ${BORDER}`}}>Cancel</button><button disabled={closureSaving} onClick={saveClosure} className="px-4 py-2 rounded-lg font-medium disabled:opacity-60" style={{background:TEAL,color:'var(--on-primary)'}}>{closureSaving?'Saving…':'Save closure'}</button></div></div>
      {closures.length>0 && <div className="border-t pt-3 space-y-2" style={{borderColor:BORDER}}><h3 className="text-xs font-semibold" style={{color:NAVY}}>Existing closures</h3>{closures.map(item=><div key={item.id} className="flex items-center justify-between gap-3 rounded-lg p-2 text-xs" style={{background:SURFACE2}}><span>Room {plannerRooms.find(room=>room.id===item.room_id)?.number || '—'} · {item.start_date} to {item.end_date} · {item.reason}</span><button onClick={()=>deleteClosure(item)} className="shrink-0 font-semibold" style={{color:DESTRUCTIVE}}>Remove</button></div>)}</div>}
    </div></Modal>}

    {selectedReservation && <div className="room-planner-detail" role="dialog" aria-modal="true" aria-label="Reservation details">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-4 py-3" style={{background:'var(--surface)',borderBottom:'1px solid var(--border)'}}><div className="min-w-0"><div className="text-[11px] font-semibold uppercase tracking-wide" style={{color:'var(--muted)'}}>Reservation details</div><h2 className="truncate font-semibold text-lg leading-6" style={{color:'var(--text)'}}>{selectedReservation.guestName || 'Guest'}</h2>{(()=>{const badge=getPaymentStyle(getPaymentStatusFromAmounts(selectedReservation.amountPaid,selectedReservation.totalAmount));return <span className="mt-1 inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold" style={{background:badge.background,color:badge.color,border:`1px solid ${badge.border}`}}>{badge.label}</span>})()}</div><button type="button" aria-label="Close reservation details" onClick={()=>setSelectedReservation(null)} className="room-planner-icon-close rounded-lg p-2" style={{color:'var(--muted)'}}><X size={18}/></button></div>
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="room-planner-tile"><div className="room-planner-tile-label">Reservation no.</div><b>{selectedReservation.reservationNumber || selectedReservation.reservation_number || selectedReservation.bookingReference || selectedReservation.id}</b></div>
          <div className="room-planner-tile"><div className="room-planner-tile-label">Room</div><b>{plannerRooms.find(room=>room.id===selectedReservation.roomId)?.number || selectedReservation.roomNumber || '—'}</b></div>
          <div className="room-planner-tile"><div className="room-planner-tile-label">Check-in</div><b>{format(parseDate(selectedReservation.checkIn),dateFormat)}</b></div>
          <div className="room-planner-tile"><div className="room-planner-tile-label">Check-out</div><b>{format(parseDate(selectedReservation.checkOut),dateFormat)}</b></div>
          <div className="room-planner-tile"><div className="room-planner-tile-label">Nights</div><b>{differenceInCalendarDays(parseDate(selectedReservation.checkOut),parseDate(selectedReservation.checkIn))}</b></div>
          <div className="room-planner-tile"><div className="room-planner-tile-label">Guests</div><b><Users size={13} className="inline mr-1"/>{formatGuests(selectedReservation)}</b></div>
        </div>
        <div className="space-y-2 text-sm"><div className="flex justify-between gap-3"><span style={{color:'var(--muted)'}}>Source</span><b>{channelLabel[selectedReservation.channel] || selectedReservation.channel || '—'}</b></div><div className="flex justify-between gap-3"><span style={{color:'var(--muted)'}}>Total</span><b>KES {Number(selectedReservation.totalAmount||0).toLocaleString('en-KE')}</b></div><div className="flex justify-between gap-3"><span style={{color:'var(--muted)'}}>Paid</span><b>KES {Number(selectedReservation.amountPaid||0).toLocaleString('en-KE')}</b></div><div className="flex justify-between gap-3"><span style={{color:'var(--muted)'}}>Balance</span><b>KES {Math.max(0,Number(selectedReservation.totalAmount||0)-Number(selectedReservation.amountPaid||0)).toLocaleString('en-KE')}</b></div><div className="flex justify-between gap-3"><span style={{color:'var(--muted)'}}>Payment</span><b>{getPaymentStyle(getPaymentStatusFromAmounts(selectedReservation.amountPaid,selectedReservation.totalAmount)).label}</b></div></div>
        {selectedReservation.optionExpiresAt && <div className="rounded-lg p-3 text-sm" style={{background:'var(--pay-opt)',border:'1px dashed var(--pay-opt-bd)',color:'var(--pay-opt-fg)'}}><div className="font-semibold">Optioned reservation</div><div className="mt-1">{Math.max(0,new Date(selectedReservation.optionExpiresAt).getTime()-clockNow)>0 ? `Expires in ${Math.floor((new Date(selectedReservation.optionExpiresAt).getTime()-clockNow)/3600000)}h ${Math.floor(((new Date(selectedReservation.optionExpiresAt).getTime()-clockNow)%3600000)/60000)}m` : 'Expiry is being processed'}</div><div className="mt-1 text-xs">Deadline: {new Date(selectedReservation.optionExpiresAt).toLocaleString()}</div></div>}
        <div className="rounded-lg p-3" style={{background:'var(--surface-2)'}}><div className="flex items-center gap-2 text-xs font-semibold mb-1"><StickyNote size={14}/>Notes</div><p className="text-sm whitespace-pre-wrap" style={{color:'var(--muted)'}}>{selectedReservation.notes || selectedReservation.specialRequests || 'No notes recorded.'}</p></div>
        <div className="grid grid-cols-2 gap-2">
          {selectedReservation.bookingStatus==='booked' && !selectedReservation.optionExpiresAt && <button className="room-planner-detail-action" onClick={async()=>{try{await pmsService.setReservationOption(selectedReservation.id,true);toast.success('Reservation optioned for 24 hours');setSelectedReservation(null);onRefresh?.()}catch(error){toast.error(error.message)}}}><Clock size={14}/>Set 24-hour option</button>}
          {selectedReservation.optionExpiresAt && <button className="room-planner-detail-action" onClick={async()=>{try{await pmsService.setReservationOption(selectedReservation.id,false);toast.success('Option confirmed');setSelectedReservation(null);onRefresh?.()}catch(error){toast.error(error.message)}}}><Save size={14}/>Confirm option</button>}
          <button className="room-planner-detail-action" onClick={()=>openEdit(selectedReservation)}><Pencil size={14}/>Edit reservation</button>
          <button className="room-planner-detail-action" onClick={()=>openFolio(selectedReservation)}><CreditCard size={14}/>Open folio / payment</button>
          <button className="room-planner-detail-action" onClick={()=>{setActionModal({type:'charge',reservation:selectedReservation});setSelectedReservation(null)}}><Plus size={14}/>Add charge</button>
          {selectedReservation.bookingStatus!=='checked_in' && !selectedReservation.optionExpiresAt && <button className="room-planner-detail-action room-planner-detail-primary" onClick={async()=>{try{await pmsService.checkInReservation(selectedReservation.id);toast.success('Guest checked in');setSelectedReservation(null);onRefresh?.()}catch(error){toast.error(error.message)}}}><LogIn size={14}/>Check in</button>}
          {selectedReservation.bookingStatus==='checked_in' && <button className="room-planner-detail-action room-planner-detail-primary" onClick={async()=>{try{await pmsService.checkOutRoom(selectedReservation.roomId);toast.success('Guest checked out');setSelectedReservation(null);onRefresh?.()}catch(error){toast.error(error.message)}}}><LogOut size={14}/>Check out</button>}
          <button className="room-planner-detail-action" onClick={()=>{const next={...selectedReservation,checkOut:dateKey(addDays(parseDate(selectedReservation.checkOut),1))};setSelectedReservation(null);openEdit(next);setForm(current=>({...current,checkOut:next.checkOut}))}}><Clock size={14}/>Extend one night</button>
          <button className="room-planner-detail-action" onClick={()=>{setSelectedReservation(null);openEdit(selectedReservation)}}><SlidersHorizontal size={14}/>Move / change room</button>
        </div>
      </div>
    </div>}

    {hoverCard && typeof document !== 'undefined' && createPortal(<div data-room-planner-hover-card="true" className="reservation-hover-card" role="tooltip" onMouseLeave={leaveReservationHoverCard} onClick={e=>e.stopPropagation()} style={{position:'fixed',left:hoverCard.left,top:hoverCard.top,width:310,maxWidth:'calc(100vw - 16px)',padding:11,background:'var(--surface)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:12,boxShadow:'var(--shadow-overlay)',fontSize:12,fontWeight:400,lineHeight:1.45,whiteSpace:'normal',zIndex:9999}}>
      <div className="reservation-hover-title">Reservation No. {getPlannerReservationNumber(hoverCard.reservation)}</div>
      <div className="text-[12px]">{hoverCard.reservation.guestName || 'Guest'}</div>
      <div className="reservation-hover-line reservation-hover-muted"><Users size={13}/><span>{Number(hoverCard.reservation.adults || 1)} adult{Number(hoverCard.reservation.adults || 1)===1?'':'s'}{Number(hoverCard.reservation.kidsCount || 0)>0?`, ${Number(hoverCard.reservation.kidsCount)} child${Number(hoverCard.reservation.kidsCount)===1?'':'ren'}`:''}</span></div>
      <div className="reservation-hover-line"><CalendarDays size={13}/><span>{formatPlannerDate(hoverCard.reservation.checkIn)} → {formatPlannerDate(hoverCard.reservation.checkOut)}</span><span className="reservation-hover-pill">{Math.max(0,differenceInCalendarDays(parseDate(hoverCard.reservation.checkOut),parseDate(hoverCard.reservation.checkIn)))} {differenceInCalendarDays(parseDate(hoverCard.reservation.checkOut),parseDate(hoverCard.reservation.checkIn))===1?'night':'nights'}</span></div>
      <div className="reservation-hover-line"><strong>Total room:</strong><span>{formatPlannerAmount(hoverCard.reservation.totalAmount)} {getPlannerCurrency(hoverCard.reservation)}</span></div>
      <div className="reservation-hover-line"><strong>Booking notes:</strong><span>Meal plan: {getPlannerMealDescription(hoverCard.reservation.mealPlan)}</span></div>
      <div className="reservation-hover-line"><strong>Channel:</strong><span>{channelLabel[hoverCard.reservation.channel] || hoverCard.reservation.channel || 'Direct'}</span></div>
      <div className="reservation-hover-line"><strong>Paid:</strong><span>{formatPlannerAmount(hoverCard.reservation.amountPaid)} {getPlannerCurrency(hoverCard.reservation)}{getPlannerPaymentDetails(hoverCard.reservation).method?` · ${getPlannerPaymentDetails(hoverCard.reservation).method}`:''}{getPlannerPaymentDetails(hoverCard.reservation).paidAt?` · ${formatPlannerDate(getPlannerPaymentDetails(hoverCard.reservation).paidAt)}`:''}</span></div>
      <button type="button" className="reservation-hover-folio" onClick={()=>{setHoverCard(null);openFolio(hoverCard.reservation)}}><CreditCard size={13}/>Folio</button>
    </div>,document.body)}
    {modal && <Modal wide title={modal.mode==='create'?'New Reservation':'Edit Reservation'} onClose={()=>setModal(null)}><div className="p-5 space-y-4">
      {modal.mode==='edit'&&form.joint&&<div className="rounded-xl p-3" style={{background:'color-mix(in srgb,var(--primary-soft) 78%,var(--surface))',border:`1px solid ${TEAL}`,color:NAVY}}><div className="flex items-start gap-2"><Link2 size={17}/><div className="flex-1"><div className="font-medium text-sm">Joint Reservation - Group #{String(modal.groupId).slice(0,6).toUpperCase()} - {linked.length} plannerRooms linked</div></div><button onClick={splitGroup} className="text-xs font-medium px-2 py-1 rounded-lg" style={{border:`1px solid ${BORDER}`}}>Split Group</button></div></div>}
      {modal.mode === 'create' && <div className="space-y-5">
        <section className="space-y-3"><h3 className="text-sm font-bold" style={{color:NAVY}}>Guest & identification</h3>
          <div className="grid md:grid-cols-2 gap-3"><Field label="First name *"><InputField value={form.firstName} onChange={e=>setForm({...form,firstName:e.target.value,guestName:`${e.target.value} ${form.lastName}`.trim()})} autoFocus placeholder="First name"/></Field><Field label="Last name *"><InputField value={form.lastName} onChange={e=>setForm({...form,lastName:e.target.value,guestName:`${form.firstName} ${e.target.value}`.trim()})} placeholder="Last name"/></Field></div>
          <div className="grid md:grid-cols-2 gap-3"><Field label="Primary phone *"><InputField type="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="+254..."/></Field><Field label="Alternative phone"><InputField type="tel" value={form.alternativePhone} onChange={e=>setForm({...form,alternativePhone:e.target.value})}/></Field></div>
          <div className="grid md:grid-cols-2 gap-3"><Field label="Email"><InputField type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></Field><Field label="Nationality"><InputField value={form.nationality} onChange={e=>setForm({...form,nationality:e.target.value})}/></Field></div>
          <div className="grid md:grid-cols-2 gap-3"><Field label="Country of residence"><InputField value={form.residenceCountry} onChange={e=>setForm({...form,residenceCountry:e.target.value})}/></Field><Field label="Postal / residential address"><InputField value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></Field></div>
          <div className="grid md:grid-cols-2 gap-3"><Field label="Identification type"><SelectField value={form.idType} onChange={v=>setForm({...form,idType:v})}><option value="passport">Passport</option><option value="national_id">National ID</option><option value="other">Other</option></SelectField></Field><Field label="ID / passport number"><InputField value={form.idNumber} onChange={e=>setForm({...form,idNumber:e.target.value})}/></Field></div>
          <Field label="Guest profile notes"><InputField value={form.guestNotes} onChange={e=>setForm({...form,guestNotes:e.target.value})}/></Field>
        </section>
        <section className="space-y-3"><h3 className="text-sm font-bold" style={{color:NAVY}}>Stay, occupancy & room allocation</h3>
          <div className="grid md:grid-cols-2 gap-3"><Field label="Arrival date *"><InputField type="date" value={form.checkIn} onChange={e=>setForm({...form,checkIn:e.target.value})}/></Field><Field label="Departure date (exclusive) *"><InputField type="date" min={form.checkIn} value={form.checkOut} onChange={e=>setForm({...form,checkOut:e.target.value})}/></Field></div>
          <div className="grid md:grid-cols-2 gap-3"><Field label="Arrival time"><InputField type="time" value={form.arrivalTime} onChange={e=>setForm({...form,arrivalTime:e.target.value})}/></Field><Field label="Departure time"><InputField type="time" value={form.departureTime} onChange={e=>setForm({...form,departureTime:e.target.value})}/></Field></div>
          <div className="grid md:grid-cols-2 gap-3"><Field label="Adults"><InputField type="number" min="1" max="10" value={form.adults} onChange={e=>setForm({...form,adults:Number(e.target.value)})}/></Field><Field label="Children"><InputField type="number" min="0" max="6" value={form.kidsCount} onChange={e=>{const count=Math.max(0,Math.min(6,Number(e.target.value)||0));setForm({...form,kidsCount:count,kidsAges:Array.from({length:count},(_,i)=>form.kidsAges[i]??'')})}}/></Field></div>
          {Number(form.kidsCount)>0&&<div className="grid grid-cols-2 md:grid-cols-3 gap-3">{Array.from({length:Number(form.kidsCount)},(_,i)=><Field key={i} label={`Child ${i+1} age`}><InputField type="number" min="0" max="17" value={form.kidsAges[i]??''} onChange={e=>{const ages=[...form.kidsAges];ages[i]=e.target.value;setForm({...form,kidsAges:ages})}}/></Field>)}</div>}
          <div className="flex items-center gap-2"><input type="checkbox" checked={!!form.joint} onChange={e=>setForm({...form,joint:e.target.checked,selectedRoomIds:e.target.checked?(form.selectedRoomIds.length?form.selectedRoomIds:[form.roomId]):[form.roomId]})}/><span className="text-xs font-semibold" style={{color:NAVY}}>Joint / multi-room reservation</span></div>
          {form.joint&&<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">{plannerRooms.filter(r=>r.active!==false&&!['maintenance','out_of_service','blocked'].includes(r.status)).map(r=><label key={r.id} className="flex items-center gap-2 rounded-lg p-2 text-xs" style={{border:`1px solid ${BORDER}`,color:NAVY}}><input type="checkbox" checked={form.selectedRoomIds.includes(r.id)} onChange={e=>setForm({...form,selectedRoomIds:e.target.checked?[...form.selectedRoomIds,r.id]:form.selectedRoomIds.filter(id=>id!==r.id)})}/><span>Room {r.number} · {r.roomTypeName||r.room_type||'Room'}</span></label>)}</div>}
          {!form.joint&&<div className="grid md:grid-cols-2 gap-3"><Field label="Assigned room"><SelectField value={form.roomId} onChange={v=>setForm({...form,roomId:v,roomTypeId:plannerRooms.find(r=>r.id===v)?.room_type_id||''})}>{plannerRooms.map(r=><option key={r.id} value={r.id}>Room {r.number} · {r.roomTypeName||r.room_type||'Room'}</option>)}</SelectField></Field><div className="rounded-lg p-3 text-xs" style={{background:SURFACE2,color:NAVY}}>Capacity: {plannerRooms.find(r=>r.id===form.roomId)?.capacity||2} guests</div></div>}
        </section>
        <section className="space-y-3"><h3 className="text-sm font-bold" style={{color:NAVY}}>Booking source & references</h3>
          <div className="grid md:grid-cols-2 gap-3"><Field label="Booking source"><SelectField value={form.channel} onChange={v=>setForm({...form,channel:v})}><option value="direct">Direct</option><option value="booking_com">Booking.com</option><option value="unknown">Other / Unknown</option></SelectField></Field><Field label="Company / organisation"><InputField value={form.company} onChange={e=>setForm({...form,company:e.target.value})}/></Field></div>
          <div className="grid md:grid-cols-2 gap-3"><Field label="Travel agent / booker"><InputField value={form.agent} onChange={e=>setForm({...form,agent:e.target.value})}/></Field><Field label="External booking reference"><InputField value={form.externalReference} onChange={e=>setForm({...form,externalReference:e.target.value})}/></Field></div>
          <Field label="Group / tour reference"><InputField value={form.groupReference} onChange={e=>setForm({...form,groupReference:e.target.value})}/></Field>
        </section>
        <section className="space-y-3"><h3 className="text-sm font-bold" style={{color:NAVY}}>Rates, services & deposit</h3>
          <div className="grid md:grid-cols-2 gap-3"><Field label="Rate plan"><SelectField value={form.ratePlanId} onChange={v=>{const plan=ratePlans.find(p=>p.id===v);setForm({...form,ratePlanId:v,rate:plan?String(plan.base_rate??plan.rate??form.rate):form.rate})}}><option value="">Select rate plan (optional)</option>{ratePlans.map(p=><option key={p.id} value={p.id}>{p.name} · KES {Number(p.base_rate??p.rate??0).toLocaleString()}</option>)}</SelectField></Field><Field label="Meal plan"><SelectField value={form.mealPlan} onChange={v=>setForm({...form,mealPlan:v})}><option value="bed_only">Bed Only</option><option value="bb">Bed & Breakfast</option><option value="half_board">Half Board</option><option value="full_board">Full Board</option></SelectField></Field></div>
          {ratePlansError&&<p className="text-xs" style={{color:DESTRUCTIVE}}>Rate plans unavailable: {ratePlansError}</p>}
          <div className="grid md:grid-cols-2 gap-3"><Field label="Nightly room rate (KES)"><InputField type="number" min="0" step="0.01" value={form.rate} onChange={e=>setForm({...form,rate:e.target.value})}/></Field><Field label="Additional services (KES)"><InputField type="number" min="0" step="0.01" value={form.services} onChange={e=>setForm({...form,services:e.target.value})}/></Field></div>
          <div className="grid md:grid-cols-2 gap-3"><Field label="Discount (KES)"><InputField type="number" min="0" step="0.01" value={form.discount} onChange={e=>setForm({...form,discount:e.target.value})}/></Field><Field label="Tax / levies (KES)"><InputField type="number" min="0" step="0.01" value={form.tax} onChange={e=>setForm({...form,tax:e.target.value})}/></Field></div>
          <Field label="Required deposit (KES)"><InputField type="number" min="0" step="0.01" value={form.depositRequired} onChange={e=>setForm({...form,depositRequired:e.target.value})}/></Field>

          <Field label="Booking status"><SelectField value={form.bookingStatus || 'confirmed'} onChange={v=>setForm({...form,bookingStatus:v})}><option value="confirmed">Confirmed booking</option><option value="optioned">Optioned · valid for 24 hours</option></SelectField></Field>
          <Field label="Payment status">
            {(()=>{const total=calculatedReservationTotal;const status=getPaymentStatusFromAmounts(form.amountPaid,total);const options=[{value:'fully_paid',label:'Paid',amount:total},{value:'partially_paid',label:'Deposit',amount:total*0.5},{value:'not_paid',label:'Not paid',amount:0}];return <div className="grid grid-cols-3 gap-2" role="group" aria-label="Choose reservation payment status">{options.map(option=>{const style=getPaymentStyle(option.value);const selected=status===option.value;return <button key={option.value} type="button" aria-pressed={selected} onClick={()=>setForm(current=>({...current,amountPaid:option.amount}))} className="min-h-11 rounded-lg px-2.5 py-2 text-sm font-semibold transition-colors" style={{background:style.background,color:style.color,border:`2px solid ${selected?style.border:'var(--border)'}`,boxShadow:selected?'0 0 0 1px var(--surface) inset':'none'}}>{option.label}</button>})}</div>})()}
            <div className="mt-2 flex items-center justify-between text-xs" style={{color:MUTED}}><span>Amount received: KES {Number(form.amountPaid||0).toLocaleString('en-KE')}</span><span>Balance: KES {Math.max(0,calculatedReservationTotal-Number(form.amountPaid||0)).toLocaleString('en-KE')}</span></div>
          </Field>
          <div className="grid md:grid-cols-2 gap-3"><Field label="Deposit payment method"><SelectField value={form.depositMethod} onChange={v=>setForm({...form,depositMethod:v})}><option value="cash">Cash</option><option value="mpesa">M-Pesa</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></SelectField></Field><Field label="Calculated total amount (KES)"><InputField type="number" value={calculatedReservationTotal.toFixed(2)} readOnly aria-readonly="true"/></Field></div>
          <div className="rounded-xl p-3 text-sm grid grid-cols-2 md:grid-cols-4 gap-3" style={{background:'var(--surface-2)',border:`1px solid ${BORDER}`,color:NAVY}}><div><span className="block text-[10px] uppercase">Nights</span><b>{Math.max(0,differenceInCalendarDays(parseDate(form.checkOut),parseDate(form.checkIn)))}</b></div><div><span className="block text-[10px] uppercase">Room subtotal</span><b>KES {(Number(form.rate||0)*Math.max(0,differenceInCalendarDays(parseDate(form.checkOut),parseDate(form.checkIn)))*(form.joint?form.selectedRoomIds.length:1)).toLocaleString()}</b></div><div><span className="block text-[10px] uppercase">Balance due</span><b>KES {Math.max(0,calculatedReservationTotal-Number(form.amountPaid||0)).toLocaleString()}</b></div><div><span className="block text-[10px] uppercase">Payment status</span><b>{paymentLabel[getPaymentStatusFromAmounts(form.amountPaid,modal.mode==='create'?calculatedReservationTotal:form.totalAmount)]}</b></div></div>
          <p className="text-xs leading-5" style={{color:MUTED}}>Deposits are posted to the payment ledger as part of the reservation transaction. Subsequent payments, refunds and adjustments must be recorded from Guest Folio.</p>
        </section>
        <section className="space-y-3"><h3 className="text-sm font-bold" style={{color:NAVY}}>Guest requests & internal notes</h3>
          <Field label="Special requests"><InputField value={form.specialRequests} onChange={e=>setForm({...form,specialRequests:e.target.value})}/></Field><Field label="Booking / operational notes"><InputField value={form.bookingNotes} onChange={e=>setForm({...form,bookingNotes:e.target.value,notes:e.target.value})}/></Field>
        </section>
      </div>}
      {modal.mode === 'edit' && <>
        <Field label="Guest Name"><InputField value={form.guestName} onChange={e=>setForm({...form,guestName:e.target.value})} autoFocus placeholder="Guest full name"/></Field>
        <div className="grid md:grid-cols-2 gap-3"><Field label="Check-in"><InputField type="date" value={form.checkIn} onChange={e=>setForm({...form,checkIn:e.target.value})}/></Field><Field label="Check-out (exclusive)"><InputField type="date" value={form.checkOut} min={form.checkIn} onChange={e=>setForm({...form,checkOut:e.target.value})}/></Field></div>
        <div className="grid md:grid-cols-2 gap-3"><Field label="Reservation Channel"><SelectField value={form.channel} onChange={v=>setForm({...form,channel:v})}><option value="direct">Direct</option><option value="booking_com">Booking.com</option><option value="unknown">Unknown</option></SelectField></Field><Field label="Meal Plan"><SelectField value={form.mealPlan} onChange={v=>setForm({...form,mealPlan:v})}><option value="bed_only">Bed Only</option><option value="bb">BB</option><option value="half_board">HB</option><option value="full_board">FB</option></SelectField></Field></div>
        <Field label="Total Amount"><InputField type="number" min="0" step="0.01" value={form.totalAmount} onChange={e=>setForm({...form,totalAmount:e.target.value})}/></Field>

         <Field label="Payment status · Room Planner legend">
           <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="group" aria-label="Reservation payment status">
             {['not_paid','partially_paid','fully_paid'].map(status=>{const style=getPaymentStyle(status);const total=Math.max(0,Number(form.totalAmount||0));const selected=getPaymentStatusFromAmounts(form.amountPaid,total)===status;const current=Number(form.amountPaid||0);const partialAmount=current>0&&current<total?current:total*0.5;return <button key={status} type="button" aria-pressed={selected} onClick={()=>setForm({...form,amountPaid:status==='not_paid'?0:status==='fully_paid'?total:partialAmount})} className="rounded-lg px-3 py-2.5 text-xs font-bold text-left" style={{background:style.background,color:style.color,border:`2px solid ${selected?style.border:'var(--border)'}`}}><span className="block">{style.label}</span><span className="block mt-1 font-medium opacity-90">{status==='not_paid'?'KES 0 received':status==='fully_paid'?`KES ${total.toLocaleString('en-KE')} received`:`Deposit · KES ${partialAmount.toLocaleString('en-KE')} received`}</span></button>})}
           </div>
         </Field>
      </>}
      {formError&&<div className="text-xs p-3 rounded-lg" style={{background:'var(--danger-soft)',color:DESTRUCTIVE}}>{formError}</div>}
      <div className="rounded-lg p-3 text-xs leading-5" style={{background:'var(--surface-2)',border:'1px solid var(--border)',color:'var(--muted)'}}><strong style={{color:'var(--text)'}}>Payment ledger</strong><div>{modal.mode === 'create' ? 'New bookings start unpaid unless an initial deposit is recorded.' : `Booking payment status: ${paymentLabel[getPaymentStatusFromAmounts(form.amountPaid, form.totalAmount)]} · Recorded: KES ${Number(form.amountPaid || 0).toLocaleString()}`}</div>Planner edits do not create payment transactions.</div>
      <div className="flex items-center justify-between pt-2"><div>{modal.mode==='edit'&&<button onClick={handleDelete} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium" style={{color:DESTRUCTIVE,border:`1px solid ${DESTRUCTIVE}`}}><Trash2 size={14}/> Delete</button>}</div><div className="flex gap-2"><button onClick={()=>setModal(null)} className="px-4 py-2.5 rounded-xl text-sm" style={{border:`1px solid ${BORDER}`,color:MUTED}}>Cancel</button><button disabled={saving} onClick={saveReservation} className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-medium disabled:opacity-60" style={{background:'var(--primary)',color:'var(--on-primary)',border:'1px solid var(--primary)'}}><Save size={15}/>{saving?'Saving…':'Save'}</button></div></div>
    </div></Modal>}

    {moveConfirmation&&<Modal title="Confirm Move Reservation?" onClose={()=>setMoveConfirmation(null)}><div className="p-5"><p className="text-sm leading-6" style={{color:NAVY}}>Move reservation <strong>“{moveConfirmation.reservation.guestName}”</strong> from Room {plannerRooms.find(r=>r.id===moveConfirmation.reservation.roomId)?.number} ({moveConfirmation.reservation.checkIn}–{moveConfirmation.reservation.checkOut}) to Room {plannerRooms.find(r=>r.id===moveConfirmation.target.roomId)?.number} ({moveConfirmation.target.checkIn}–{moveConfirmation.target.checkOut})?</p><div className="flex justify-end gap-2 mt-5"><button onClick={()=>setMoveConfirmation(null)} className="px-4 py-2 rounded-lg" style={{border:`1px solid ${BORDER}`}}>Cancel</button><button onClick={()=>confirmMove(!!moveConfirmation.reservation.groupId)} className="px-4 py-2 rounded-lg font-medium" style={{background:TEAL,color:'var(--on-primary)'}}>Confirm Move</button></div></div></Modal>}
    {groupMoveConfirmation&&<Modal title="Joint Reservation" onClose={()=>setGroupMoveConfirmation(null)}><div className="p-5"><p className="text-sm" style={{color:NAVY}}>This is part of a joint reservation. Move only this room or all plannerRooms in the group?</p><div className="flex justify-end gap-2 mt-5"><button onClick={()=>performGroupMove(false)} className="px-4 py-2 rounded-lg" style={{border:`1px solid ${BORDER}`}}>Move only this room</button><button onClick={()=>performGroupMove(true)} className="px-4 py-2 rounded-lg font-medium" style={{background:TEAL,color:'var(--on-primary)'}}>Move entire group</button></div></div></Modal>}

    {actionModal?.type==='groupFolioChoice'&&<Modal title="Joint Reservation Folio" onClose={()=>setActionModal(null)}><div className="p-5"><p className="text-sm" style={{color:NAVY}}>This reservation is part of a joint reservation. Open the folio for this room only or the entire group?</p><div className="flex justify-end gap-2 mt-5"><button onClick={()=>openRoomFolio(actionModal.reservation,false)} className="px-4 py-2 rounded-lg" style={{border:`1px solid ${BORDER}`}}>This room only</button><button onClick={()=>openRoomFolio(actionModal.reservation,true)} className="px-4 py-2 rounded-lg font-medium" style={{background:TEAL,color:'var(--on-primary)'}}>Entire group</button></div></div></Modal>}
    {actionModal?.type==='folio'&&<Modal wide title={`PMS Folio · Room ${actionModal.reservation.roomNumber || plannerRooms.find(x=>x.id===actionModal.reservation.roomId)?.number || ''}`} onClose={()=>setActionModal(null)}><Folio key={actionModal.reservation.id} initialReservationId={actionModal.reservation.id} embedded /></Modal>}{actionModal?.type==='groupFolio'&&<Modal title="Joint Reservation Folio" onClose={()=>setActionModal(null)}><div className="p-5"><p className="text-sm mb-3" style={{color:NAVY}}>Group #{String(actionModal.reservation.groupId).slice(0,6).toUpperCase()}</p><div className="space-y-2">{folio?.group?.map(r=><div key={r.id} className="flex justify-between p-3 rounded-lg" style={{background:SURFACE2}}><span className="text-sm">Room {r.roomNumber || plannerRooms.find(x=>x.id===r.roomId)?.number} · {r.guestName}</span><span className="text-xs" style={{color:MUTED}}>{mealLabel[r.mealPlan]}</span></div>)}</div></div></Modal>}
    {actionModal?.type==='charge'&&<Modal title={`Post Room Charge · Room ${actionModal.reservation.roomNumber || plannerRooms.find(x=>x.id===actionModal.reservation.roomId)?.number || ''}`} onClose={()=>setActionModal(null)}><div className="p-5 space-y-4"><div className="rounded-xl p-3" style={{background:SURFACE2}}><div className="font-medium text-sm" style={{color:NAVY}}>{actionModal.reservation.guestName}</div><div className="text-xs mt-1" style={{color:MUTED}}>Meal Plan: {mealLabel[actionModal.reservation.mealPlan] || 'Bed Only'}</div></div><Field label="Description"><InputField value={chargeDescription} onChange={e=>setChargeDescription(e.target.value)}/></Field><Field label="Amount (KES)"><InputField type="number" min="0.01" step="0.01" value={chargeAmount} onChange={e=>setChargeAmount(e.target.value)} autoFocus/></Field><div className="flex justify-end gap-2"><button onClick={()=>setActionModal(null)} className="px-4 py-2 rounded-lg" style={{border:`1px solid ${BORDER}`}}>Cancel</button><button onClick={submitCharge} className="px-4 py-2 rounded-lg font-medium" style={{background:TEAL,color:'var(--on-primary)'}}>Post Charge</button></div></div></Modal>}

    {exportPreview && <Modal wide title="Room Planner export preview" onClose={() => setExportPreview(false)}>
      <div className="space-y-4 p-5">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text)]">Reservation schedule</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Active, non-cancelled reservations overlapping the visible date range. The detailed reservation schedule is included in PDF and Excel; the daily room matrix is available as an additional Excel sheet.</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-[var(--text-muted)]">{roomPlannerDefinition.period.from} to {roomPlannerDefinition.period.to} · {roomPlannerDefinition.sections.find((section) => section.name === 'reservation-schedule')?.rows.length || 0} reservations</span>
          <DocumentExportMenu definition={roomPlannerDefinition} label="Export documents" />
        </div>
        <ReportDataTable section={roomPlannerDefinition.sections.find((section) => section.name === 'reservation-schedule')} emptyMessage="No active reservations overlap this date range." />
        <div className="flex justify-end">
          <button type="button" onClick={() => setExportPreview(false)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)]">Close</button>
        </div>
      </div>
    </Modal>}

  </div>;
}