import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { usePms } from '@/data/PmsStore';
import RoomPanel from '@/components/pms/RoomPanel';
import RoomManagement from '@/components/pms/RoomManagement';
import RoomPlanner from '@/components/pms/RoomPlanner';
import { NAVY, TEAL, SURFACE, SURFACE2, BORDER, MUTED, DESTRUCTIVE } from '@/data/palette';

export default function Rooms() {
  const pms = usePms();
  const { pathname } = useLocation();
  const isDedicatedPlanner = /^\/frontoffice\/room-planner\/?$/.test(pathname);
  const [tab, setTab] = useState('planner');
  const [openRoom, setOpenRoom] = useState(null);
  const [actionError, setActionError] = useState('');

  const runAction = async (action) => {
    setActionError('');
    try { await action(); }
    catch (error) { setActionError(error?.message || 'The operation failed.'); }
  };

  return (
    <div className={`flex h-full min-h-0 w-full flex-col overflow-hidden ${isDedicatedPlanner ? 'h-[100dvh]' : ''}`} style={{ background: 'var(--bg)' }}>
      {!isDedicatedPlanner && (
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
          {['planner', 'reservations', 'management'].map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className="min-h-11 shrink-0 rounded-xl px-4 text-xs font-medium"
              style={{ background: tab === t ? 'var(--action)' : 'transparent', color: tab === t ? 'var(--action-text)' : 'var(--muted)', border: `1px solid ${tab === t ? 'var(--action)' : 'var(--border)'}` }}>
              {t === 'planner' ? 'Room Planner' : t === 'reservations' ? 'Reservations' : 'Room Types & Setup'}
            </button>
          ))}
          <div className="ml-auto hidden shrink-0 text-xs font-medium lg:block" style={{ color: 'var(--muted)' }}>Room operations</div>
        </div>
      )}

      {(isDedicatedPlanner || tab === 'planner') && (
        <div className="min-h-0 flex-1">
          <RoomPlanner rooms={pms.rooms} reservations={pms.reservations} onRefresh={pms.reload} />
        </div>
      )}

      {!isDedicatedPlanner && tab === 'management' && <RoomManagement onChanged={pms.reload} />}

      {!isDedicatedPlanner && tab === 'reservations' && (
        <div className="flex-1 overflow-y-auto p-4">
          {actionError && <div role="alert" className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{actionError}</div>}
          <div className="overflow-hidden rounded-2xl" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
            <table className="w-full text-sm">
              <thead><tr style={{ background: SURFACE2, borderBottom: `1px solid ${BORDER}` }}>
                {['Guest', 'Phone', 'Room', 'Arrival', 'Departure', 'Party', 'Status', ''].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: MUTED }}>{h}</th>)}
              </tr></thead>
              <tbody>{pms.reservations.map((rv, i) => (
                <tr key={rv.id} style={{ borderBottom: `1px solid ${BORDER}`, background: i % 2 ? SURFACE2 : SURFACE }}>
                  <td className="px-4 py-3 font-medium" style={{ color: NAVY }}>{rv.guest}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: MUTED }}>{rv.phone}</td>
                  <td className="px-4 py-3 font-mono font-medium" style={{ color: NAVY }}>{rv.roomNumber}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: MUTED }}>{rv.arrival}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: MUTED }}>{rv.departure}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: MUTED }}>{rv.partySize}</td>
                  <td className="px-4 py-3"><span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: rv.status === 'booked' ? 'var(--warning-soft)' : rv.status === 'checked-in' ? 'var(--success-soft)' : 'var(--surface-2)', color: rv.status === 'booked' ? 'var(--warning-text)' : rv.status === 'checked-in' ? 'var(--success-text)' : MUTED }}>{rv.status === 'checked-in' ? 'Checked in' : rv.status === 'checked-out' ? 'Checked out' : 'Booked'}</span></td>
                  <td className="px-4 py-3">
                    {rv.status === 'booked' && <button onClick={() => runAction(() => pms.checkInReservation(rv.id))} className="rounded-lg px-3 py-1.5 text-xs font-medium" style={{ background: TEAL, color: 'var(--primary-foreground)' }}>Check In</button>}
                    {rv.status === 'booked' && <button onClick={() => runAction(() => pms.removeReservation(rv.id))} className="ml-1 rounded-lg px-3 py-1.5 text-xs font-medium" style={{ background: SURFACE, border: `1px solid ${BORDER}`, color: DESTRUCTIVE }}>Remove</button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {openRoom && <RoomPanel room={openRoom} onClose={() => setOpenRoom(null)} />}
    </div>
  );
}
