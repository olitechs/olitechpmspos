# OliTechs Workspace Security — Implementation

## Workspaces
- `/pos` — Front Office POS
- `/backoffice` — Back Office PMS / Operations (`?module=` preserves the selected sub-module)
- `/store` — Store / Controls
- `/admin` — Admin; `/admin/roles` — Staff & Roles

## PIN security
PINs are SHA-256 hashed in the browser before being sent to Supabase. Plain PINs are never stored. The `staff.pin_hash` column is revoked from authenticated SELECT privileges.

A successful PIN verification creates a server-side `staff_sessions` record for the authenticated account. The server session expires after 30 minutes and is refreshed by activity. `staff_logs` records module entry events.

## Required migrations
Run in order after the existing migrations:
- `0017_staff_roles_pin_access.sql`
- `0018_workspace_rls.sql`
- `0019_pms_pos_security.sql`
- `0020_active_staff_server_session.sql`
- `0021_effective_staff_rls.sql`
- `0022_touch_staff_session.sql`

These migrations add role-aware RLS for Store and PMS data, a minimal room-charge lookup RPC, and a controlled restaurant-to-room folio charge RPC.

## Staff account linkage
When a Hotel Admin creates staff with an email that already belongs to a Supabase `profiles` row, the staff record is automatically linked through `staff.user_id`. This allows Postgres RLS to enforce that staff member's role. PIN-selected staff identity is also tracked server-side in `staff_sessions`.
