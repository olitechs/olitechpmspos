# OliTechs PMS + POS — Phase 0 Repository Audit

**Audit date:** 2026-10-18  
**Repository:** `olitechs/olitechpmspos`  
**Branch reviewed:** `main`  
**Scope:** Read-only application/database audit. This document is a source-repository audit, not a live Supabase production-schema inspection. No application code or migrations were changed to prepare this report.

## Executive summary

The root Vite + React 18 application is the active runtime. It is not a UI-only mock: it has Supabase-backed PMS/POS services, a substantial migration history, persistent POS table sessions, receipt records, kitchen orders, printer configuration, and real browser/agent printing paths. However, the architecture is still hybrid. PMS state remains centered on `src/data/PmsStore.jsx`; POS orchestration remains centered on `src/data/AppStore.jsx`; parts of the UI still use sample/static data; and authentication retains compatibility/session logic. The repository does not prove end-to-end offline-first transactional queuing or complete tenant isolation merely by containing migrations and service calls.

**Highest-risk findings**
1. **Authentication and authorization:** `src/services/authService.js` includes Supabase Auth plus legacy browser/session compatibility. `sessionStorage` staff identity is used by app-role/navigation code. These values must not be treated as authorization proof; verify all sensitive RPC/RLS boundaries.
2. **Migration governance:** migration filenames have duplicate numeric prefixes (documented examples include 0016, 0028, 0032–0035 and 0037). Filenames are deployment history and must not be renamed casually. Repository files alone cannot establish which migrations are applied to production.
3. **Financial integrity:** receipt/cashier/night-audit/folio workflows and relevant migrations exist, but an immutable ledger and full reversal/audit semantics across every money mutation are not proven by this read-only pass.
4. **Offline behavior:** persistent POS sessions and KDS data are present; this is not proof of an IndexedDB transaction outbox, replay idempotency, deterministic conflict resolution, or offline payment safety.
5. **Printing:** the browser print service documents genuine network printing through a local print agent, WebUSB, Web Bluetooth and system print-dialog paths. Physical connectivity and the complete queue/failover/relay feature set still need runtime verification.

## Scope and evidence limitations

Reviewed repository documents and source files include `AGENTS.md`, `Rules.md`, `Architecture.md`, `Design.md`, `PRD.md`, `Phases.md`, `Memory.md`, `FEATURE_ROADMAP.md`, `README.md`, `package.json`, `src/App.jsx`, `src/lib/supabaseClient.js`, `src/services/authService.js`, `src/services/printerService.js`, and `supabase/migrations/0037_persistent_printer_config.sql`, along with the documented inventory audit artifacts.

This review used repository file contents, not a cloned working tree or a live database connection. Consequently:
- build, lint, typecheck, browser, Playwright, SQL regression, and Supabase advisor checks were **not run**;
- the exact current migration directory listing and applied migration ledger were not independently queried from a database;
- RLS status below is marked as a risk/partial where policies are present in known migrations, not asserted as globally complete;
- physical printer capabilities are inferred from implementation/documentation and still require hardware tests.

## Feature-status matrix

Status definitions: **DONE** = source evidence supports the stated capability; **PARTIAL** = implemented in part or split between UI/local state/backend; **BROKEN** = known defect or material mismatch is documented; **MISSING** = no adequate implementation evidence found in this review; **MOCK** = sample/static UI data without authoritative persistence. These statuses describe the reviewed source, not a claim that every production deployment behaves identically.

