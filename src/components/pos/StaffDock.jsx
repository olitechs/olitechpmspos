import React from 'react';
import { splitStaffForDock, staffInitials } from '@/lib/posStaff';

// Staff switching dock for the POS floor screen.
//
// Staff rows arrive from authService.listStaff() as { id, name }. Rendering
// initials from `name` (instead of a `full_name`/`avatar` field the rows do not
// carry) is what keeps the dock from showing blank circles.
export default function StaffDock({ staff = [], activeStaffId = null, onSelect, max = 6 }) {
  if (!staff.length) return null;
  const { visible, hiddenCount } = splitStaffForDock(staff, max);

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Staff</span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {visible.map((person) => {
          const isActive = activeStaffId === person.id;
          return (
            <button
              key={person.id}
              type="button"
              onClick={() => onSelect?.(person)}
              title={`Switch POS staff to ${person.name}`}
              aria-label={`Switch POS staff to ${person.name}`}
              aria-pressed={isActive}
              className={`h-11 w-11 shrink-0 rounded-full border-2 text-[11px] font-extrabold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] ${
                isActive
                  ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]'
                  : 'border-[var(--border)] bg-[var(--primary-soft)] text-[var(--primary)] hover:border-[var(--primary)]'
              }`}
            >
              {staffInitials(person.name)}
            </button>
          );
        })}
        {hiddenCount > 0 && (
          <span
            className="shrink-0 px-1 text-[11px] font-bold text-[var(--text-muted)]"
            title={`${hiddenCount} more ${hiddenCount === 1 ? 'person is' : 'people are'} not shown in this dock`}
          >
            +{hiddenCount}
          </span>
        )}
      </div>
      <span className="ml-auto hidden shrink-0 text-[10px] font-semibold text-[var(--text-muted)] sm:block">Tap a colleague to switch the till</span>
    </div>
  );
}
