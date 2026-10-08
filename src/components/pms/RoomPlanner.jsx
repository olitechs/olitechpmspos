import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, Link2, Plus, RefreshCw, X, Save, Trash2,
  Printer, BedDouble, Download, AlertTriangle,
} from 'lucide-react';
import {
  format, addDays, differenceInCalendarDays, eachDayOfInterval, endOfMonth, startOfMonth, subDays,
} from 'date-fns';
import { toast } from 'sonner';
import { pmsService } from '@/services/pmsService';
import { Select } from '@/components/ui/select';
import StatusLegend from '@/components/ui/StatusLegend';
import { useAuth } from '@/lib/AuthContext';
import { NAVY, TEAL, SAND, SURFACE, SURFACE2, BORDER, MUTED, DESTRUCTIVE } from '@/data/palette';

export const PAYMENT_STATUS = ['fully_paid', 'partially_paid', 'not_paid'];
export const CHANNELS = ['direct', 'booking_com', 'unknown'];
export const MEAL_PLANS = ['bed_only', 'bb', 'half_board', 'full_board'];
export const BOOKING_STATUSES = ['booked', 'checked_in', 'checked_out'];

const DAY_WIDTH = 110;
const ROOM_COL_WIDTH = 210;
const PRINT_MAX_DAYS = 30;

// CALENDAR THEME: Green/Yellow/Orange - Rectangle bars, English
export const getReservationBarStyle = (status = 'occupied') => ({
  optioned:{background:'var(--stay-optioned)',color:'var(--action-text)',border:'var(--stay-optioned)',label:'Optioned'},
  confirmed:{background:'transparent',color:'var(--text)',border:'var(--stay-occupied)',label:'Confirmed / arriving'},
  occupied:{background:'var(--stay-occupied)',color:'var(--action-text)',border:'var(--stay-occupied)',label:'In-house'},
  checkout:{background:'var(--stay-checkout)',color:'var(--action-text)',border:'var(--stay-checkout)',label:'Checking out today'},
  checked_out:{background:'var(--stay-occupied)',color:'var(--action-text)',border:'var(--stay-occupied)',label:'Checked out'},
  closed:{background:'var(--stay-closed)',color:'var(--text)',border:'var(--stay-closed)',label:'Out of order / closure'},
}[status] || {background:'var(--stay-occupied)',color:'var(--action-text)',border:'var(--stay-occupied)',label:'In-house'});

export const getPaymentStyle=(status)=>({fully_paid:{background:'var(--pay-total)',color:'var(--action-text)',border:'var(--pay-total)',label:'Total Paid'},partially_paid:{background:'var(--pay-partial)',color:'var(--action-text)',border:'var(--pay-partial)',label:'Partially Paid'},not_paid:{background:'var(--pay-none)',color:'var(--action-text)',border:'var(--pay-none)',label:'No Amount Paid'}}[status]||{background:'var(--pay-none)',color:'var(--action-text)',border:'var(--pay-none)',label:'No Amount Paid'});

export function getBarOpacity(bookingStatus) { return bookingStatus === 'checked_out' ? 0.5 : 1; }
export function isOverlapping(r1, r2) { return r1.roomId === r2.roomId && r1.checkIn < r2.checkOut && r2.checkIn < r1.checkOut; }
export function checkOverlap(reservationList, newRoomId, newCheckIn, newCheckOut, excludeReservationId) {
  return reservationList.find((r) => {
    const candidate = { roomId: r.roomId, checkIn: r.checkIn || r.arrival, checkOut: r.checkOut || r.departure };
    return r.id !== excludeReservationId && isOverlapping(candidate, { roomId: newRoomId, checkIn: newCheckIn, checkOut: newCheckOut });
  }) || null;
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
  available: { fill: '#757B81', label: 'Available' }, booked: { fill: 'var(--action)', label: 'Booked' }, occupied: { fill: '#F56C5A', label: 'Occupied' },
  dirty: { fill: '#B08968', label: 'Dirty' }, cleaning: { fill: '#D9A441', label: 'Cleaning' }, maintenance: { fill: '#8A8371', label: 'Maintenance' },
  out_of_service: { fill: '#5E7180', label: 'Out of Service' }, blocked: { fill: '#3A3A3A', label: 'Blocked' },
};
const channelLabel = { direct: 'Direct', booking_com: 'Booking.com', unknown: 'Unknown' };
const mealLabel = { bed_only: 'Bed Only', bb: 'BB', half_board: 'HB', full_board: 'FB' };
const paymentLabel = { fully_paid: 'Fully Paid', partially_paid: 'Partially Paid', not_paid: 'Not Paid' };

const dateKey = (d) => format(d, 'yyyy-MM-dd');
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