| Domain / checklist item | Status | Source evidence / files / tables | Effort | Audit finding / phase mapping |
|---|---|---|---|---|
| Platform admin and property management | PARTIAL | `src/App.jsx`, `src/pages/admin/*`, `src/services/platformService.js`, `admin_list_properties()` and platform migrations | M | Distinct platform-admin routes and service/RPC paths exist; verify server-side owner authorization, completeness of dashboard data and route-level regression. Phase 1, 9 |
| Tenant/business/branch foundation | PARTIAL | `properties`, property membership/RLS helpers in migrations; `src/services/platformService.js` | L | Existing model appears property-centric; requested generic business/branch/department model is not demonstrated. Avoid duplicating existing tenant model; inventory schema first. Phase 1 |
| Roles, permissions and sensitive actions | PARTIAL | `src/services/authService.js`, `src/lib/AdminRoute.jsx`, `src/lib/FeatureGate.jsx`, `src/lib/entitlements.js`, staff-role/RLS migrations | L | UI role/module gating exists. Need action-level authorization evidence in every RPC/policy for void, refund, discount, reprint and overrides. Phase 1 |
| Supabase Auth / session lifecycle | PARTIAL | `src/services/authService.js`, `src/lib/AuthContext.jsx`, `src/lib/supabaseClient.js` | L | Supabase Auth is integrated, but legacy browser compatibility remains; `sessionStorage` holds active staff context. Remove reliance on client storage as authority. Phase 1 |
| PMS store migration to server state | PARTIAL | `src/data/PmsStore.jsx`, `src/services/pmsService.js`, `src/lib/query-client.js` | L | Server service exists, but central local store remains; persistence/reset risks documented in Memory/Architecture. Phase 1–2 |
| POS state migration to server state | PARTIAL | `src/data/AppStore.jsx`, `src/services/posService.js`, `src/lib/query-client.js` | L | POS sessions and kitchen orders hydrate through services; local orchestration remains. Phase 1, 4 |
| App shell and navigation | PARTIAL | `src/App.jsx`, `src/pages/POSApp.jsx`, `src/components/shell/Sidebar.jsx`, `TopBar.jsx`, `POSTabs.jsx`, layouts | M | Multiple workspace layouts and role-aware routing exist; validate navigation duplication and every route against entitlement/role matrix. Phase 1, 9 |
| Room planner timeline | PARTIAL | `src/components/pms/RoomPlanner.jsx`, backup `RoomPlanner.jsx.bak`, migrations 0013–0016 | L | High-risk, substantial existing component and database availability/RPC logic. Virtualisation, checked-out opacity, complete drag semantics and 100+ room performance need direct tests. Phase 2, 9 |
| Reservations lifecycle | PARTIAL | `src/components/modules/Reservations.jsx`, `src/services/pmsService.js`, migrations 0002, 0012–0016 | L | Reservation UI and availability RPCs exist; complete statuses, group/multi-room, waitlist, policies and race-condition protection need test coverage. Phase 2 |
| Double-booking protection | PARTIAL | `0014_room_planner_production.sql`, `0015_room_planner_date_inventory.sql`, `0016_fix_room_planner_raise.sql`, `pmsService.js` | L | Server-side availability/RPC logic exists. Must prove atomic overlapping-room prevention with concurrent integration tests; UI availability is insufficient. Phase 2 |
| Guest CRM and registration | PARTIAL | Guest-related PMS components, `PmsStore.jsx`, migrations | M/L | Guest lists and guest workflows exist; ID capture/signature, duplicate merge, consent, company/agent CRM and full stay-history persistence need verification. Phase 2 |
| Folio and billing ledger | PARTIAL | `src/components/modules/Folio.jsx`, receipt/payment services, `0023_pos_receipts.sql`, cashier migrations | L | Folio and receipts exist. Universal multiple folios/windows, immutable postings, split/transfer/reversal, multi-currency and closed-day locking are not proven end-to-end. Phase 3 |
| Cashier and payment controls | PARTIAL | `src/components/modules/Cashier.jsx`, `0025_cashier_controls.sql`, POS payment components | L | Cashier controls and payment UI exist; verify reason-coded approvals, reconciliation and no silent over/short discard. Phase 3, 8 |
| Housekeeping | PARTIAL | `src/components/modules/Housekeeping.jsx`, `0003_housekeeping_maintenance_inventory.sql`, `0027_housekeeping_2.sql` | M | Board/workflows and migrations exist; mobile assignments, inspection, linen, lost-and-found and minibar completeness require route-level review. Phase 7 |
| Maintenance | PARTIAL | `src/components/modules/Maintenance.jsx`, maintenance migrations including duplicate-prefix `0028_maintenance_2.sql` | M | Request/work-order capability exists; auto-blocking, preventive schedules, photo/assignee flows require verification. Phase 7 |
| Rates and tax setup | PARTIAL | rate/room-type UI and PMS migrations; settings components | M/L | Some rates/taxes/fees are represented; branch-specific tax rules, deterministic calculation and full tax jurisdiction support need schema/service audit. Phase 1, 3, 8 |
| Restaurant/bar POS ordering | PARTIAL | `src/components/pos/POSContainer.jsx`, `FloorPlan.jsx`, `OrderTaking.jsx`, `BillPayment.jsx`, `src/services/posService.js`, `0033_pos_table_sessions.sql` | L | Real POS subsystem with persistent table sessions. Complete courses, combos, seat-based split, table moves, shift and offline order-to-payment acceptance remain unproven. Phase 4 |
| Kitchen Display System (KDS) | PARTIAL | `src/components/modules/KitchenDisplay.jsx`, `0036_persistent_kitchen_orders.sql`, `AppStore.jsx` | M | Persistent kitchen orders exist; station routing, timers, bump/recall, allergy emphasis and realtime/reconnect behavior require tests. Phase 4 |
| Recipes and food costing | PARTIAL | `src/components/modules/Recipes.jsx`, inventory service and recipe migrations including `0028_inventory_recipe_laundry_transfers.sql` | M/L | Recipe/inventory surface and migration exist; yield, unit conversion, weighted average/FIFO, sale deduction and margin reconciliation need end-to-end proof. Phase 6 |
| Store/stock/procurement | PARTIAL | `src/services/inventoryService.js`, inventory/purchasing migrations, `Purchasing.jsx`, `InventoryOperations.jsx`, `InventoryReports.jsx` | L | Inventory and purchasing are real modules. Stock-ledger invariants, approvals, transfers, returns, batches/expiry and stock-take reconciliation require tests. Phase 6; stock-integrity blockers move earlier if money/sales can corrupt stock. |
| Back office/accounting | PARTIAL | `src/components/modules/*`, reporting/purchasing/folio services and migrations | L | Some cashier, purchasing and reporting foundations exist; chart of accounts, balanced journals, AP/AR, bank reconciliation, budgets and period close not established as complete. Phase 7 |
| Night audit | PARTIAL | `src/components/modules/NightAudit.jsx`, `0026_night_audit.sql` | L | Dedicated workflow/migration exists. Must prove atomic business-date roll, blocker checks, read-only closed days and balanced audit pack. Phase 7 |
| Reports and dashboards | PARTIAL / MOCK | `src/components/modules/Reports.jsx`, `Dashboard.jsx`, `src/data/platformData.js`, reporting migrations | M/L | Source docs identify a mix of live service data and sample/static data. Reconcile every KPI to ledger/transactions; mark any demo data clearly. Phase 7–8 |
| Printer registry/configuration | PARTIAL | `src/services/printerService.js`, printer settings pages, `0037_persistent_printer_config.sql`, `pos_printers` | M | Per-property printer configuration, role/purpose and connection details exist; schema uses `property_id`, not business/branch; terminal defaults and richer registry fields need review. Phase 5 |
| Print agent and network printing | PARTIAL | `tools/print-agent/print-agent-v2.js`, install/run scripts, `printerService.js` | L | Network printing goes through local agent; raw TCP cannot be opened by browser JS. Need verify auth/pairing, discovery, heartbeat, service auto-start, structured logs, updates and hardening. Phase 5 |
| USB/Bluetooth/system print | PARTIAL | `printerService.js` | M | WebUSB, Web Bluetooth and system dialog paths are described/implemented; OS/browser/device support and Bluetooth Classic SPP/cloud relay are not established. Phase 5 |
| Persistent print queue, retry, failover | PARTIAL | `printerService.js`, print-agent files, print-routing tests listed in package scripts | M/L | Job status states exist; durable queue across restarts, retry/backoff, failover, reprint history and all document templates need runtime tests. Phase 5 |
| Print routing by category/station | PARTIAL | `src/services/printRoutingCore.test.js`, kitchen printer/settings components, `pos_printers` purposes/center | M | Routing code/tests and printer purposes exist; category-to-printer behavior for real menu categories and one-ticket-per-station acceptance must be tested with two printers. Phase 5 |
| Kenya payments and KRA/eTIMS | PARTIAL / UNVERIFIED | README/PRD claims KRA/ETR invoicing; payments and receipt code | L | Product docs make compliance claims, but current official requirements and a fiscal integration/control-unit reference were not verified in this source-only audit. Treat compliance as unverified until Phase 8 official-source review. |
| Guest-facing booking/distribution/integrations | PARTIAL | `BookingEngine.jsx`, routes/components and service layer | L | Booking-engine surface exists; online pre-check-in, OTA/channel manager, messaging, tour-operator portal, webhooks and API coverage need individual status verification. Phase 8 |
| Offline-first write queue | MISSING / UNVERIFIED | Persistent POS sessions/KDS; local React state; no verified IndexedDB outbox found in reviewed sources | L | No evidence in the reviewed files establishes safe durable queue + idempotent replay for all cashier/waiter writes. High priority for money/data safety. Phase 1, 4 |
| Realtime synchronization | PARTIAL / UNVERIFIED | Supabase stack and persistent services/migrations | M | Realtime is in target architecture, but active subscriptions, reconnect behavior, tenant scoping and conflict handling need repository-wide and runtime inspection. Phase 1–4 |
| Audit log across sensitive actions | PARTIAL / UNVERIFIED | Platform admin audit route/components and audit-related migrations | M/L | Audit surfaces exist; one common writer covering void/refund/discount/reprint/override/stock adjustment is not proven. Phase 1 |
| Accessibility, tablet/mobile, performance | PARTIAL / UNVERIFIED | Design system docs, Tailwind and React components | M | Design standards exist; touch targets, keyboard paths, screen readers, virtualisation and device tests are not evidenced by passing automated checks. Phase 9 |
| Tests and release gates | PARTIAL | `package.json` scripts: build, lint, typecheck, `test:architecture`, contrast check | M | Scripts exist, including architecture tests. They were not run in this audit. Playwright critical-path suite and live DB tenant-isolation tests are not established here. Phase 9 |

