import React from 'react';
import { useLocation } from 'react-router-dom';
import { usePms } from '@/data/PmsStore';
import RoomManagement from '@/components/pms/RoomManagement';
import RoomPlanner from '@/components/pms/RoomPlanner';

export default function Rooms() {
  const pms = usePms();
  const { pathname } = useLocation();
  const isDedicatedPlanner = /^\/frontoffice\/room-planner\/?$/.test(pathname);

  // The Rooms & Apartments workspace is configuration-only.
  // Keep the dedicated Room Planner route available in its own workspace.
  if (isDedicatedPlanner) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden h-[100dvh]" style={{ background: 'var(--bg)' }}>
        <div className="min-h-0 flex-1">
          <RoomPlanner rooms={pms.rooms} reservations={pms.reservations} onRefresh={pms.reload} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
      <div className="flex shrink-0 items-center border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Room Types &amp; Setup</h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>Configure room types, facilities and accommodation setup.</p>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <RoomManagement onChanged={pms.reload} />
      </div>
    </div>
  );
}