function SelectField({ value, onChange, children, className = '' }) { return <Select value={value} onValueChange={onChange} className={className}>{children}</Select>; }
function InputField({ className = '', ...props }) { return <input {...props} className={`w-full h-10 rounded-lg px-3 text-sm outline-none ${className}`} style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: NAVY }} />; }
function Field({ label, children }) { return <label className="block text-xs font-semibold" style={{ color: NAVY }}>{label}<div className="mt-1">{children}</div></label>; }
function Modal({ title, children, onClose, wide = false, print = false }) { return <div className={`fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4 ${print ? 'print-modal-root' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className={`w-full ${wide ? 'max-w-6xl' : 'max-w-xl'} max-h-[92vh] overflow-y-auto rounded-2xl shadow-2xl`} style={{ background: SURFACE }}><div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 print:hidden" style={{ background: SURFACE, borderBottom: `1px solid ${BORDER}` }}><h2 className="text-base font-bold" style={{ color: NAVY }}>{title}</h2><button onClick={onClose} className="p-2 rounded-lg" style={{ color: MUTED }}><X size={18}/></button></div>{children}</div></div>; }

const emptyForm = (room, date) => ({
  guestName: '', checkIn: dateKey(date), checkOut: dateKey(addDays(date, 1)), paymentStatus: 'not_paid', channel: 'direct', mealPlan: 'bed_only',
  adults: 1, kidsCount: 0, kidsAges: [], totalAmount: Number(room?.base_rate || 0), amountPaid: 0, roomTypeId: room?.room_type_id || '', roomId: room?.id || '', joint: false, selectedRoomIds: room?.id ? [room.id] : [], notes: '',
});


export const MOCK_ROOM_PLANNER_ROOMS = Array.from({length:15},(_,i)=>({id:`mock-room-${i+1}`,number:String(101+i),name:`Room ${101+i}`,room_type_id:`type-${1+(i%3)}`,roomTypeName:['Standard','Deluxe','Suite'][i%3]}));
export const MOCK_ROOM_PLANNER_STAYS = Array.from({length:20},(_,i)=>{
 const base=new Date(); base.setHours(0,0,0,0); const start=new Date(base); start.setDate(base.getDate()-4+(i%16)); const end=new Date(start); end.setDate(start.getDate()+Math.max(1,2+(i%4)));
 const states=['optioned','confirmed','occupied','checkout','checked_out','closed']; const payments=['not_paid','partially_paid','fully_paid'];
 return {id:`mock-stay-${i+1}`,roomId:`mock-room-${(i%15)+1}`,roomNumber:String(101+(i%15)),guestName:['Amina','Brian','Clara','Daniel','Elena'][i%5],checkIn:format(start,'yyyy-MM-dd'),checkOut:format(end,'yyyy-MM-dd'),bookingStatus:states[i%6]==='checked_out'?'checked_out':states[i%6]==='occupied'?'checked_in':'booked',plannerStatus:states[i%6],paymentStatus:payments[i%3],adults:1+(i%3),kidsCount:0,totalAmount:10000+i*750,amountPaid:i%3===0?0:i%3===1?5000:10000};
});

export default function RoomPlanner({ rooms = [], reservations = [], onRefresh }) {
  const plannerRooms = rooms.length ? rooms : MOCK_ROOM_PLANNER_ROOMS;
  const plannerReservations = reservations.length ? reservations : MOCK_ROOM_PLANNER_STAYS;
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const todayDate = useMemo(() => new Date(), []);
  const today = dateKey(todayDate);
  const [month, setMonth] = useState(startOfMonth(todayDate));
  const [range, setRange] = useState(null);
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [rangeError, setRangeError] = useState('');
  const [focusToday, setFocusToday] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm(plannerRooms[0], todayDate));
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
  const [printPreview, setPrintPreview] = useState(false);
  const [printNow, setPrintNow] = useState(false);
  const [closures, setClosures] = useState([]);
  const scrollRef = useRef(null);
  const todayRef = useRef(null);
  const suppressCellClick = useRef(false);

  const normalizedReservations = useMemo(() => plannerReservations.filter(r => r.status !== 'cancelled').map(normalizeReservation), [plannerReservations]);
  const roomTypeMap = useMemo(() => new Map(plannerRooms.map(r => [r.room_type_id, r.roomTypeName || r.room_type || 'Unassigned'])), [plannerRooms]);
  const groupedRooms = useMemo(() => {
    const groups = new Map();
    [...plannerRooms].sort((a,b) => Number(a.number) - Number(b.number)).forEach(r => { const key = roomTypeMap.get(r.room_type_id) || r.roomTypeName || r.room_type || 'Unassigned'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); });
    return [...groups.entries()];
  }, [plannerRooms, roomTypeMap]);

  const columns = useMemo(() => {
    if (range) return eachDayOfInterval({ start: parseDate(range.from), end: parseDate(range.to) });
    const monthDays = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
    if (focusToday && month.getTime() === startOfMonth(todayDate).getTime() && todayDate.getDate() <= 2) {
      return [subDays(startOfMonth(month), 2), subDays(startOfMonth(month), 1), ...monthDays];
    }
    return monthDays;
  }, [range, month, focusToday, todayDate]);

  useEffect(() => {
    if (modal?.reservationId) setLinked(normalizedReservations.filter(r => r.groupId && r.groupId === modal.groupId));
  }, [modal?.reservationId, modal?.groupId, normalizedReservations]);

  useEffect(() => {
    if (!focusToday || range || !scrollRef.current || !todayRef.current) return;
    const timer = setTimeout(() => {
      const target = todayRef.current;
      const desired = Math.max(0, target.offsetLeft - ROOM_COL_WIDTH - (DAY_WIDTH * 2));
      scrollRef.current.scrollLeft = desired;
      setFocusToday(false);
    }, 50);
    return () => clearTimeout(timer);
  }, [columns, focusToday, range]);

  useEffect(() => {
    if (!printNow) return;
    const timer = setTimeout(() => { window.print(); setPrintNow(false); }, 250);
    return () => clearTimeout(timer);
  }, [printNow]);

  const openCreate = (room, date) => { const next = emptyForm(room, date); setForm(next); setFormError(''); setLinked([]); setAddGroupRoomId(''); setModal({ mode: 'create' }); };
  const openEdit = (r) => {
    setForm({ guestName: r.guestName, checkIn: r.checkIn, checkOut: r.checkOut, paymentStatus: r.paymentStatus, channel: r.channel, mealPlan: r.mealPlan, adults: r.adults || 1, kidsCount: r.kidsCount || 0, kidsAges: r.kidsAges || [], totalAmount: r.totalAmount, amountPaid: r.amountPaid, roomTypeId: r.roomTypeId || plannerRooms.find(x => x.id === r.roomId)?.room_type_id || '', roomId: r.roomId, joint: !!r.groupId, selectedRoomIds: [r.roomId], notes: r.notes || '' });
    setFormError(''); setAddGroupRoomId(''); setModal({ mode: 'edit', reservationId: r.id, groupId: r.groupId });
  };

  const validateForm = () => {
    if (!form.guestName.trim()) return 'Guest name is required.';
    if (!form.checkIn || !form.checkOut || form.checkOut <= form.checkIn) return 'Check-out must be after check-in.';
    if (!form.adults || form.adults < 1 || form.adults > 10) return 'Adults must be between 1 and 10.';
    if (form.kidsCount < 0 || form.kidsCount > 6) return 'Kids must be between 0 and 6.';
    if (form.kidsAges.length !== Number(form.kidsCount) || form.kidsAges.some(a => Number(a) < 0 || Number(a) > 17)) return 'Each child age must be between 0 and 17.';
    if (form.paymentStatus === 'fully_paid' && Number(form.amountPaid) !== Number(form.totalAmount)) return 'Fully paid plannerReservations must have Amount Paid equal to Total Amount.';
    if (Number(form.amountPaid) < 0 || Number(form.amountPaid) > Number(form.totalAmount)) return 'Amount Paid must be between 0 and Total Amount.';
    if (form.paymentStatus === 'partially_paid' && Number(form.amountPaid) >= Number(form.totalAmount)) return 'Partially paid must be less than Total Amount.';
    const ids = form.joint ? form.selectedRoomIds : [form.roomId];
    if (!ids.length || ids.some(Boolean) === false) return 'Select at least one room.';
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
        await pmsService.createReservationBundle({ propertyId, groupId: roomIds.length > 1 ? crypto.randomUUID() : null, roomIds, guestName: form.guestName.trim(), checkIn: form.checkIn, checkOut: form.checkOut, paymentStatus: form.paymentStatus, channel: form.channel, mealPlan: form.mealPlan, adults: Number(form.adults), kidsCount: Number(form.kidsCount), kidsAges: form.kidsAges.map(Number), totalAmount: Number(form.totalAmount || 0), amountPaid: Number(form.amountPaid || 0), notes: form.notes });
        toast.success('Reservation created');
      } else {
        await pmsService.updatePlannerReservation(modal.reservationId, { guestName: form.guestName.trim(), roomId: form.roomId, checkIn: form.checkIn, checkOut: form.checkOut, paymentStatus: form.paymentStatus, channel: form.channel, mealPlan: form.mealPlan, adults: Number(form.adults), kidsCount: Number(form.kidsCount), kidsAges: form.kidsAges.map(Number), totalAmount: Number(form.totalAmount || 0), amountPaid: Number(form.amountPaid || 0), notes: form.notes });
        toast.success('Reservation updated');
      }
      setModal(null); onRefresh?.();
    } catch (e) { setFormError(e.message); toast.error(e.message); } finally { setSaving(false); }
  };

  const addLinkedRoom = async () => { if (!modal?.reservationId || !addGroupRoomId) return; try { await pmsService.addRoomToReservationGroup({ reservationId: modal.reservationId, roomId: addGroupRoomId }); toast.success('Room added to joint reservation'); setAddGroupRoomId(''); onRefresh?.(); } catch (e) { toast.error(e.message); } };
  const removeLinkedRoom = async (id) => { if (!confirm('Remove this room from the joint reservation? This deletes only this linked reservation.')) return; try { await pmsService.removeRoomFromReservationGroup(id); toast.success('Room removed'); if (id === modal.reservationId) setModal(null); onRefresh?.(); } catch (e) { toast.error(e.message); } };
  const splitGroup = async () => { if (!modal?.groupId || !confirm('Split this joint reservation into independent plannerReservations?')) return; try { await pmsService.splitReservationGroup(modal.groupId); toast.success('Joint reservation split'); setModal(null); onRefresh?.(); } catch (e) { toast.error(e.message); } };
  const handleDelete = async () => { if (!modal?.reservationId || !confirm('Delete this reservation?')) return; try { await pmsService.deletePlannerReservation(modal.reservationId); toast.success('Reservation deleted'); setModal(null); onRefresh?.(); } catch (e) { toast.error(e.message); } };

  const beginDrag = (e, r) => { e.stopPropagation(); setDrag({ reservation: r, originalRoomId: r.roomId, originalCheckIn: r.checkIn, originalCheckOut: r.checkOut }); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r.id); };
  const handleCellDragOver = (e, room, day) => { if (!drag) return; e.preventDefault(); setDragTarget({ roomId: room.id, date: dateKey(day) }); };
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
    try { await pmsService.movePlannerReservation({ reservationId: reservation.id, roomId: target.roomId, checkIn: target.checkIn, checkOut: target.checkOut }); toast.success('Reservation moved'); setMoveConfirmation(null); onRefresh?.(); } catch (e) { toast.error(e.message); setMoveConfirmation(null); onRefresh?.(); }
  };
  const performGroupMove = async (all) => { const { reservation, target } = groupMoveConfirmation; try { if (!all) await pmsService.movePlannerReservation({ reservationId: reservation.id, roomId: target.roomId, checkIn: target.checkIn, checkOut: target.checkOut }); else await pmsService.moveReservationGroup({ groupId: reservation.groupId, movedReservationId: reservation.id, roomId: target.roomId, checkIn: target.checkIn, checkOut: target.checkOut }); toast.success('Reservation moved'); setGroupMoveConfirmation(null); onRefresh?.(); } catch (e) { toast.error(e.message); setGroupMoveConfirmation(null); onRefresh?.(); } };

  const applyRange = () => {
    setRangeError('');
    if (!fromInput || !toInput) { setRangeError('Select both From and To dates.'); return; }
    if (toInput < fromInput) { setRangeError('To date must be on or after From date.'); return; }
    const days = differenceInCalendarDays(parseDate(toInput), parseDate(fromInput)) + 1;
    if (days > 31) { setRangeError('Max 31 days allowed'); return; }
    if (days < 1) { setRangeError('Minimum range is 1 day.'); return; }
    setRange({ from: fromInput, to: toInput }); setFocusToday(false);
  };
  const addClosure = () => { const room=plannerRooms[0]; if(!room) return; const start=addDays(todayDate,2); const end=addDays(start,2); setClosures(prev=>[...prev,{id:`closure-${Date.now()}`,roomId:room.id,start:dateKey(start),end:dateKey(end),label:'Out of order'}]); toast.success(`Closure added to Room ${room.number}`); };
  const clearRange = () => { setRange(null); setRangeError(''); setFromInput(''); setToInput(''); setMonth(startOfMonth(todayDate)); setFocusToday(true); };
  const goToday = () => { setRange(null); setFromInput(''); setToInput(''); setMonth(startOfMonth(todayDate)); setFocusToday(true); };
  const shiftMonth = (delta) => { setRange(null); setFocusToday(false); setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1)); };

  const visibleReservation = (rv) => {
    const arrival = parseDate(rv.checkIn), departure = parseDate(rv.checkOut); if (!arrival || !departure) return null;
    const viewStart = columns[0], viewEndExclusive = addDays(columns[columns.length - 1], 1);
    if (departure <= viewStart || arrival >= viewEndExclusive) return null;
    const clippedStart = arrival < viewStart ? viewStart : arrival;
    const clippedEnd = departure > viewEndExclusive ? viewEndExclusive : departure;
    return { start: differenceInCalendarDays(clippedStart, viewStart), span: Math.max(1, differenceInCalendarDays(clippedEnd, clippedStart)) };
  };

  const openFolio = async (rv) => {
    if (rv.groupId) { setActionModal({ type: 'groupFolioChoice', reservation: rv }); return; }
    try { const data = await pmsService.getFolio(rv.id); setFolio({ reservation: rv, ...data }); setActionModal({ type: 'folio', reservation: rv }); } catch (e) { toast.error(e.message); }
  };
  const openRoomFolio = async (rv, entireGroup = false) => {
    if (entireGroup && rv.groupId) { setActionModal(null); setFolio({ reservation: rv, group: normalizedReservations.filter(x => x.groupId === rv.groupId) }); setActionModal({ type: 'groupFolio', reservation: rv }); return; }
    try { const data = await pmsService.getFolio(rv.id); setFolio({ reservation: rv, ...data }); setActionModal({ type: 'folio', reservation: rv }); } catch (e) { toast.error(e.message); }
  };
  const submitCharge = async () => { const rv = actionModal.reservation; const amount = Number(chargeAmount); if (!(amount > 0)) { toast.error('Enter a charge amount greater than 0.'); return; } try { await pmsService.chargeToRoom({ propertyId, reservationId: rv.id, description: chargeDescription || 'Room charge', amount }); toast.success(`KES ${amount.toLocaleString()} posted to Room ${rv.roomNumber || plannerRooms.find(x => x.id === rv.roomId)?.number}`); setActionModal(null); } catch (e) { toast.error(e.message); } };

  const printRange = range ? columns : columns.slice(0, PRINT_MAX_DAYS);
  const printTitle = `${user?.property?.name || 'OliTechs Grand Hotel'} - Room Planner - ${format(printRange[0], 'd MMM')} - ${format(printRange[printRange.length - 1], 'd MMM yyyy')}`;
  const printSubtitle = `Printed by ${user?.full_name || user?.name || user?.email || 'Staff'} on ${format(new Date(), 'd MMM yyyy HH:mm')}`;
  const downloadPdf = async () => {
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const node = document.getElementById('room-planner-print-grid'); if (!node) return;
      const canvas = await html2canvas(node, { scale: 2, backgroundColor: 'var(--surface)', useCORS: true });
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const ratio = Math.min(277 / canvas.width, 190 / canvas.height); pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10, 10, canvas.width * ratio, canvas.height * ratio); pdf.save(`room-planner-${printRange[0].toISOString().slice(0,10)}-${printRange[printRange.length-1].toISOString().slice(0,10)}.pdf`);
    } catch (e) { toast.error(`Could not create PDF: ${e.message}`); }
  };

  return <div className="flex flex-col h-full min-h-0" style={{ background: SAND }}>
    <style>{`@media print { @page { size: landscape; margin: 8mm; } body * { visibility: hidden !important; } #room-planner-print-grid, #room-planner-print-grid * { visibility: visible !important; } #room-planner-print-grid { position: absolute; left: 0; top: 0; width: 100%; } .print-hidden { display:none !important; } .print-color-exact { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } } .reservation-bar { display:flex; align-items:center; padding:0 8px; font-size:11px; font-weight:700; border-radius:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-height:24px; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }`}</style>
    <div className="px-4 pt-3 pb-2 shrink-0 print-hidden">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'var(--text)', border: `1px solid var(--text)`, color: 'var(--action)' }}><CalendarDays size={17}/><span className="font-bold text-sm">Room Planner</span></div>
        <button onClick={() => shiftMonth(-1)} className="p-2 rounded-xl font-bold" style={{background:'var(--surface)',border:`1px solid var(--text)`,color:'var(--text)'}}><ChevronLeft size={18}/></button>
        <button onClick={goToday} className="px-4 py-2 rounded-xl text-xs font-black" style={{background:'var(--action)',border:`1px solid var(--text)`,color:'var(--text)'}}>Today</button>
        <button onClick={() => shiftMonth(1)} className="p-2 rounded-xl font-bold" style={{background:'var(--surface)',border:`1px solid var(--text)`,color:'var(--text)'}}><ChevronRight size={18}/></button>
        <div className="text-lg font-bold ml-1" style={{color:NAVY}}>{range ? `${format(parseDate(range.from),'d MMM yyyy')} – ${format(parseDate(range.to),'d MMM yyyy')}` : format(month,'MMMM yyyy')}</div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-xl" style={{background:'var(--surface)',border:`2px solid var(--text)`}}><span className="text-xs font-black" style={{color:'var(--text)'}}>From</span><InputField type="date" value={fromInput} onChange={e=>setFromInput(e.target.value)} className="w-[135px] h-8"/><span className="text-xs font-black" style={{color:'var(--text)'}}>To</span><InputField type="date" value={toInput} onChange={e=>setToInput(e.target.value)} className="w-[135px] h-8"/><button onClick={applyRange} className="px-4 h-8 rounded-lg text-xs font-black" style={{background:'var(--action)',color:'var(--text)',border:'1px solid var(--text)'}}>Apply</button><button onClick={clearRange} className="px-3 h-8 rounded-lg text-xs font-bold" style={{background:'var(--surface)',border:`1px solid var(--text)`,color:'var(--text)'}}>Clear</button></div>
          {onRefresh && <button title="Refresh" onClick={onRefresh} className="p-2 rounded-xl" style={{background:'var(--surface)',border:`1px solid var(--text)`,color:'var(--text)'}}><RefreshCw size={16}/></button>}
          <button title="Print Calendar" onClick={()=>setPrintPreview(true)} className="p-2 rounded-xl" style={{background:'var(--surface)',border:`1px solid var(--text)`,color:'var(--text)'}}><Printer size={16}/></button>
          <button onClick={() => openCreate(plannerRooms[0], range ? parseDate(range.from) : todayDate)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black" style={{background:'var(--action)',color:'var(--text)',border:'2px solid var(--text)'}}><Plus size={15}/> Add Booking</button>
        </div>
      </div>
      {rangeError && <div className="mt-2 flex items-center gap-2 text-xs font-semibold" style={{color:DESTRUCTIVE}}><AlertTriangle size={14}/>{rangeError}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-bold" style={{color:'var(--text)'}}>
        <span>{plannerRooms.length} rooms · {normalizedReservations.length} active stays</span><span className="opacity-60">Guest names appear on each stay bar · click to open reservation · drag to move</span>
      </div>
    </div>

    <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto px-4 pb-4 print-hidden">
      <div className="rounded-xl overflow-hidden shadow-sm" style={{background:'var(--surface)',border:`1px solid var(--border)`, minWidth: `${ROOM_COL_WIDTH + columns.length * DAY_WIDTH}px`}}>
        <div className="grid sticky top-0 z-40" style={{gridTemplateColumns:`${ROOM_COL_WIDTH}px repeat(${columns.length}, ${DAY_WIDTH}px)`}}>
          <div className="sticky left-0 z-50 px-3 py-2 text-xs font-black uppercase tracking-wide flex items-center" style={{background:'var(--text)',color:'var(--action)',borderRight:`2px solid var(--text)`,borderBottom:`2px solid var(--text)`}}>Rooms</div>
          {columns.map((d,i)=>{const weekend=d.getDay()===0||d.getDay()===6;const isT=dateKey(d)===today;return <div key={dateKey(d)} ref={isT?todayRef:null} className="text-center py-1 relative" style={{background:isT?'var(--action)':weekend?'var(--grid-weekend)':'var(--surface)',color:'var(--text)',borderRight:`1px solid var(--border)`,borderBottom:`2px solid var(--text)`,height:52, fontWeight: isT?900:600}}><div className="text-[10px] uppercase font-black">{format(d,'EEE')}</div><div className="text-sm font-black">{d.getDate()}</div><div className="text-[9px]">{format(d,'MMM')}</div>{isT&&<span className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 text-[8px] px-2 py-0.5 rounded-full font-black" style={{background:'var(--text)',color:'var(--action)',border:'1px solid var(--action)'}}>TODAY</span>}</div>})}
        </div>

        {groupedRooms.map(([typeName, group])=><React.Fragment key={typeName}>
          {group.map(room=>{const roomReservations=normalizedReservations.filter(r=>r.roomId===room.id); return <div key={room.id} className="grid relative" style={{gridTemplateColumns:`${ROOM_COL_WIDTH}px repeat(${columns.length}, ${DAY_WIDTH}px)`, minHeight: 44}}>
            <div className="sticky left-0 z-20 px-3 py-2 flex items-center gap-2" style={{background:'var(--surface)',borderRight:`2px solid var(--text)`,borderBottom:`1px solid var(--border)`}}><div><div className="flex items-center gap-2"><div className="font-black text-[13px]" style={{color:'var(--text)'}}>{room.number}</div><span className="rounded-full px-1.5 py-0.5 text-[9px] font-black" style={{background:'var(--bg)',color:'var(--muted)'}}>{roomReservations.length} stay{roomReservations.length===1?'':'s'}</span></div><div className="text-[10px] font-semibold truncate max-w-[160px]" style={{color:'var(--muted)'}}>{room.name || typeName}</div></div></div>
            {columns.map(d=>{const weekend=d.getDay()===0||d.getDay()===6;const key=dateKey(d);const target=dragTarget?.roomId===room.id&&dragTarget?.date===key;return <div key={key} onClick={()=>{if(!drag&&!suppressCellClick.current)openCreate(room,d)}} onDragOver={e=>handleCellDragOver(e,room,d)} onDrop={e=>handleCellDrop(e,room,d)} className="cursor-pointer" style={{background:target?'rgba(255,211,0,.25)':weekend?'var(--grid-weekend)':key===today?'rgba(255,211,0,.12)':'var(--surface)',borderRight:`1px solid var(--border)`,borderBottom:`1px solid var(--border)`, minHeight:44}}/>})}
            {roomReservations.map(rv=>{
              const l=visibleReservation(rv);if(!l)return null;
              const stayStatus=rv.plannerStatus || (rv.bookingStatus==='checked_out'?'checked_out':rv.bookingStatus==='checked_in'?'occupied':'confirmed');
              const ps=getReservationBarStyle(stayStatus); const pay=getPaymentStyle(rv.paymentStatus);
              const checked=rv.bookingStatus==='checked_out';
              const left=ROOM_COL_WIDTH+l.start*DAY_WIDTH+4;
              const width=Math.max(DAY_WIDTH*l.span-8,100);
              return <div key={rv.id} draggable onDragStart={e=>beginDrag(e,rv)} onDragEnd={()=>{setDrag(null);setDragTarget(null)}} onClick={e=>{e.stopPropagation();openEdit(rv)}} className="reservation-bar absolute top-[6px] h-[32px] cursor-grab active:cursor-grabbing group print-color-exact" style={{left,width,background:ps.background,color:ps.color,border:`1.5px ${stayStatus==='optioned'?'dashed':'solid'} ${ps.border}`,borderLeft:`4px solid ${pay.border}`,opacity:getBarOpacity(rv.bookingStatus),zIndex:10}} title={`${rv.guestName} · ${ps.label} · ${rv.checkIn} → ${rv.checkOut}`}>
              <span className="truncate font-black text-[11px]" title={`${rv.guestName} · ${rv.checkIn} → ${rv.checkOut}`}>{rv.guestName || 'Guest'}</span><span className="ml-1.5 shrink-0 text-[10px] opacity-90 font-bold">{formatGuests(rv)}</span>
              <span className="ml-auto hidden group-hover:flex items-center gap-1 print:hidden"><button onClick={e=>{e.stopPropagation();openFolio(rv)}} className="w-5 h-5 rounded flex items-center justify-center" style={{background:'rgba(0,0,0,0.2)'}}><BedDouble size={10}/></button></span>
            </div>})}
          </div>})}
        </React.Fragment>)}

        <div className="grid sticky bottom-0 z-30" style={{gridTemplateColumns:`${ROOM_COL_WIDTH}px repeat(${columns.length}, ${DAY_WIDTH}px)`,background:'var(--bg)',borderTop:'2px solid var(--text)'}}>
          {['arrivals','inHouse','checkOuts'].map((kind,idx)=><React.Fragment key={kind}><div className="sticky left-0 z-40 px-3 py-2 text-xs font-black" style={{background:'var(--text)',color:'var(--action)',borderBottom:idx===2?'none':`1px solid var(--border)`}}>{kind==='arrivals'?'Arrivals':kind==='inHouse'?'In-House':'Departures'}</div>{columns.map(d=>{const s=calculateDailyStats(normalizedReservations,d);const value=s[kind];return <div key={`${kind}-${dateKey(d)}`} className="text-center py-2 text-xs font-black" style={{color:'var(--text)',background:'var(--surface)',borderRight:`1px solid var(--border)`,borderBottom:idx===2?'none':`1px solid var(--border)`}}>{value}</div>})}</React.Fragment>)}
        </div>
      </div>
    </div>

    {modal && <Modal wide title={modal.mode==='create'?'New Reservation':'Edit Reservation'} onClose={()=>setModal(null)}><div className="p-5 space-y-4">
      {modal.mode==='edit'&&form.joint&&<div className="rounded-xl p-3" style={{background:'rgba(255,211,0,.12)',border:`1px solid ${TEAL}`,color:NAVY}}><div className="flex items-start gap-2"><Link2 size={17}/><div className="flex-1"><div className="font-bold text-sm">Joint Reservation - Group #{String(modal.groupId).slice(0,6).toUpperCase()} - {linked.length} plannerRooms linked</div></div><button onClick={splitGroup} className="text-xs font-bold px-2 py-1 rounded-lg" style={{border:`1px solid ${BORDER}`}}>Split Group</button></div></div>}
      <Field label="Guest Name"><InputField value={form.guestName} onChange={e=>setForm({...form,guestName:e.target.value})} autoFocus placeholder="Guest full name"/></Field>
      <div className="grid md:grid-cols-2 gap-3"><Field label="Check-in"><InputField type="date" value={form.checkIn} onChange={e=>setForm({...form,checkIn:e.target.value})}/></Field><Field label="Check-out (exclusive)"><InputField type="date" value={form.checkOut} min={form.checkIn} onChange={e=>setForm({...form,checkOut:e.target.value})}/></Field></div>
      {formError&&<div className="text-xs p-3 rounded-lg" style={{background:'#FDECEC',color:DESTRUCTIVE}}>{formError}</div>}
      <Field label="Payment Status"><div className="grid grid-cols-3 gap-2">{PAYMENT_STATUS.map(s=><button type="button" key={s} onClick={()=>setForm({...form,paymentStatus:s})} className="py-2 rounded-lg text-xs font-black" style={{background:form.paymentStatus===s?getPaymentStyle(s).background:SURFACE2,color:form.paymentStatus===s?getPaymentStyle(s).color:NAVY,border:`1.5px solid ${getPaymentStyle(s).border}`}}>{paymentLabel[s]}</button>)}</div></Field>
      <div className="grid md:grid-cols-2 gap-3"><Field label="Reservation Channel"><SelectField value={form.channel} onChange={v=>setForm({...form,channel:v})}><option value="direct">Direct</option><option value="booking_com">Booking.com</option><option value="unknown">Unknown</option></SelectField></Field><Field label="Meal Plan"><SelectField value={form.mealPlan} onChange={v=>setForm({...form,mealPlan:v})}><option value="bed_only">Bed Only</option><option value="bb">BB</option><option value="half_board">HB</option><option value="full_board">FB</option></SelectField></Field></div>
      <div className="grid md:grid-cols-2 gap-3"><Field label="Total Amount"><InputField type="number" min="0" step="0.01" value={form.totalAmount} onChange={e=>setForm({...form,totalAmount:e.target.value})}/></Field><Field label="Amount Paid"><InputField type="number" min="0" step="0.01" value={form.amountPaid} onChange={e=>setForm({...form,amountPaid:e.target.value})}/></Field></div>
      <div className="flex items-center justify-between pt-2"><div>{modal.mode==='edit'&&<button onClick={handleDelete} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold" style={{color:DESTRUCTIVE,border:`1px solid ${DESTRUCTIVE}`}}><Trash2 size={14}/> Delete</button>}</div><div className="flex gap-2"><button onClick={()=>setModal(null)} className="px-4 py-2.5 rounded-xl text-sm" style={{border:`1px solid ${BORDER}`,color:MUTED}}>Cancel</button><button disabled={saving} onClick={saveReservation} className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-60" style={{background:'var(--action)',color:'var(--text)',border:'1px solid var(--text)'}}><Save size={15}/>{saving?'Saving…':'Save'}</button></div></div>
    </div></Modal>}

    {moveConfirmation&&<Modal title="Confirm Move Reservation?" onClose={()=>setMoveConfirmation(null)}><div className="p-5"><p className="text-sm leading-6" style={{color:NAVY}}>Move reservation <strong>“{moveConfirmation.reservation.guestName}”</strong> from Room {plannerRooms.find(r=>r.id===moveConfirmation.reservation.roomId)?.number} ({moveConfirmation.reservation.checkIn}–{moveConfirmation.reservation.checkOut}) to Room {plannerRooms.find(r=>r.id===moveConfirmation.target.roomId)?.number} ({moveConfirmation.target.checkIn}–{moveConfirmation.target.checkOut})?</p><div className="flex justify-end gap-2 mt-5"><button onClick={()=>setMoveConfirmation(null)} className="px-4 py-2 rounded-lg" style={{border:`1px solid ${BORDER}`}}>Cancel</button><button onClick={()=>confirmMove(!!moveConfirmation.reservation.groupId)} className="px-4 py-2 rounded-lg font-bold" style={{background:TEAL,color:'var(--text)'}}>Confirm Move</button></div></div></Modal>}
    {groupMoveConfirmation&&<Modal title="Joint Reservation" onClose={()=>setGroupMoveConfirmation(null)}><div className="p-5"><p className="text-sm" style={{color:NAVY}}>This is part of a joint reservation. Move only this room or all plannerRooms in the group?</p><div className="flex justify-end gap-2 mt-5"><button onClick={()=>performGroupMove(false)} className="px-4 py-2 rounded-lg" style={{border:`1px solid ${BORDER}`}}>Move only this room</button><button onClick={()=>performGroupMove(true)} className="px-4 py-2 rounded-lg font-bold" style={{background:TEAL,color:'var(--text)'}}>Move entire group</button></div></div></Modal>}

    {actionModal?.type==='groupFolioChoice'&&<Modal title="Joint Reservation Folio" onClose={()=>setActionModal(null)}><div className="p-5"><p className="text-sm" style={{color:NAVY}}>This reservation is part of a joint reservation. Open the folio for this room only or the entire group?</p><div className="flex justify-end gap-2 mt-5"><button onClick={()=>openRoomFolio(actionModal.reservation,false)} className="px-4 py-2 rounded-lg" style={{border:`1px solid ${BORDER}`}}>This room only</button><button onClick={()=>openRoomFolio(actionModal.reservation,true)} className="px-4 py-2 rounded-lg font-bold" style={{background:TEAL,color:'var(--text)'}}>Entire group</button></div></div></Modal>}
    {actionModal?.type==='folio'&&folio&&<Modal title={`PMS Folio · Room ${folio.reservation.roomNumber || plannerRooms.find(x=>x.id===folio.reservation.roomId)?.number || ''}`} onClose={()=>setActionModal(null)}><div className="p-5"><div className="flex items-center gap-3 mb-4"><BedDouble size={20} style={{color:TEAL}}/><div><div className="font-bold" style={{color:NAVY}}>{folio.reservation.guestName}</div><div className="text-xs" style={{color:MUTED}}>Meal plan: {mealLabel[folio.reservation.mealPlan]}</div></div></div><div className="rounded-xl overflow-hidden" style={{border:`1px solid ${BORDER}`}}>{(folio.charges||[]).map(c=><div key={c.id} className="flex justify-between px-3 py-2 text-sm" style={{borderBottom:`1px solid ${BORDER}`}}><span>{c.description}</span><b>KES {Number(c.amount).toLocaleString()}</b></div>)}{!folio.charges?.length&&<div className="p-5 text-sm text-center" style={{color:MUTED}}>No folio charges yet.</div>}</div><div className="flex justify-end mt-4"><button onClick={()=>setActionModal(null)} className="px-4 py-2 rounded-lg font-bold" style={{background:TEAL,color:'var(--text)'}}>Close</button></div></div></Modal>}
    {actionModal?.type==='groupFolio'&&<Modal title="Joint Reservation Folio" onClose={()=>setActionModal(null)}><div className="p-5"><p className="text-sm mb-3" style={{color:NAVY}}>Group #{String(actionModal.reservation.groupId).slice(0,6).toUpperCase()}</p><div className="space-y-2">{folio?.group?.map(r=><div key={r.id} className="flex justify-between p-3 rounded-lg" style={{background:SURFACE2}}><span className="text-sm">Room {r.roomNumber || plannerRooms.find(x=>x.id===r.roomId)?.number} · {r.guestName}</span><span className="text-xs" style={{color:MUTED}}>{mealLabel[r.mealPlan]}</span></div>)}</div></div></Modal>}
    {actionModal?.type==='charge'&&<Modal title={`Post Room Charge · Room ${actionModal.reservation.roomNumber || plannerRooms.find(x=>x.id===actionModal.reservation.roomId)?.number || ''}`} onClose={()=>setActionModal(null)}><div className="p-5 space-y-4"><div className="rounded-xl p-3" style={{background:SURFACE2}}><div className="font-bold text-sm" style={{color:NAVY}}>{actionModal.reservation.guestName}</div><div className="text-xs mt-1" style={{color:MUTED}}>Meal Plan: {mealLabel[actionModal.reservation.mealPlan] || 'Bed Only'}</div></div><Field label="Description"><InputField value={chargeDescription} onChange={e=>setChargeDescription(e.target.value)}/></Field><Field label="Amount (KES)"><InputField type="number" min="0.01" step="0.01" value={chargeAmount} onChange={e=>setChargeAmount(e.target.value)} autoFocus/></Field><div className="flex justify-end gap-2"><button onClick={()=>setActionModal(null)} className="px-4 py-2 rounded-lg" style={{border:`1px solid ${BORDER}`}}>Cancel</button><button onClick={submitCharge} className="px-4 py-2 rounded-lg font-bold" style={{background:TEAL,color:'var(--text)'}}>Post Charge</button></div></div></Modal>}

    {printPreview&&<Modal wide title="Print Calendar Preview" onClose={()=>setPrintPreview(false)} print><div className="p-5"><div className="mb-4"><h1 className="text-lg font-bold" style={{color:NAVY}}>{printTitle}</h1><p className="text-xs mt-1" style={{color:MUTED}}>{printSubtitle}</p>{!range&&columns.length>PRINT_MAX_DAYS&&<p className="text-xs mt-1" style={{color:'var(--warning)'}}>Print preview is limited to the first 30 days of the current month.</p>}</div><PrintGrid plannerRooms={plannerRooms} groupedRooms={groupedRooms} plannerReservations={normalizedReservations} columns={printRange}/><div className="flex justify-end gap-2 mt-4 print:hidden"><button onClick={()=>setPrintPreview(false)} className="px-4 py-2 rounded-lg" style={{border:`1px solid ${BORDER}`}}>Close</button><button onClick={downloadPdf} className="flex items-center gap-2 px-4 py-2 rounded-lg" style={{border:`1px solid ${BORDER}`,color:NAVY}}><Download size={15}/> Download PDF</button><button onClick={()=>setPrintNow(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold" style={{background:TEAL,color:'var(--text)'}}><Printer size={15}/> Print</button></div></div></Modal>}

    <div className="px-4 py-3 flex items-center gap-3 text-xs font-black border-t-2 print-hidden" style={{background:'var(--surface)',borderColor:'var(--text)'}}>
      <span className="flex items-center gap-1.5"><i className="w-4 h-4 rounded" style={{background:'var(--pay-none)'}}/> Not Paid</span>
      <span className="flex items-center gap-1.5"><i className="w-4 h-4 rounded" style={{background:'var(--pay-partial)'}}/> Partially Paid</span>
      <span className="flex items-center gap-1.5"><i className="w-4 h-4 rounded" style={{background:'var(--pay-total)'}}/> Fully Paid</span>
      <span className="ml-auto text-[11px] font-bold" style={{color:MUTED}}>{plannerRooms.length} plannerRooms · {normalizedReservations.length} plannerReservations</span>
    </div>
  </div>;
}

function PrintGrid({ rooms, groupedRooms, reservations, columns }) {
  const roomWidth = 130; const dayWidth = Math.max(48, Math.floor(770 / Math.max(1, columns.length)));
  return <div id="room-planner-print-grid" className="print-color-exact" style={{background:'#fff',color:'#111',fontSize:8}}>
    <div style={{display:'grid',gridTemplateColumns:`${roomWidth}px repeat(${columns.length},${dayWidth}px)`}}>
      <div style={{background:'var(--text)',color:'#fff',fontWeight:700,padding:'5px'}}>ROOM</div>{columns.map(d=><div key={dateKey(d)} style={{background:d.getDay()===0||d.getDay()===6?'var(--surface)':'#262B32',color:d.getDay()===0||d.getDay()===6?'var(--text)':'#fff',textAlign:'center',padding:'5px 1px',fontWeight:700}}>{format(d,'EE').slice(0,2)}<br/>{format(d,'d MMM')}</div>)}
      {groupedRooms.map(([type, group])=><React.Fragment key={type}><div style={{gridColumn:'1 / -1',background:'var(--bg)',fontWeight:700,padding:'4px'}}>{type}</div>{group.map(room=>{const rs=reservations.filter(r=>r.roomId===room.id && r.checkIn<dateKey(addDays(columns[columns.length-1],1)) && r.checkOut>dateKey(columns[0]));return <React.Fragment key={room.id}><div style={{padding:'4px',borderBottom:'1px solid #ddd',fontWeight:700}}>Room {room.number}</div>{columns.map(d=>{const rv=rs.find(r=>r.checkIn<=dateKey(d)&&r.checkOut>dateKey(d));const ps=rv?getReservationBarStyle(rv.paymentStatus):null;return <div key={dateKey(d)} className="print-color-exact" style={{minHeight:32,padding:'3px',borderLeft:'1px solid #ddd',borderBottom:'1px solid #ddd',background:rv?(ps.background):((d.getDay()===0||d.getDay()===6)?'var(--surface)':'#fff'),color:rv?ps.color:'var(--text)',fontWeight:rv?700:400,opacity:rv?.bookingStatus==='checked_out'?0.45:1}}>{rv&&rv.checkIn===dateKey(d)?rv.guestName:''}</div>})}</React.Fragment>})}</React.Fragment>)}
      <div style={{gridColumn:'1 / -1',borderTop:'2px solid var(--action)',background:'#202020',padding:'4px',fontWeight:700}}>Daily Summary</div>
      {['arrivals','inHouse','checkOuts'].map(kind=><React.Fragment key={kind}><div style={{background:'#202020',color:'var(--surface)',padding:'3px',fontWeight:700}}>{kind==='arrivals'?'Arrivals':kind==='inHouse'?'In-House':'Check-Outs'}</div>{columns.map(d=>{const s=calculateDailyStats(reservations,d);const v=s[kind];return <div key={`${kind}-${dateKey(d)}`} style={{background:'#202020',textAlign:'center',padding:'3px',fontWeight:v?700:400,color:v?(kind==='arrivals'?'var(--action)':kind==='inHouse'?'var(--surface)':'#757B81'):'#757B81'}}>{v}</div>})}</React.Fragment>)}
    </div>
  </div>;
}