## Data model and migration audit

### Known model shape

The repository is property-centric. Evidence includes `public.properties`, `property_id` columns, helpers such as `is_member_of_property(property_id)`, `property_role(property_id)`, `current_staff_role(property_id)`, and the `pos_printers` table.

Known migration subjects include platform administration, PMS core, housekeeping/maintenance/inventory, owner/property registration, room planner, staff roles/PIN access, workspace RLS, POS security, active staff sessions, receipts, cashier controls, night audit, inventory recipes/transfers, persistent POS table sessions, persistent kitchen orders, and printer configuration.

### Findings / required inventory before schema work

- Do **not** create parallel `businesses` / `branches` tables without first deciding whether `properties` is the existing tenant/business boundary or should map to one. A duplicate tenant hierarchy could split authorization and reporting.
- Migration filename prefixes collide, documented for 0016, 0028, 0032, 0033, 0034, 0035 and 0037. Migration order must be derived from the actual migration ledger and dependencies, not lexical renumbering.
- `pos_printers` has a `property_id` foreign key and index `(property_id, updated_at desc)`; its migration enables RLS and defines select/write policies plus security-definer list/upsert/delete functions. RPC authorization and grants need systematic review.
- No live schema query was performed. Therefore a definitive table-by-table foreign-key/index/RLS inventory, orphan check, applied migration diff, and production parity report remains outstanding. Do not treat this document as proof that every table has RLS.
- Additive migrations should preserve existing data and migration history. Every new migration needs an explicit rollback/mitigation plan and tests in a production-equivalent disposable fixture (not a paid branch and never production).

