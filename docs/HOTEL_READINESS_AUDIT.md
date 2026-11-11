# OliTechs HOTEL-READINESS Audit

**Audit date:** 2026-11-11  
**Repository:** `olitechs/olitechpmspos`  
**Branch reviewed:** `main`  
**Application baseline:** merge commit `58d4747a169fea7ff0f26c7c909a552906203d03`  
**Live Supabase project:** `olitechs-pms-pos` (`mszogmazldxjsiytrlxr`)  
**Database observation:** 2026-11-11, approximately 16:58 UTC  
**Scope:** Read-only source inspection, live PostgreSQL catalog/schema inspection, applied migration ledger, Supabase advisors and GitHub commit status.  
**Change boundary:** No application code, customer rows, database schema, migrations, settings or production data were changed during this audit.

> This is a deep readiness snapshot, not a formal certification. The user reports successfully creating properties and manually testing several workflows. Those tests are accepted as valuable user-observed evidence, but this audit separately records what source code and live database metadata prove. It did not reproduce the user's browser sessions or perform destructive/transactional tests against production.

## 1. Executive verdict

**Current classification: operational PMS/POS foundation with real production data and working workflows, but not yet certified as the sole system of record for a live hotel.**

OliTechs is not a static prototype. The active root Vite/React application uses Supabase/PostgreSQL, has real property-scoped records, database RPCs for transactional workflows, persisted POS table sessions and kitchen orders, cashier records, stock data and print activity.

The user's successful tests are consistent with the live database containing operational records. The system is substantially beyond a UI mock.

The remaining concerns are not primarily missing screens. They concern:
- authorization at the database boundary;
- protection of posted financial records;
- inventory permission and valuation controls;
- frontend/database migration parity;
- failure handling when persistence fails;
- multi-terminal configuration persistence;
- night-audit and management-report definitions;
- offline guarantees and full regression evidence.

**Recommendation:** continue controlled pilot testing, but close the P0 issues in this report before relying on OliTechs as the only production PMS/POS and financial record for a hotel.

## 2. What was inspected

### Repository and application
- `AGENTS.md`, `docs/AI_DEVELOPER_GUIDE.md`, `docs/AUDIT.md`
- `src/data/AppStore.jsx`, `src/data/PmsStore.jsx`
- `src/services/authService.js`, `pmsService.js`, `posService.js`, `inventoryService.js`, `reportingService.js`, `printService.js`
- POS floor plan, bill/payment, cashier and night-audit UI
- POS table-join/quantity-void migration and regression contract
- Current `package.json` test/build scripts

### Live database
- Public schema table/function counts
- Applied migration ledger
- RLS-enabled status and policy inventory
- Selected live function definitions, execute grants and transaction locks
- Selected table privileges, indexes and triggers
- Aggregate operational row counts only; guest names, email addresses and other personal records were not queried

### Platform checks
- Supabase security, performance and health advisors
- GitHub combined commit status for the current main merge commit

## 3. Live database snapshot

The live database contains **84 public tables and 160 public functions**.

| Aggregate | Live count |
|---|---:|
| Properties | 5 |
| Active properties | 4 |
| Pending properties | 1 |
| Rooms | 4 |
| Room types | 2 |
| Reservations | 8 |
| Guest records | 9 |
| Folio charges | 6 |
| Payments | 1 |
| Staff records | 2 |
| Staff sessions | 0 |
| Housekeeping tasks | 0 |
| POS products | 850 |
| POS table-session records | 11 |
| Kitchen-order records | 4 |
| POS receipts | 7 |
| Cashier shifts | 2 |
| Night audits | 0 |
| Stock movements | 10 |
| Purchase orders | 0 |
| POS printer registry records (`pos_printers`) | 0 |
| Property printer records (`property_printers`) | 1 |
| Printer assignments | 8 |
| F&B print jobs | 73 |
| Print logs | 104 |

