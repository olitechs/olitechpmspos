import React from 'react';
import { useLocation } from 'react-router-dom';
import { usePms } from '@/data/PmsStore';
import RoomManagement from '@/components/pms/RoomManagement';
import RoomPlanner from '@/components/pms/RoomPlanner';

// Route-based module: the calendar lives only at /frontoffice/room-planner and
// Room Types & Setup only at /frontoffice/rooms, so each screen gets the full
// height with no internal tab bar (the shell sidebar is the only navigation).
export default function Rooms() {
  const pms = usePms();
  const { pathname } = useLocation();
  const isPlanner = /^\/frontoffice\/room-planner\/?$/.test(pathname);

  if (isPlanner) {
    return (
      <div className="flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
        <div className="min-h-0 flex-1">
          <RoomPlanner rooms={pms.rooms} reservations={pms.reservations} onRefresh={pms.reload} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
      <RoomManagement onChanged={pms.reload} />
    </div>
  );
}
