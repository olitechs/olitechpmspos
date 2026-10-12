import React from 'react';
import { PmsProvider, usePms } from '@/data/PmsStore';
import RoomPlanner from '@/components/pms/RoomPlanner';

/**
 * Dedicated full-screen Room Planner route.
 *
 * Keep this separate from POSApp/Rooms so direct navigation to
 * /frontoffice/room-planner always mounts the calendar, not a dashboard
 * or the general room-management module.
 */
function RoomPlannerContent() {
  const pms = usePms();

  if (pms.loading) {
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center" role="status">
        <span className="text-sm text-[var(--muted)]">Loading room planner…</span>
      </div>
    );
  }

  if (pms.error && !pms.rooms.length) {
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center p-6">
        <div className="max-w-lg rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h1 className="text-base font-semibold text-[var(--text)]">Room Planner unavailable</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">{pms.error}</p>
          <button
            type="button"
            onClick={pms.reload}
            className="mt-4 rounded-lg bg-[var(--action)] px-4 py-2 text-sm font-semibold text-[var(--action-text)]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return <RoomPlanner rooms={pms.rooms} reservations={pms.reservations} onRefresh={pms.reload} />;
}

export default function RoomPlannerRoute() {
  return (
    <PmsProvider>
      <RoomPlannerContent />
    </PmsProvider>
  );
}