## Security audit

### Evidence of existing controls
- Supabase client configured with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; no service-role key was found in the reviewed client file.
- `src/App.jsx` has separate protected hotel routes and platform-admin route tree.
- `AdminRoute.jsx`, `FeatureGate.jsx`, `entitlements.js`, role normalization, staff PIN hashing and staff-session helpers exist.
- Migrations include workspace RLS, PMS/POS security and effective staff RLS.
- `0037_persistent_printer_config.sql` enables RLS and defines policies plus explicit authorization in security-definer write functions.

### Risks to prove or fix in Phase 1
- A client role, package, `property_id`, local/session storage object, or route guard is not authorization. Each sensitive query/mutation/RPC must validate the authenticated user, property membership and action server-side.
- Audit all `SECURITY DEFINER` functions for `search_path`, explicit actor/tenant/action checks, grants to `authenticated`/other roles and unintended cross-tenant reads/writes.
- Test all tenant-sensitive tables for enabled RLS and applicable policies, including insert/update `WITH CHECK`; look for policies that allow broad property access or do not scope both read and write paths.
- Verify staff PIN rate limiting, lockout, server-side verification and session expiry. Client-side SHA-256 hashing/sessionStorage alone is not a sufficient authentication boundary.
- Search tracked files for accidental secrets and localStorage auth tokens. Public anon keys are expected configuration; service-role/private keys are not.
- Verify platform-owner operations cannot be invoked by hotel users through direct RPC calls.

