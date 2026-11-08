# POS Order Screen V2 — Phase 0 Audit

**Repository:** `olitechs/olitechpmspos`  
**Baseline:** `main`  
**Working branch:** `feat/pos-order-screen-v2`  
**Audit type:** Source-only; no live property database or printer hardware was accessed.

## Executive summary

The active order screen is `src/components/pos/OrderTaking.jsx`. It is an operational POS screen, not a mock-up. The current implementation already loads property-scoped menu products, supports modifiers, keeps per-table order lines, calculates VAT, records control voids, and hands kitchen/bar printing to existing services. The redesign should replace only the menu browsing presentation and extend the menu-layout metadata in a controlled way. The order lifecycle and service contracts must remain intact.

## Phase 0 findings

| Area | Current implementation | Required change / risk |
|---|---|---|
| Menu source | `inventoryService.listPosMenu(propertyId)` calls `fn_list_pos_menu`; fallback categories/items come from `src/data/mockData.js`. | Load the category table and products as separate collections; keep demo fallback isolated from property data. |
| Categories | `OrderTaking.jsx` derives categories from distinct product category strings. `pos_menu_categories` already stores name, production center, sort order and active state. | Use stable category IDs, explicit hierarchy and presentation metadata; do not rename existing records automatically. |
| Navigation | One selected category at a time; horizontal category strip on small screens and vertical navigation on larger screens. | Replace with root category tiles, category product tiles, breadcrumb/back navigation and responsive order sheet. |
| Search | One search input filters only the selected category; `filterPosMenuItems` performs lowercase substring matching on product name. | Add root category + all-item search, category-scoped search, normalized matching and SKU/barcode resolution. |
| Product states | `getPosStockStatus` derives available/low/out-of-stock from current stock and minimum stock. Out-of-stock products are disabled in the current grid. | Preserve the existing block behavior unless a server-authoritative stock policy is exposed. Display remaining quantity and order count. |
| Modifiers | `posPhase3Service.getItemModifiers` loads modifier groups; a required-selection dialog is already present. | Preserve this dialog and make it reachable from the product tile without changing modifier pricing or line IDs. |
| Order panel | Existing ticket panel shows table, order number, quantities, modifiers, subtotal, VAT and total; sent-line removals require reason/manager PIN and may print a void slip. | Restyle without replacing order-line mutation, void authorization, VAT or totals logic. |
| Kitchen/bar | Order lines carry production center. `POSContainer.jsx`, print routing services and KDS services own firing and printing. | Keep the product's production center and current ticket-routing path unchanged. |
| Persistence | `AppStore.jsx` and `posService.js` maintain table sessions and order snapshots; KDS has a separate persistent service path. | Do not move authoritative order/session state into the new menu component. |
| Menu editor | `MenuManager.jsx` supports category creation, product CRUD, imports and exports. It does not provide drag/drop layout, per-outlet visibility, tile appearance, hierarchy, or data-quality actions. | Extend the existing manager behind its current route/permission boundary; avoid a second competing editor. |
| Theme | `src/index.css` is the canonical single source for CSS color values and the app is light-only. | Add the requested category palette as CSS variables in that file only; components consume semantic token names. |

## Tenant and schema observations

- Existing menu reads are keyed by `property_id`; the category table and product catalogue are property-scoped in the current code.
- The current menu schema does not expose a confirmed `business_id` / `branch_id` pair. POS outlet/store context exists elsewhere in the application. Do not guess that a store ID is a branch ID or add an unverified tenant column.
- The current `fn_list_pos_menu(p_property_id)` definition in the original catalogue migration filters rows by `property_id`, but that migration's function body does not itself check property membership. Existing audit material separately flags a cross-property authorization concern for this RPC. Before extending menu reads, verify the latest deployed function and add negative cross-property tests. A client-supplied property ID is not authorization.
- All new reads/writes must retain the existing property scope and be protected by server-side authorization/RLS. Outlet and terminal filters should be added only after their actual schema and permission model are verified.

## Protected integrations

The following existing contracts are out of scope for a visual rewrite:

- `OrderTaking` props and its order-line update contract.
- `AppStore` table-session hydration and order snapshots.
- `posService` active-session and KDS operations.
- `pmsService.removeOrderItem` and manager-PIN approval.
- `posPhase3Service` modifier groups.
- `printService`, `printRoutingService`, `printerStore` and local Print Agent at `127.0.0.1:8631`.
- `BillPayment`, receipt creation, room folio charges, cashier shift reconciliation and Shift Report.

## Data quality report — evidence limits

The live property's complete category catalogue could not be queried in this source-only audit. The list below records only suspected issues explicitly identified in the supplied brief and must be checked against the live category rows before any mutation.