Counts are point-in-time totals, not proof that every record is active or that every workflow has been fully exercised. For example, the 11 POS table-session records may include closed sessions.

### What these counts establish

- Multiple properties exist, including active and pending property records.
- PMS records, guest records, folio charges and payments are persisted.
- POS product/menu data is substantial.
- POS sessions, kitchen orders, receipts, cashier shifts and print activity are persisted.
- Printing is not merely a UI setting: the database contains print jobs, assignments and logs.

### What they do not establish

- Every property has been fully configured.
- Every room/reservation/folio lifecycle has been tested.
- Every staff role has been tested against direct database access.
- Every POS terminal sees identical floor-plan configuration.
- Night audit, purchasing and housekeeping have completed end-to-end production cycles.
- Internet interruption and replay are safe.

## 4. Positive findings — real capabilities already present

### 4.1 Property and tenant foundation — PARTIAL / REAL

The database is property-centric. Property membership, property-scoped data, subscription records and RLS policies are present. The current live schema reports RLS enabled on all 84 public tables.

This is a meaningful foundation for multi-property operation. It is not yet proof of complete tenant isolation: every exposed RPC, policy and privileged function still needs a two-property negative test.

### 4.2 Reservations and room availability — CORE IMPLEMENTED

The live `fn_check_room_availability` function uses:

`pg_advisory_xact_lock(hashtextextended(property_id || ':' || room_id, 0))`

before checking overlapping reservations and room closures. Reservation creation and planner updates call this availability function.

This is an important improvement over the older October lifecycle audit, which reported that room-level serialization had not been verified. The current live function contains a room-scoped transaction lock.

The database also has reservation indexes for property, room, status and planner dates.

**Still required:** repeatable concurrent tests for single-room, multi-room/group creation, edits and moves, including reverse-order group requests and same-day turnover.

### 4.3 Front-desk payment and checkout — CORE GUARDS PRESENT

The live `fn_record_front_desk_payment`:
- checks property membership;
- locks the reservation row with `FOR UPDATE`;
- rejects cancelled and checked-out reservations;
- calculates the posted folio balance;
- rejects a payment exceeding the outstanding balance.

The live `fn_check_out_room`:
- locks the checked-in reservation;
- calculates folio charges less posted payments;
- blocks checkout when a balance remains;
- marks the room dirty;
- creates a checkout-clean housekeeping task.

These are valuable transactional safeguards.

**Remaining concern:** the check-in path is not protected to the same standard; see finding HR-04.

### 4.4 POS sales and cashier controls — CORE IMPLEMENTED

The current client calls `fn_record_pos_sale_with_vat_snapshot` and supplies an idempotency key (falling back to the order number). The underlying POS sale path checks property access, payment method, positive total, an open cashier shift and discount ownership, and uses transaction locking.

The live cashier-shift close function locks the shift, checks role/actor access, blocks closure while POS tables remain open and requires manager approval for a large cash variance.

The POS/KDS schema includes persistent table sessions, kitchen orders, receipt data, VAT snapshots, void records and audit records.

### 4.5 Reporting — LIVE SERVICE PATHS EXIST

The Reports page calls Supabase-backed `fn_management_report` and `fn_management_sales_detail`; it is not simply rendering a hard-coded dashboard dataset.

However, the meaning of some reported hotel KPIs needs correction/confirmation before these reports are treated as accounting-grade. See HR-09.

## 5. Critical and high-priority findings

Severity:
- **P0 — Must close before full production reliance:** security or financial-integrity exposure.
- **P1 — Must close before broad hotel rollout:** material operational correctness, recovery or reporting issue.
- **P2 — Hardening:** important but not by itself a release blocker.

### HR-01 — P0: Inventory mutation RPCs do not consistently enforce store-role permissions

**Evidence:** live definitions of the following SECURITY DEFINER functions are executable by `authenticated` and check property membership, but the inspected function bodies do not contain `can_store_write` or an equivalent action-specific staff-role gate:

- `fn_post_stock_adjustment`
- `fn_approve_inventory_count`
- `fn_complete_stock_transfer`
- `fn_consume_recipe_stock`
- `fn_receive_purchase_order`
- `fn_post_wastage`
- `fn_post_production`

Property membership proves that a user belongs to a property. It does not prove that the user is allowed to adjust stock, approve a stock count, transfer inventory, receive a purchase order, post wastage or complete production.

The live `can_store_write` helper already provides a stronger subscription/module/role check, but the sampled mutation RPCs do not consistently use it.

**Risk:** a property member with direct authenticated RPC access may invoke a sensitive stock operation outside the intended Store Manager / F&B Manager / authorized role workflow.

**Required remediation:**
1. Define the role/action matrix for every inventory operation.
2. Enforce it inside each SECURITY DEFINER RPC, not only in the React UI.
3. Include active staff identity/session, property membership, module entitlement and action role.
4. Separate count creation from count approval where required.
5. Add direct-RPC negative tests for receptionist, waiter, cashier, storekeeper, store manager, F&B manager, manager and owner.
6. Reconcile stock location and aggregate balance invariants before changing posting logic.

Do not blindly revoke every SECURITY DEFINER function flagged by the advisor; review each function and its intended caller.

### HR-02 — P0: Buying cost is masked in the UI but exposed by the live database

**Evidence:**
- `fn_inventory_valuation(uuid)` is SECURITY INVOKER and returns `cost_price` and `stock_value`.
- The live `products_select` policy permits property members to select product rows.
- The authenticated role can execute the valuation function.
- The application has a UI-level role mask in inventory code, but that mask does not protect direct REST/table/RPC access.

**Risk:** a staff member who should only see selling price and stock quantity can query product buying cost and stock valuation directly.

**Required remediation:** move cost visibility to a server-enforced field boundary. Return cost-bearing data only through a role-authorized RPC/view or a separately protected data path. Test both direct `products` reads and valuation RPC calls with users from different roles.

### HR-03 — P0: Posted financial records are not sufficiently protected from direct mutation

**Live privileges and policies observed:**
- Authenticated users have table-level DELETE privilege on `folio_charges`; the RLS delete policy permits `can_backoffice(property_id)`.
- Authenticated users have table-level UPDATE privilege on `payments`; the RLS update policy permits `can_backoffice(property_id)`.
- Authenticated users have table-level UPDATE privilege on `pos_receipts`; the RLS update policy permits `can_backoffice(property_id)`.

The inspected `can_backoffice` function checks subscription access and staff module access. It does not itself enforce an immutable-posted-ledger rule or require a reason-coded compensating transaction.

The trigger inspection found only foreign-key constraint triggers on these financial tables, not a custom immutable-ledger guard trigger.

**Risk:** an otherwise authorized back-office user may be able to change or delete posted financial source records directly rather than using an audited reversal/adjustment flow. This can undermine folio balances, cashier reconciliation and management reports.

**Required remediation:**
1. Deny ordinary direct UPDATE/DELETE on posted charges, payments and receipts.
2. Make corrections through transactional, reason-coded reversal/adjustment RPCs.
3. Preserve actor, timestamp, original record reference, amount and approval evidence.
4. Add tests proving that posted financial rows cannot be silently edited/deleted through direct table APIs.
5. Verify the existing Phase 10 financial-ledger protections against the current live schema; the current live policies show the protection is not complete across these tables.

### HR-04 — P1: Check-in is missing a row lock and duplicate room-charge protection

**Evidence:** live `fn_check_in_reservation` reads a booked reservation without `FOR UPDATE`, then updates the reservation and room and inserts a room folio charge if one does not already exist.

The live `folio_charges` indexes include a primary key and a reservation lookup index, but no unique index enforcing one room charge per reservation/source.

**Risk:** two concurrent check-in requests can both pass the initial booked-state check and both observe that no room charge exists. This can produce duplicate room charges or inconsistent check-in transitions.

