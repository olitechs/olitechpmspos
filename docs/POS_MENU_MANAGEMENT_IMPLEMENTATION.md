# POS Menu Management — Implementation Log

Branch: `feat/pos-menu-management-v2`
Base: `c8eb3453` (`main`, which already contains PR 194 visual permissions and PR 195 layout)

## 1. Scope

Presentation and reliability only:

- ordering of categories and products
- explicit enable/disable, including on the till
- rename consistency between categories and products
- duplicate-submit and stale-response protection
- a pinned modal frame with a single scrolling body
- manager-only price and stock controls

No entitlement, RLS, `business_id` / `branch_id` isolation, receipt, printer, offline or order-taking behaviour was weakened.

## 2. Reconciliation with PR 194

PR 194 had already shipped a stricter permission model on `main`. This branch keeps it intact instead of replacing it:

- `MenuVisualEditor.jsx` is untouched.
- `MenuManager` routes `cashier`, `store_manager` and `storekeeper` to `MenuVisualEditor` before rendering any catalogue controls.
- Visual writes continue to use `fn_update_pos_menu_item_visuals`; the older direct-table visual patch was dropped.
- `subscribePosMenu` (Postgres realtime on `products` and `pos_menu_categories`) is the single cross-terminal mechanism. The duplicate broadcast module from the first draft was not carried over.
- Local edits still announce `olitech:menu-updated` so the current terminal refreshes immediately.
- The manager product editor keeps PR 194's photo upload path (`uploadPosMenuItemImage`) and adds a preview.

## 3. Files changed

- `src/lib/posMenuAdmin.js` (new) — pure role checks, ordering helpers, grouping, filtering and draft normalisation. `PRICE_STOCK_ROLES` intentionally excludes `store_manager` / `storekeeper` so they remain appearance-only.
- `src/components/pos/MenuManager.jsx` — redesigned manager view: Products/Categories tabs, search, category filter, grouped list, ordering, visibility toggles, category editor, request-token guard, duplicate-submit guard, pinned shared modal frame, photo upload, visual-only routing.
- `src/components/pos/OrderTaking.jsx` — keeps PR 194's `subscribePosMenu(propertyId, refresh)`; adds disabled-category filtering while leaving products in unconfigured (legacy) categories visible.
- `src/services/inventoryService.js` — adds `listPosMenuAdmin`, `listPosCategoriesAdmin`, `updatePosCategory` (duplicate-name check and rename cascade), `setPosCategoryActive`, `reorderPosCategories`, `setPosMenuItemPosActive` and `reorderPosMenuItems`. Existing RPC visual update and realtime subscription are unchanged.
- `src/lib/posMenuAdmin.test.mjs` (new)
- `src/components/pos/MenuManager.contract.test.mjs` (new)
- `docs/POS_MENU_MANAGEMENT_IMPLEMENTATION.md` (this log)

## 4. Database changes

None on this branch.

PR 194's migration `supabase/migrations/20261119180000_pos_menu_visual_permissions_live_sync.sql` already provides `can_edit_pos_menu_visuals`, the restricted visuals RPC, the photo-upload storage policy and the realtime publication. This work uses existing columns only:

- `products.pos_sort`, `pos_enabled`, `pos_active`, `pos_category`, `production_center`, `tile_color`, `tile_text_color`, `tile_image_url`
- `pos_menu_categories.sort_order`, `active`, `production_center`, `tile_*`

The category-rename cascade is the only bulk data write, and it only moves `products.pos_category` from the old name to the new name inside the same property.

## 5. Permissions

- Cashiers, storekeepers and store managers never reach the price/stock form; they get `MenuVisualEditor` and the server-side visuals RPC.
- Managers keep full catalogue control through the existing manager-gated RPC and the role rules already enforced by RLS.
- Appearance fallback saves in `MenuManager` also go through the restricted visuals RPC, never a direct table write.
- The Categories tab is offered only to roles accepted by `can_manage_pos_menu`; storekeepers no longer see controls that RLS would reject.
- Known pre-existing server-side gap (unchanged here): the `products_update` RLS policy lets `can_manage_pos_menu` update any product column. The UI restriction is not a substitute for a future column-level policy.

## 6. Tests

`src/lib/posMenuAdmin.test.mjs`

- price/stock role matrix (management only)
- category-management role matrix mirroring `can_manage_pos_menu`
- immutable move, order payload renumbering, next sort value
- category/product grouping order
- search and category filtering
- draft normalisation keeps `max_stock` and visuals
- safe empty draft defaults

`src/components/pos/MenuManager.contract.test.mjs`

- admin load includes inactive rows, `max_stock` and visuals
- saving preserves `max_stock` and the visibility flag
- duplicate submits blocked; loading state always resolves
- save/cancel closes the editor and refreshes
- pinned modal frame with a scrolling body
- price/stock hidden for appearance-only roles
- cashier/storekeeper/store manager routed to `MenuVisualEditor`
- appearance fallback uses only the restricted visuals RPC
- category tab gated by the role helper
- per-row ordering writes only the order column
- visual updates use `fn_update_pos_menu_item_visuals`
- photo upload helper and editor control
- stale responses ignored
- Escape closes the editor before the manager
- local event plus Postgres realtime, with no duplicate broadcast module
- rename cascade and disabled-category filtering

PR 194's own contracts continue to run unmodified:

- `src/components/pos/menuVisualPermissions.contract.test.mjs`
- `src/components/pos/menuFloorVisuals.contract.test.mjs`

## 7. Commands and results

| Command | Result |
| --- | --- |
| `node --test src/lib/posMenuAdmin.test.mjs src/components/pos/MenuManager.contract.test.mjs src/components/pos/menuVisualPermissions.contract.test.mjs src/components/pos/menuFloorVisuals.contract.test.mjs` | 33 pass, 0 fail |
| `npm run lint` | exit 0 (brand, colour-token, link and route audits passed) |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 (`built in 30.59s`), brand assets restored by `postbuild` |
| `npm run test:architecture` | 545 tests: 541 pass, 3 fail, 1 skipped |

The three architecture failures are unrelated and pre-existing in this environment:

- `tools/print-agent/server.lifecycle.test.mjs` (three lifecycle/agent start tests) fails because the workspace path contains a space (`Reception Visiwa`). Node 26's ESM loader rejects the resulting `c:` URL scheme when the test spawns the agent.
- No print-agent file was modified by this branch. The failures are environmental, not caused by the POS menu work.

## 8. Runtime and deployment verification

Not performed from this environment.

- No `.env` / Supabase credentials are present, so authenticated runtime verification renders only `SupabaseSetupNotice`.
- Cross-terminal realtime needs a live Supabase Realtime project; the subscription contract is covered by tests.
- No new migration is required for this branch. PR 194's migration status must be confirmed against the production database separately.
- Deployment must be verified from the Vercel dashboard against the final merge commit before claiming success.