| Suspected value(s) | Classification | Current status | Safe action |
|---|---|---|---|
| `CAFFEE` / `Caffetteria` | Possible duplicate / inconsistent naming | Unverified against live data | Present as a suggested match; require an authorized user to choose Rename or Merge. |
| Mixed uppercase and Title Case category names | Display consistency issue | Expected in legacy records; exact row count unknown | Use a derived display label only; preserve the stored name. |
| `ACCOMMODATION` display truncation | Presentation defect | Reported in current navigation | Allow wrapping and tooltip; do not shorten the stored category name. |

No category or product has been renamed, merged, hidden or deleted. The editor's eventual Merge/Rename actions must require confirmation, write an audit/history record, and preserve original identifiers and references. A complete report requires a read-only export of the property's current category rows.

## Phase 0 baseline and verification limits

- Confirmed the repository default branch is `main` and created `feat/pos-order-screen-v2` from it.
- Confirmed scripts: `npm run lint`, `npm run build`, `npm run typecheck`, and `npm run test:architecture`.
- A local checkout could not be obtained because the execution environment cannot resolve `github.com`; therefore no lint/build/test result is claimed.
- No Supabase branch, migration execution, production deployment, or printer job was initiated.

## Phase 1 implementation update

Implemented in `src/components/pos/OrderTaking.jsx`:

- Replaced the single-level category strip with a responsive root category tile grid.
- Added category-to-product navigation with a back action and category item counts.
- Added all-menu product search from the root view and category-scoped search inside a category.
- Added category labels, price, stock state, out-of-stock blocking, and aggregate in-order quantity badges to product tiles.
- Preserved the existing `addItem`, modifier selection, `commitItem`, order-line callbacks, ticket totals, send-to-kitchen, bill, table move and control-void flows.
- Kept product production-center metadata on order lines so existing Kitchen/Bar routing remains in control.

**Verification status:** source changes are committed to the feature branch. No local lint/build/test run or browser interaction test is claimed because a working checkout/runtime is unavailable in this session. GitHub Actions has not yet reported a PR run for this commit.

## Phase 2 and Phase 3 implementation update

**Phase 2 — responsive order panel**
- Added a compact mobile order summary bar with item count and total.
- Added a collapsible mobile order sheet; desktop keeps the full-height ticket panel.
- Kept line quantity controls, VAT/totals, Send & Print Ticket, Request Bill, and Move/Join Table actions inside the existing panel.
- The mobile sheet is a presentation-only state; it does not own or persist the order.

**Phase 3 — menu search and catalogue ordering**
- POS now loads active category rows through `inventoryService.listPosCategories(propertyId)` and uses their configured sort order, with product-derived categories as a fallback.
- Search normalizes case and diacritics, matches all query tokens, and includes product name, SKU and category.
- Product tiles show SKU when configured.
- The current schema/API exposes SKU but no verified barcode field or scanner contract. Barcode input is therefore not claimed or implemented.

**Tests added:** `src/components/pos/stockStatus.test.mjs` now covers accent-insensitive, SKU and multi-token category search. The test is part of the repository's `test:architecture` script.

**Verification limitation:** GitHub reports no workflow runs for the latest commit in the PR. The test has been added but has not been executed in this session. No lint/build/test pass is claimed.

## Phase 4 implementation update — existing Menu Manager

Implemented in `src/components/pos/MenuManager.jsx` using the existing category service and schema:

- Added up/down controls to change category display order.
- Saves the reordered categories through `inventoryService.upsertPosCategory`, which updates the existing `sort_order` field.
- Shows each category's production center and current product count.
- Dispatches the existing `olitech:menu-updated` event after a successful reorder so the active POS refreshes its catalogue.

No new table, column, migration, or browser-local persistence was introduced. Category rename/merge/delete and per-outlet/terminal overrides remain out of scope because they require explicit data cleanup policy and a verified outlet/terminal ownership model. The existing schema provides property-level category order only.

## Implementation sequence

1. ~~Add reusable category/product tile browser and two-level navigation while preserving the current order panel API.~~
2. Restyle the order panel and add the phone bottom-sheet behavior.
2. Restyle the order panel and add the phone bottom-sheet behavior.
3. Add fast normalized search and SKU/barcode resolution using the existing product data.
4. Extend the current menu manager and add additive, property-scoped layout metadata only after schema/authorization review.
5. Verify stock, department routing, room charges, KDS, receipts, cashier and shift-report integrations.
6. Add component/service tests and run repository checks in a working checkout; capture responsive screenshots after a browser environment is available.
