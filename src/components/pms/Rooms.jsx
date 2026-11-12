import React from 'react';
import { usePms } from '@/data/PmsStore';
import RoomManagement from '@/components/pms/RoomManagement';

/**
 * Room Types & Setup workspace.
 * Calendar / Room Planner and reservation operations live in their own
 * Front Office navigation destinations; this screen is configuration only.
 */
export default function Rooms() {
  const pms = usePms();

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
      <RoomManagement onChanged={pms.reload} />
    </div>
  );
}