**Required remediation:**
- Lock the reservation row before validating status.
- Revalidate reservation and room state after the lock.
- Enforce one room-charge posting per reservation/source with an appropriate database uniqueness rule or an equivalent transactional invariant.
- Test repeated and concurrent check-in attempts and ensure only one room charge is created.

### HR-05 — P1: Latest POS table-join/quantity-void migration is not present in the live database

**Repository evidence:** main contains `supabase/migrations/20261110190000_fix_pos_table_join_and_quantity_voids.sql`, merged with PR #145 in commit `58d4747a169fea7ff0f26c7c909a552906203d03`.

The migration updates `fn_move_or_merge_pos_table` and `fn_remove_pos_item`, including quantity-aware void rules and preservation of VAT/KOT snapshots.

**Live database evidence:**
- The applied migration ledger contains 59 entries and does not contain version `20261110190000`.
- A read-only check of the live function definitions did not find the new migration's identifying VAT-mismatch or sent-quantity validation logic.

**Risk:** the frontend code and the production database may be on different contracts. The latest table join/quantity-void behaviour cannot be considered deployed merely because the frontend commit merged or a Vercel status is successful.

**Required remediation:**
1. Inspect the migration and its dependencies against the current production schema.
2. Run the migration's isolated PostgreSQL regression test against the candidate SQL.
3. Confirm the actual live function definitions and migration provenance.
4. Obtain explicit production-migration authorization.
5. Apply only through the reviewed migration process, then verify the live function bodies and run the POS regression suite.

**No migration was applied as part of this audit.**

### HR-06 — P1: POS floor zones, tables and waiter names are local prototype state

**Evidence:**
- `AppStore.jsx` initializes zones and staff from `INITIAL_ZONES` and `INITIAL_STAFF` in `src/data/mockData.js`.
- `addZone`, `renameZone`, `removeZone`, `addTable`, `removeTable`, `updateTable`, `moveTable`, `addStaff`, `updateStaff` and `removeStaff` update React state only.
- `FloorPlan.jsx` stores table positions and shape in browser `localStorage`.
- The live schema has persistent POS table sessions, but no corresponding shared zone/table-layout configuration table was found in the public table inventory.

**Additional evidence:** the default zone IDs (`bar`, `pool`, `room`) are reused across properties, while `FloorPlan.jsx` uses global browser keys (`tableLayoutPositions`, `tableShapeMode`) rather than property-scoped keys. The waiter list is seeded with sample names (Amina Kariuki, John Mwangi, Grace Wanjiru, Peter Otieno and David Lumumba), not loaded from the property's staff table.

**Risk:** a floor layout or waiter list changed on one workstation may not be available on another terminal and may reset when the application state is recreated. Because the localStorage keys and default zone IDs are not property-scoped, table-position preferences can also carry across properties in the same browser. Per-browser localStorage is not a hotel-wide configuration source.

**Required remediation:** create a property-scoped server-owned floor-plan configuration with stable table IDs, zones, seat counts, display names and layout metadata. Load and save it through authorized services; retain localStorage only for device-specific visual preferences.

### HR-07 — P1: POS persistence failures can be hidden behind optimistic local state

**Evidence in `AppStore.jsx`:**
- Failed table-session saves are caught, logged to the console and converted to `null`.
- Table sessions are updated in local React state before persistence is confirmed.
- `fireKitchenOrder` catches a failed `createKitchenOrder` call, keeps the local draft and continues the workflow.
- Failed KDS hydration logs an error and sets the queue to an empty array.
- Failed session hydration logs an error and leaves the session map empty.

**Risk:** staff may see an order/table on one terminal and assume it is safely persisted when the server write failed. A refresh or another terminal may then show a different state. A failed KDS load may look like an empty kitchen queue.

**Required remediation:**
- Make persistence status visible to operators.
- Distinguish saved, pending, failed and local-only states.
- Do not silently treat a failed database write as a successful durable order.
- Provide safe retry with stable IDs/idempotency.
- Keep payment/receipt success independent from printing, but never confuse print success with transaction persistence.