## Offline and realtime audit

The repository supports persistent POS table sessions and persistent kitchen orders, and the app includes Supabase/TanStack Query infrastructure. This is meaningful persistence but does not establish the requested offline-first guarantee.

Phase 1 must inventory all write operations and classify queue safety. Introduce IndexedDB only with explicit transaction envelopes, stable idempotency keys, states (queued/processing/committed/failed), retry policy, actor/tenant binding and conflict rules. Do not queue irreversible financial postings without server idempotency and reconciliation. Test offline creation, reconnect, duplicate replay, expired auth, partial response loss and multi-device conflicts. Inspect Realtime subscriptions for correct tenant filters, cleanup, reconnect and invalidation behavior.

## Printing / hardware audit

| Capability | Current evidence | Status |
|---|---|---|
| Network/LAN raw TCP 9100 | Browser delegates raw TCP to local agent; `printerService.js` validates IP/port and calls agent | PARTIAL; test real printer |
| Agent process and Windows scripts | `tools/print-agent/print-agent-v2.js`, install/run/uninstall scripts | PARTIAL; inspect service lifecycle and security |
| USB | WebUSB path documented in service | PARTIAL; browser/device permission required |
| Bluetooth BLE | Web Bluetooth path documented in service | PARTIAL; browser/device-specific |
| Bluetooth Classic SPP / Android bridge | Not proven in reviewed files | MISSING / UNVERIFIED |
| System print dialog | `window.print()` path | DONE as browser handoff only; physical-device success not confirmed |
| Persistent queue/retry/backoff | Job status constants include pending/printing/printed/failed/retrying | PARTIAL; persistence and restart recovery not proven |
| Discovery/heartbeat/health | Must be verified in print-agent implementation | UNVERIFIED |
| Cloud relay | Not established in reviewed sources | MISSING / UNVERIFIED |
| Routing by product/category/station | Routing code/tests and printer-purpose config exist | PARTIAL |
| Failover and alerts | Not proven end-to-end | UNVERIFIED |
| ESC/POS cut, drawer pulse, buzzer, QR/barcode, codepages | Not all commands verified in this pass | UNVERIFIED |
| All requested document templates | Existing receipts/KOT/BOT and PDFs may exist; full checklist not verified | PARTIAL |

The acceptance test for Phase 5 must use two actual LAN printers assigned to different stations, disconnect/reconnect one printer, verify queued job recovery without duplicate tickets, and check printed output—not just mocked transport tests.

## UI, accessibility and performance

- Design system docs and token sources exist. `Design.md` and README contain some legacy/inconsistent guidance (for example older slate/blue component notes coexist with yellow/charcoal target tokens); canonical token source and approved decisions should be reconciled before any redesign.
- `RoomPlanner.jsx` is explicitly high-risk and large; preserve existing behavior and avoid blind rewrites. Virtualised rendering and tablet interactions need measurement.
- Multiple app layouts/routes are present. Verify duplicate navigation and role-appropriate access across Front Office, Back Office, Store, POS and Platform Admin.
- Verify POS targets at least 44px, visible keyboard focus, contrast, non-colour-only status, loading/empty/error states, reduced-motion behavior and mobile/tablet overflow.
- Performance claims require measurement: large room planner, report tables, menu/product grids, realtime channel counts, query pagination and bundle splitting.

## Prioritised backlog mapped to Phases 1–9

