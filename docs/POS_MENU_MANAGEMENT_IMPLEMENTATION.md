# POS Menu Management — Implementation Log

Branch: `feat/pos-menu-management`
Base: `d3770a70` (`fix/global-layout-contrast`, includes layout Phase 1 checkpoint)

## 1. Skills

Skill discovery was done before any code was changed.

- The repository already ships a large curated skill library in `.opencode/skills/` and `.agents/skills/` (design-system, ui-styling, shadcn, professional, refined, clean, enterprise, minimal, spacious, modern, plus style families).
- The relevant existing skills were inspected and used as guidance: `design-system`, `professional`, `refined`, `clean`, `ui-styling`, `shadcn`.
- No external skill from `github.com/topics/agent-skills` was installed: the required React / UI-UX / Supabase / testing coverage already exists locally, and installing a duplicate or externally-fetched skill would have violated the "avoid duplicated or untrusted skills" rule. No third-party install script was executed.

## 2. Files inspected

- `src/components/pos/MenuManager.jsx`
- `src/components/pos/OrderTaking.jsx`
- `src/components/pos/POSContainer.jsx`
- `src/components/pos/settings/tabs/MenuTab.jsx`
- `src/components/pos/POSSettings.jsx`
- `src/components/pos/stockStatus.js`
- `src/services/inventoryService.js`
- `src/services/posMenuImportContract.test.mjs`
- `src/components/pos/posMoneyUsage.contract.test.mjs`
- `src/components/ui/system.jsx`, `src/components/ui/dialog.jsx`
- `src/index.css`
- `supabase/migrations/0056_pos_menu_catalogue.sql`
- `supabase/migrations/20261108140000_pos_menu_tile_visuals.sql`
- `src/data/modules/navigationRouting.test.js` (shell contracts)

## 3. Root causes found

1. **`max_stock` was lost on every edit.** `fn_list_pos_menu` does not return `max_stock`, so the editor held `undefined` and wrote `0` back through `fn_upsert_pos_menu_item`.
2. **Visual saves could blank images and colours.** `updatePosMenuItemVisuals` always wrote all three columns with `|| null`, even when the caller did not supply them.
3. **No duplicate-submit guard.** Double-clicking Save ran the RPC twice and could create duplicate products.
4. **Stuck / overflowing editor.** The panel had no max height and no internal scroll region, so the footer could leave the viewport on small POS screens.
5. **No ordering UI.** `products.pos_sort` and `pos_menu_categories.sort_order` existed but were never editable, so refresh reverted to name order.
6. **No enable/disable control.** `pos_active` could not be changed from the manager, and disabled categories were not hidden on the till.
7. **Category rename orphaned products.** Renaming a category left `products.pos_category` on the old name, so items disappeared from the POS category strip.
8. **Category reorder wrote whole rows**, which could overwrite concurrent appearance edits.
9. **Disabled categories still appeared on the POS** because `OrderTaking` merged every product category.
10. **Storekeepers could not save at all.** Their role passes `products_update` RLS via `can_store_write`, but is intentionally absent from `can_manage_pos_menu`, so the catalogue RPC raised and the editor appeared to hang with no save.
11. **No cross-terminal propagation.** A change on one terminal never reached other open tills.
12. **Stale async responses could overwrite newer data** when switching categories quickly.

## 4. Files changed

- `src/lib/posMenuAdmin.js` (new) — pure role checks (`canEditPriceAndStock`, `canManageMenuCategories`, `canManageAppearance`), ordering (`moveWithin`, `buildOrderPayload`, `nextSortOrder`), grouping (`groupMenuItems`), filtering and draft normalisation.
- `src/lib/posMenuChannel.js` (new) — property-scoped Supabase broadcast channel `olitech-pos-menu:<propertyId>`; broadcast-only, so stock movements on `products` do not trigger menu refreshes.
- `src/components/pos/MenuManager.jsx` — full redesign: Products/Categories sections, search, category filter, grouped list, ordering, visibility toggles, category editor, pinned modal frame with a scrolling body, request-token guard, duplicate-submit guard, role-gated price/stock fields, appearance-only save path.
- `src/components/pos/OrderTaking.jsx` — subscribes to the broadcast channel; hides products whose category is explicitly disabled while keeping legacy products whose category has no catalogue row.
- `src/services/inventoryService.js` — `listPosMenuAdmin`, `listPosCategoriesAdmin`, `updatePosCategory` (duplicate-name check + rename cascade), `setPosCategoryActive`, `reorderPosCategories`, `setPosMenuItemPosActive`, `reorderPosMenuItems`, partial `updatePosMenuItemVisuals`.
- `src/lib/posMenuAdmin.test.mjs` (new)
- `src/components/pos/MenuManager.contract.test.mjs` (new)
- `docs/POS_MENU_MANAGEMENT_IMPLEMENTATION.md` (this log)

## 5. Database changes

None. This work uses columns that already exist:

- `products.pos_sort`, `pos_enabled`, `pos_active`, `pos_category`, `production_center`, `tile_color`, `tile_text_color`, `tile_image_url`
- `pos_menu_categories.sort_order`, `active`, `production_center`, `tile_*`

No migration was added, no policy changed, and no data was rewritten beyond the explicit category-rename cascade (which only updates `products.pos_category` from the old name to the new name inside the same property).

## 6. Permissions

- Price, stock, minimum stock and maximum stock inputs are rendered only for management roles.
- Cashiers and storekeepers get a read-only product summary plus tile colour, text colour, image URL and visibility.
- Appearance-only saves patch the three visual columns directly and never call the manager-gated `fn_upsert_pos_menu_item`.
- The Categories section is offered only to roles the database `can_manage_pos_menu` helper accepts; storekeepers no longer see controls that RLS would reject.
- Existing RLS policies, package entitlements and `business_id` / `branch_id` isolation are unchanged.

## 7. Tests added

`src/lib/posMenuAdmin.test.mjs`
- role matrix for price/stock editing
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
- pinned modal frame with scrolling body
- price/stock hidden for appearance-only roles
- appearance-only path saves visuals without the RPC
- category tab gated by the role helper
- per-row ordering writes only the order column
- visual updates only patch supplied keys
- stale responses ignored
- Escape closes the editor before the manager
- broadcast on edit, subscription cleanup on the till
- rename cascade and disabled-category filtering

## 8. Commands and results

| Command | Result |
| --- | --- |
| `node --test src/lib/posMenuAdmin.test.mjs src/components/pos/MenuManager.contract.test.mjs` | 24 pass, 0 fail |
| `node --test src/services/posMenuImportContract.test.mjs src/components/pos/posMoneyUsage.contract.test.mjs` | 6 pass, 0 fail |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 (3507 modules, `built in` reported) |
| `npm run test:architecture` | 451 tests, 450 pass, 1 skipped, 0 fail |

## 9. Production deployment verification

Not performed from this environment.

- No `.env` / Supabase credentials are present, so authenticated runtime verification renders only `SupabaseSetupNotice`.
- Cross-terminal Realtime requires a live Supabase Realtime project.
- No production migration is required for this change.
- Deployment must be verified from the Vercel dashboard against the merge commit before claiming success.
