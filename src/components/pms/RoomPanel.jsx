import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { walkInCheckInSchema } from '@/validation/pmsSchemas';
import { X, User, Phone, Calendar, DoorOpen, LogOut } from 'lucide-react';
import { usePms } from '@/data/PmsStore';
import { NAVY, TEAL, DESTRUCTIVE, SAND, SURFACE, SURFACE2, BORDER, MUTED } from '@/data/palette';

function fmtKes(n) {
	return `KES ${Number(n || 0).toLocaleString('en-KE')}`;
}

export default function RoomPanel({ room, onClose }) {
	const pms = usePms();
	const { register, handleSubmit, formState: { errors }, setError } = useForm({
		resolver: zodResolver(walkInCheckInSchema),
		defaultValues: { name: '', phone: '', checkIn: '', checkOut: '', partySize: 1, rate: room?.guest?.rate || 0 },
	});

	if (!room) return null;

	const isAvailable = room.status === 'available';
	const isBooked = room.status === 'booked';
	const isOccupied = room.status === 'occupied';
	const isHousekeepingState = ['dirty', 'cleaning', 'maintenance', 'out_of_service', 'blocked'].includes(room.status);

	const submitCheckIn = async (data) => {
		try {
			await pms.checkInRoom(room.id, data);
			onClose();
		} catch (error) {
			setError('root', { type: 'server', message: error?.message || 'Could not check in guest.' });
		}
	};
	const handleCheckOut = () => {
		pms.checkOutRoom(room.id);
		onClose();
	};

	const setStatus = (status) => {
		pms.setRoomStatus(room.id, status);
		onClose();
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(14,39,64,0.6)' }}>
			<div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
				<div className="flex items-center justify-between px-5 py-3" style={{ background: NAVY }}>
					<div className="text-sm font-semibold" style={{ color: SAND }}>
						Room {room.number} · {room.roomTypeName || room.room_type || 'Unassigned'} · Floor {room.floor}
					</div>
					<button onClick={onClose} aria-label="Close">
						<X size={16} style={{ color: 'rgba(234,227,210,0.7)' }} />
					</button>
				</div>

				<div className="p-5">
					{(isOccupied || isBooked) && room.guest && (
						<div className="mb-5 rounded-xl p-4" style={{ background: SURFACE2, border: `1px solid ${BORDER}` }}>
							<div className="flex items-center gap-2 mb-2">
								<User size={14} style={{ color: MUTED }} />
								<span className="text-sm font-semibold" style={{ color: NAVY }}>{room.guest.name}</span>
							</div>
							<div className="flex items-center gap-2 mb-2 text-xs" style={{ color: MUTED }}>
								<Phone size={12} /> {room.guest.phone}
							</div>
							<div className="flex items-center gap-2 mb-2 text-xs" style={{ color: MUTED }}>
								<Calendar size={12} /> {room.guest.checkIn} → {room.guest.checkOut}
							</div>
							<div className="flex items-center justify-between text-xs mt-3" style={{ color: MUTED }}>
								<span>Party of {room.guest.partySize}</span>
								<span className="font-mono font-bold" style={{ color: NAVY }}>{fmtKes(room.guest.rate)}/night</span>
							</div>
						</div>
					)}

					{isOccupied && (
						<button
							onClick={handleCheckOut}
							className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold"
							style={{ background: DESTRUCTIVE, color: '#fff' }}
						>
							<LogOut size={16} /> Check Out
						</button>
					)}

					{isBooked && (
						<button
							onClick={() => pms.checkInReservation(room.reservationId) || onClose()}
							className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold"
							style={{ background: TEAL, color: '#090C11' }}
						>
							<DoorOpen size={16} /> Check In Now
						</button>
					)}

					{isHousekeepingState && (
						<div className="space-y-2 mb-2">
							<div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: MUTED }}>
								Housekeeping — currently {room.status.replace('_', ' ')}
							</div>
							{room.status === 'dirty' && (
								<button onClick={() => setStatus('cleaning')} className="w-full py-2.5 rounded-xl text-sm font-bold" style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: NAVY }}>
									Start Cleaning
								</button>
							)}
							{(room.status === 'dirty' || room.status === 'cleaning') && (
								<button onClick={() => setStatus('available')} className="w-full py-2.5 rounded-xl text-sm font-bold" style={{ background: TEAL, color: '#090C11' }}>
									Mark Clean &amp; Available
								</button>
							)}
							{room.status !== 'maintenance' && room.status !== 'out_of_service' && (
								<button onClick={() => setStatus('maintenance')} className="w-full py-2.5 rounded-xl text-sm font-semibold" style={{ background: SURFACE, border: `1px solid ${BORDER}`, color: DESTRUCTIVE }}>
									Send to Maintenance
								</button>
							)}
							{(room.status === 'maintenance' || room.status === 'out_of_service' || room.status === 'blocked') && (
								<button onClick={() => setStatus('available')} className="w-full py-2.5 rounded-xl text-sm font-bold" style={{ background: TEAL, color: '#090C11' }}>
									Return to Service
								</button>
							)}
						</div>
					)}

					{isAvailable && (
						<>
							<div className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: MUTED }}>Walk-in Check-in</div>

							<label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Guest name *</label>
							<input
								{...register('name')}
								className="w-full px-3 py-2.5 rounded-lg mb-3 text-sm outline-none"
								style={{ background: SURFACE2, border: `1.5px solid ${BORDER}`, color: NAVY }}
							/>

							<label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Phone *</label>
							<input
								{...register('phone')}
								className="w-full px-3 py-2.5 rounded-lg mb-3 text-sm outline-none"
								style={{ background: SURFACE2, border: `1.5px solid ${BORDER}`, color: NAVY }}
							/>

							<div className="grid grid-cols-2 gap-3 mb-3">
								<div>
									<label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Check-in *</label>
									<input
										type="date" {...register('checkIn')}
										className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
										style={{ background: SURFACE2, border: `1.5px solid ${BORDER}`, color: NAVY }}
									/>
								</div>
								<div>
									<label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Check-out *</label>
									<input
										type="date" {...register('checkOut')}
										className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
										style={{ background: SURFACE2, border: `1.5px solid ${BORDER}`, color: NAVY }}
									/>
								</div>
							</div>

							<div className="grid grid-cols-2 gap-3 mb-4">
								<div>
									<label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Party size</label>
									<input
										type="number" min="1" {...register('partySize')}
										className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
										style={{ background: SURFACE2, border: `1.5px solid ${BORDER}`, color: NAVY }}
									/>
								</div>
								<div>
									<label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Rate/night</label>
									<input
										type="number" min="0" {...register('rate')}
										placeholder="KES"
										className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
										style={{ background: SURFACE2, border: `1.5px solid ${BORDER}`, color: NAVY }}
									/>
								</div>
							</div>

							{(Object.keys(errors).length > 0) && <div className="text-xs mb-3" style={{ color: DESTRUCTIVE }} role="alert">{errors.root?.message || errors.name?.message || errors.phone?.message || errors.checkIn?.message || errors.checkOut?.message || errors.rate?.message}</div>}

							<button
								onClick={handleSubmit(submitCheckIn)}
								className="w-full py-3 rounded-xl text-sm font-bold"
								style={{ background: TEAL, color: '#090C11' }}
							>
								Check In
							</button>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