| Priority | Gap / blocker | Phase | Required proof / acceptance |
|---|---|---|---|
| P0 | Establish actual schema and applied migration baseline; resolve duplicate-prefix dependency graph | 1 prerequisite | Compare migration files to Supabase migration ledger and live schema; no production changes |
| P0 | Prove tenant isolation and server-side authorization for direct table/RPC access | 1 | Automated user A/business B read/write denial tests; review all security-definer RPCs |
| P0 | Prove money and stock mutation invariants before feature expansion | 1, 3, 4, 6 | Reversal/idempotency tests, ledger totals, duplicate replay, stock reconciliation |
| P0 | Verify PIN/session security and legacy localStorage/sessionStorage auth dependencies | 1 | PIN throttling/expiry, direct RPC negative tests, session timeout, auth source-of-truth checks |
| P1 | Durable offline queue and realtime reconnect/conflict semantics | 1, 4 | Offline order and recovery tests, no duplicate posting after retry/response loss |
| P1 | Atomic reservation overlap protection and planner persistence/realtime | 2 | Concurrent overlapping booking test; drag/resize persistence; 100+ rooms/tablet tests |
| P1 | Folio ledger and POS-to-folio exactly-once posting | 3, 4 | Folio sum equals postings; room charge exactly once; void/refund reversal tests |
| P1 | Printer agent hardening and persistent job queue | 5 | Two-station/two-printer integration, unplug/reconnect, duplicate prevention, real-device output |
| P1 | Stock ledger, recipes, transfers and stock-take invariants | 6 | Ingredient deductions and movements reconcile with on-hand quantities |
| P1 | Night audit atomic close and accounting balance | 7 | Block on open/unsettled items; closed day immutable; journals balance to zero |
| P2 | Tax/payment/KRA requirements and fiscal integration | 8 | Official-source compliance review; end-to-end reconciliation and fiscal reference tests |
| P2 | Report source-of-truth and removal/labeling of sample metrics | 7–8 | Reconcile reports to authoritative ledger and source transactions |
| P2 | Accessibility, responsiveness, performance and onboarding | 9 | Playwright critical paths, keyboard/accessibility checks, bundle/query performance baselines |
| P2 | Guest-facing booking, OTA, messaging, exports and integrations | 8 | Separate feature-level acceptance tests; explicit external integration credentials/sandbox |

## Recommended delivery order

Keep the user-requested phase gates. Inside Phase 1, prioritize schema/migration baseline and tenant-security tests before broad auth/store refactors. Treat offline queue and financial idempotency as foundation requirements, not later polish. Do not begin Phase 2 implementation until the foundation documents and Phase 1 scope are explicitly approved under `AGENTS.md`.

## Foundation-document conflicts / decisions needed

1. `AGENTS.md` says the seven foundation documents must be approved before any Phase 1 implementation. This audit does not authorize Phase 1.
2. Repository docs already describe an earlier scoped Phase 1 foundation/design-system authorization and mention an open PR #10. The current prompt authorizes only Phase 0; it does not authorize merging that PR or implementing a feature phase. Confirm whether the older scoped authorization remains active before any implementation.
3. The prompt proposes generic `businesses` and `branches`, while the existing schema is property-centric. Reuse/map the current model unless an approved ADR says otherwise.
4. Prompt says migrations should be reversible. PostgreSQL data migrations are not always safely reversible; require a rollback/mitigation plan and forward-fix strategy where true rollback could destroy committed operational data.
5. Design guidance contains historical palette/component notes alongside newer yellow/charcoal token decisions. Resolve the canonical approved design contract from CSS variables and the latest approved ADR before touching UI.
6. “No localStorage auth left” should mean no local browser storage is treated as authentication/authorization authority. Non-sensitive UI preferences may still be persisted if approved.

## Phase 0 completion

- [x] Reviewed primary architecture, rules, product, design, phase and memory documents.
- [x] Reviewed app routing, Supabase client, auth service, printer service and printer configuration migration.
- [x] Created domain status matrix and prioritized phase backlog.
- [ ] Complete exact table/FK/index/RLS inventory against the full migration directory and live schema.
- [ ] Run static checks, full application tests, Supabase security advisors and browser flows in a local checkout.
- [ ] Obtain user approval of the seven foundation documents and explicit next-phase scope.

**Phase 0 result:** Initial source-based audit completed; production-schema parity and executable test verification remain explicitly open. No application code or SQL migration changed. Stop here pending review/approval.