### HR-08 — P1: PMS reload can silently replace failed data sources with empty lists

**Evidence in `PmsStore.jsx`:** the provider uses `Promise.allSettled`. A room-list failure is fatal, but failures from reservations, guests and rate plans are converted to empty arrays. The visible error is only explicitly set for room-type failure.

**Risk:** a temporary backend, permission or network error can make the reservation/guest list appear empty instead of clearly reporting that data failed to load. This can mislead front-desk staff.

**Required remediation:** preserve the last known good data, show per-resource load errors, prevent empty-state messaging from being displayed as a confirmed empty database result, and provide an explicit retry state.

### HR-09 — P1: Night audit and management reporting need hotel-accounting reconciliation

**Night audit evidence:**
- `fn_night_audit_precheck` marks the day ready when open cashier shifts and pending cashier adjustments are both zero.
- `fn_run_night_audit` checks those same conditions, summarizes POS receipts and approved cashier adjustments, writes a night-audit record and advances the property business date.
- Its `room_revenue` value is populated from POS receipts whose payment method is `room`; this is restaurant/POS room-charge revenue, not accommodation revenue from room folio charges.
- The live database currently has zero night-audit records and zero property business-date rows.

**Management-report evidence:**
- `fn_management_report` calculates room revenue from reservation rate multiplied by overlapping stay nights.
- Its occupancy calculation counts room nights from all non-cancelled reservations, including reservations whose status is still booked; this is booked/contracted room-night occupancy rather than necessarily actual occupied-room nights.
- `fn_management_sales_detail` groups tender by the receipt-level `payment_method`. Split-payment allocation detail should be reconciled against `pos_receipt_payments` so split tenders are not misrepresented.

**Risk:** the screens may work, but the numbers should not yet be marketed as a complete hotel accounting close or actual occupancy/revenue pack.

**Required remediation:**
- Define the accounting meaning of room revenue, occupancy, ADR and RevPAR.
- Reconcile room revenue to posted folio charges and approved adjustments.
- Reconcile POS room-charge sales separately from accommodation revenue.
- Reconcile split-tender amounts from payment allocations.
- Define tax, refunds, voids, discounts, cashier variance and business-date rules.
- Run a full end-to-end night-audit test with a representative hotel dataset before using it for a live close.

### HR-10 — P1: Offline-first operation is not implemented end to end

The repository's own developer guide identifies IndexedDB durable outbox synchronization and the shared LAN Edge Server as target capabilities, not completed features.

Persistent POS sessions and KDS records are not equivalent to offline-first operation.

**Required remediation:** implement and test a durable outbox, stable idempotency keys, server-side replay, expired-session recovery, domain-specific conflict resolution and (for multiple hotel terminals during an internet outage) a secured local LAN Edge Server.

### HR-11 — P1: Two printer configuration paths need a canonical ownership decision

**Evidence:**
- `posService.js` lists/saves POS printers through `fn_list_pos_printers` and related RPCs.
- `printService.js` loads printers from `property_printers` and assignments from `printer_assignments`.
- Live counts show zero `pos_printers` rows, one `property_printers` row and eight assignments.

These may represent different transport/routing responsibilities, but the same product uses both code paths.

**Risk:** staff may configure a printer in one screen while another workflow reads a different registry.

**Required remediation:** map every screen and print workflow to its source registry, define one authoritative configuration model or an explicit adapter, and test receipt, bill, kitchen, refund and retry routing on real devices.

## 6. Supabase advisor snapshot

Observed from the connected live project:

### Security
| Finding | Count / status | Interpretation |
|---|---:|---|
| RLS disabled on public tables | 0 | Positive |
| RLS enabled but no policies | 3 | `pos_access_credentials`, `pos_access_pin_attempts`, `staff_pin_attempts`; may be intentional deny-by-default service/RPC-only tables |
| Authenticated-executable SECURITY DEFINER functions | 112 | Review queue, not 112 proven vulnerabilities |
| Anon-executable SECURITY DEFINER functions | 1 | `fn_public_booking_engine_config(uuid)`; verify public exposure is intentional and only returns public settings |
| Leaked-password protection | Disabled | Enable in Supabase Auth configuration |

### Performance
| Finding | Count |
|---|---:|
| Unindexed foreign keys | 49 |
| Unused indexes | 102 |
| Multiple permissive policies | 21 |

Unused-index findings should be reviewed against actual workload before dropping indexes. Unindexed foreign keys should be prioritized by table size and query pattern. Multiple permissive policies need a policy-by-policy OR-semantics review.

Health advisor returned no lints in this snapshot.

## 7. Main branch / release verification

- Current main merge commit inspected: `58d4747a169fea7ff0f26c7c909a552906203d03`.
- GitHub combined commit status showed a successful Vercel status.
- No test/build/lint result was exposed in the combined status response for this merge commit.
- The repository has `build`, `lint`, `typecheck` and `test:architecture` scripts.
- The isolated POS table-join/quantity-void SQL regression files and workflow are present in the repository, but this audit did not establish a passing workflow run for the merged change.
- No local checkout was available to run npm commands during this inspection.

**Do not interpret a successful Vercel deployment status as proof that database migrations, SQL regression tests, lint, typecheck and the full hotel workflow suite all passed.**

## 8. Feature readiness matrix

| Domain | Current status | Evidence-based assessment |
|---|---|---|
| Property onboarding / membership | PARTIAL | Real property and membership records; role/tenant negative tests remain |
| Reservations / availability | CORE IMPLEMENTED | Room-scoped advisory lock exists; concurrent regression still required |
| Check-in | PARTIAL | Lifecycle works, but no reservation row lock or unique room-charge invariant |
| Front-desk payments | CORE GUARDS PRESENT | Reservation lock and overpayment guard; financial ledger mutation controls need work |
| Checkout / housekeeping handoff | CORE IMPLEMENTED | Outstanding balance guard and dirty-room/task handoff |
| Folio / financial ledger | P0 BLOCKED | Direct financial mutation policies/privileges need hardening |
| Restaurant POS | PARTIAL / REAL | Persistent sessions, receipts and sale RPCs; latest migration parity issue |
| Table joins / quantity voids | NOT VERIFIED LIVE | New migration is merged but absent from live ledger/function markers |
| KDS | PARTIAL / REAL | Persisted orders exist; failure paths can silently continue locally |
| Cashier shifts | CORE IMPLEMENTED | Shift locking, open-table closure guard and variance controls |
| Inventory / purchasing | P0 BLOCKED | Sensitive mutation RPC role checks and cost visibility need remediation |
| Housekeeping | PARTIAL / UNVERIFIED | Module exists; no housekeeping task rows in live snapshot |
| Night audit | PARTIAL / NOT EXERCISED | Atomic date advance and shift checks exist; scope/financial reconciliation incomplete |
| Reports | PARTIAL | Live reporting RPCs; occupancy, room revenue and split tender semantics need reconciliation |
| Printing | PARTIAL / REAL | Print jobs/logs and assignments exist; two configuration paths and hardware matrix remain |
| Multi-terminal floor plan | NOT READY | Zones/tables/waiters are local state, not shared property configuration |
| Multi-property user session selection | PARTIAL | Login resolves the first returned membership; no explicit active-property choice is established for users assigned to multiple properties |
| Offline operation | NOT IMPLEMENTED END TO END | No proven durable outbox/replay/conflict system |
| Native Windows / Android | NOT IMPLEMENTED | Current app remains browser-hosted Vite/React |
| Build / regression certification | UNVERIFIED IN THIS AUDIT | No local build/test execution; only Vercel status observed |

## 9. Recommended remediation order

