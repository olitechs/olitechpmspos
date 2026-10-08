import React, { useState } from 'react';
import { usePms } from '@/data/PmsStore';
import RoomPanel from '@/components/pms/RoomPanel';
import RoomManagement from '@/components/pms/RoomManagement';
import RoomPlanner from '@/components/pms/RoomPlanner';
import { NAVY, TEAL, SAND, SURFACE, SURFACE2, BORDER, MUTED, DESTRUCTIVE } from '@/data/palette';




export default function Rooms() {
  const pms = usePms();
  const [tab, setTab] = useState('planner');
  const [openRoom, setOpenRoom] = useState(null);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 shrink-0">
        {['planner', 'reservations', 'management'].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="min-h-11 shrink-0 rounded-xl px-4 text-xs font-black"
            style={{ background: tab === t ? 'var(--action)' : 'transparent', color: tab === t ? 'var(--action-text)' : 'var(--muted)', border: `1px solid ${tab === t ? 'var(--action)' : 'var(--border)'}` }}>
            {t === 'planner' ? 'Room Planner' : t === 'reservations' ? 'Reservations' : 'Room Types & Setup'}
          </button>
        ))}
        <div className="ml-auto text-xs" className="ml-auto hidden shrink-0 text-xs font-semibold lg:block" style={{ color: 'var(--muted)' }}>Room operations</div>
      </div>

      {tab === 'management' && <RoomManagement onChanged={pms.reload} />}

      {tab === 'planner' && (
        <div className="flex-1 min-h-0">
          <RoomPlanner rooms={pms.rooms} reservations={pms.reservations} onRefresh={pms.reload} />
        </div>
      )}

      {tab === 'reservations' && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="rounded-2xl overflow-hidden" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: SURFACE2, borderBottom: `1px solid ${BORDER}` }}>
                  {['Guest', 'Phone', 'Room', 'Arrival', 'Departure', 'Party', 'Status', ''].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: MUTED }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pms.reservations.map((rv, i) => (
                  <tr key={rv.id} style={{ borderBottom: `1px solid ${BORDER}`, background: i % 2 ? SURFACE2 : SURFACE }}>
                    <td className="px-4 py-3 font-medium" style={{ color: NAVY }}>{rv.guest}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: MUTED }}>{rv.phone}</td>
                    <td className="px-4 py-3 font-mono font-bold" style={{ color: NAVY }}>{rv.roomNumber}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: MUTED }}>{rv.arrival}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: MUTED }}>{rv.departure}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: MUTED }}>{rv.partySize}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                        style={{ background: rv.status === 'booked' ? 'rgba(224,162,60,0.18)' : rv.status === 'checked-in' ? 'rgba(245,108,90,0.18)' : 'rgba(94,113,128,0.14)',
                                 color: rv.status === 'booked' ? '#9A6616' : rv.status === 'checked-in' ? '#C0492E' : MUTED }}>
                        {rv.status === 'checked-in' ? 'Checked in' : rv.status === 'checked-out' ? 'Checked out' : 'Booked'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {rv.status === 'booked' && (
                        <button onClick={() => pms.checkInReservation(rv.id)} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: TEAL, color: '#090C11' }}>Check In</button>
                      )}
                      {rv.status === 'booked' && (
                        <button onClick={() => pms.removeReservation(rv.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold ml-1" style={{ background: SURFACE, border: `1px solid ${BORDER}`, color: DESTRUCTIVE }}>Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {openRoom && <RoomPanel room={openRoom} onClose={() => setOpenRoom(null)} />}
    </div>
  );
}