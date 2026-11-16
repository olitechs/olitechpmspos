# ADR-0004: Services-only data access — audited, target defined, migration deferred to its own phase

Date: 2026-11-15. Status: Accepted (target); migration pending.

## Context

The architecture target says the component/page layer must reach Supabase
only through `src/services/*`. A mechanical audit (2026-11-15) found 21
component/page files importing `@/lib/supabaseClient` directly. Most of them
are Front Office pages and Stores/Admin screens shipped by the parallel
`origin/main` workstream in the days before this audit, which are actively
evolving.

## Decision

1. The target stands: components/pages call services, not Supabase.
2. The migration is **not** executed blind inside Phase 5: it touches real
   read/write flows (folios, tags, structure, guest requests, printers) with
   no runtime browser verification available, and the same files are landing
   changes from `origin/main`. Doing it here would be a rewrite, not cleanup,
   and would collide with the active workstream.
3. Each file below gets a thin service module (e.g. `src/services/` already
   hosts `pmsService`, `posService`, `platformService`, `inventoryService`,
   `shiftService`, `settingsService`) that owns the tables/RPCs listed.
   Components keep their logic; only the transport moves.
4. Ordering: stable, low-traffic screens first (Stores page, Categories,
   POS devices), then the Front Office suite as a set (they share
   `reservations`/`rooms` reads), then Admin realtime channels.

## Inventory (audit 2026-11-15)

| File | Tables | RPCs / channels |
|---|---|---|
| `components/modules/InventoryOperations.jsx` | `inventory_counts` | — |
| `components/settings/CategoriesPage.jsx` | `products` | — |
| `components/settings/KitchenPrintersPage.jsx` | — | channel `fnb-print-recovery-*` |
| `components/settings/PrinterSetupWizard.jsx` | — | (client) |
| `components/stores/POSDevicesPage.jsx` | `pos_devices` | — |
| `components/stores/StoresPage.jsx` | `stores` | — |
| `pages/Admin/AdminDashboard.jsx` | — | channel `platform-admin-live` |
| `pages/Admin/AdminProperties.jsx` | — | channel `platform-properties-live` |
| `pages/Admin/AdminUsage.jsx` | — | channel `platform-usage-live` |
| `pages/Admin/AdminUsers.jsx` | — | channel `platform-users-live` |
| `pages/FrontOfficeAssistance.jsx` | `guest_service_requests`, `guest_service_request_events` | — |
| `pages/FrontOfficeConfiguration.jsx` | `rate_plans`, `booking_engine_settings` | — |
| `pages/FrontOfficeGuestRequests.jsx` | `guest_service_requests`, `reservations`, `staff`, `guest_service_request_events` | — |
| `pages/FrontOfficeLaundry.jsx` | `reservations`, `laundry_orders` | `fn_create_laundry_order_with_folio`, `fn_update_laundry_order` |
| `pages/FrontOfficeMaintenance.jsx` | `rooms`, `staff` | — |
| `pages/FrontOfficeMinibar.jsx` | `reservations`, `products`, `folio_charges` | `fn_post_minibar_consumption` |
| `pages/FrontOfficeStatistics.jsx` | `reservations` | — |
| `pages/FrontOfficeStructure.jsx` | `property_buildings`, `property_floors`, `rooms`, `room_types` | — |
| `pages/FrontOfficeTags.jsx` | `property_tags`, `property_tag_assignments`, `guests`, `rooms`, `reservations` | — |
| `pages/ResetPassword.jsx` | — | (auth) |
| `pages/SettingsPrinters.jsx` | `property_printers`, `printer_assignments` | — |

## Consequences

- Property/tenant isolation stays enforced by RLS regardless of which layer
  issues the query; the migration must not weaken any RLS assumption.
- The audit scanner lives at
  `C:\Users\jacks\AppData\Local\Temp\opencode\scan-direct-supabase.mjs`
  (session tooling); it should be promoted into `scripts/` when the migration
  phase starts so the count can trend to zero.