### P0 — Close before full production reliance
1. Fix inventory RPC role/entitlement enforcement and add direct-RPC negative tests.
2. Protect buying cost at the database boundary.
3. Protect posted folio charges, payments and receipts from direct mutation; enforce reversal-only corrections.
4. Reconcile and safely deploy the merged POS table-join/quantity-void migration after isolated regression testing.

### P1 — Close before broad hotel rollout
5. Lock check-in and enforce one room-charge posting.
6. Make table zones, tables and waiter configuration property-scoped and server-persistent.
7. Surface POS/KDS/PMS persistence failures and avoid false empty/saved states.
8. Reconcile night audit and management-report definitions against folios, payments, POS allocations and actual occupied room nights.
9. Establish one clear printer configuration/routing contract.
10. Complete offline queue/reconnect design and multi-terminal tests if offline operation is part of the release promise.

### P2 — Hardening
11. Review all SECURITY DEFINER functions and grants individually.
12. Enable leaked-password protection.
13. Review 49 unindexed foreign keys, 102 unused indexes and 21 multiple-permissive-policy warnings.
14. Add automated two-property/two-role negative tests and browser critical-path tests.
15. Add a property selector if users must operate multiple properties under one login.

## 10. Required acceptance tests for a hotel pilot

A pilot should not be signed off until the following scenarios pass with at least two properties and representative roles:

1. Reservation create/edit/move/group booking with concurrent overlapping attempts.
2. Check-in twice concurrently; exactly one room charge must be posted.
3. Front-desk payment partial/exact/overpayment and concurrent attempts.
4. Checkout with outstanding balance, exact settlement and housekeeping handoff.
5. POS cash/card/M-Pesa/bank/room/split payment; duplicate request replay must not create a second sale.
6. POS table move/join, partial item void, over-void rejection, manager authorization and audit history.
7. KDS save/reload across two terminals and recovery after a failed server write.
8. Cashier shift close with open tables, pending adjustments and variance approval.
9. Inventory adjustment/count/transfer/receiving/production/wastage with role denial and location reconciliation.
10. Direct API attempts to read buying cost and mutate posted financial records as unauthorized roles.
11. Printer assignment and test printing for receipt, bill, kitchen, refund and retry on actual supported devices.
12. Night audit with room folios, POS room charges, split payments, refunds, voids, discounts and business-date rollover.
13. Network interruption during POS/PMS writes, refresh, reconnect and duplicate replay.
14. Property A user attempting to read or mutate Property B records through direct table and RPC calls.

### HR-12 — P1: Login does not provide a deterministic multi-property selection flow

**Evidence:** `authService.js` loads up to ten property memberships and chooses the first membership row containing a property. The code comment explicitly says the login/onboarding flow currently resolves one primary property even though a person can belong to more than one property.

**Risk:** if one staff/owner account is assigned to multiple hotels, the selected property may depend on returned membership ordering. Users do not have a clear, deliberate property context at sign-in, which is important for cross-property reporting and safe operational work.

**Required remediation:** add an explicit property selector or a persisted active-property selection with server-side membership validation. Ensure every query, mutation, subscription and printer routing operation uses the selected property context and that switching property clears stale client state.

## 11. Audit conclusion

OliTechs has genuine PMS/POS functionality and live persistence. The database records and user's manual tests demonstrate meaningful progress. Reservation availability, payment posting, checkout guards, POS sales, cashier shift controls, KDS and printing all have substantial implementation.

The largest remaining risk is **not whether a screen opens**. It is whether a user with the wrong role can bypass the UI, whether posted money/stock records can be altered, whether the latest frontend and database versions match, and whether the application truthfully reports failed persistence.

Close the P0 items, complete the P1 reliability work, then run the full two-property hotel acceptance suite. Only after that should OliTechs be described as ready to replace an established hotel PMS/POS without a parallel fallback.

---

**Audit boundary:** documentation only. No code, schema, migration, customer data or production setting was changed.
