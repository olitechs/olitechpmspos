# OliTechs POS Order Screen V2

## Component structure

The active runtime is the root Vite + React application. Keep the existing `POSContainer` as the owner of floor/table selection, session state, order submission, payment handoff and shift controls.

Proposed presentation structure:

- `POSContainer` — existing orchestration; no order lifecycle rewrite.
- `OrderTaking` — screen composition and existing callbacks.
- `PosMenuBrowser` — root/category navigation, search state, keyboard behavior and responsive grid.
- `PosCategoryTile` — category label, folder affordance, count and palette token.
- `PosProductTile` — display label, price, stock state, in-order count and modifier affordance.
- `PosOrderPanel` — extracted presentation for the existing order lines, totals and actions; continue using the existing order-line mutation callbacks.
- `MenuManager` — extend the current manager for layout configuration and data-quality review rather than adding a parallel editor.

The existing modifier dialog, control-void flow, `AppStore`, `posService`, `pmsService`, `posPhase3Service`, print services, BillPayment and KDS remain authoritative for their current workflows.

## Layout settings schema proposal

Current menu records use `property_id`; categories have `id`, `name`, `production_center`, `sort_order` and `active`. Products have POS category, production center, active/sort fields and stock-ledger values. The current code does not establish a canonical `business_id` / `branch_id` model. Do not add or infer those columns until the property/outlet ownership model is confirmed.

A future additive layout table should use the verified property scope and optionally the existing POS outlet/store and terminal identifiers:

| Field | Purpose |
|---|---|
| `id` | UUID primary key |
| `property_id` | Required tenant/property owner |
| `store_id` | Nullable outlet scope, only if the existing store relationship is confirmed |
| `terminal_id` | Nullable terminal override |
| `layout_version` | Version for safe config evolution |
| `settings` | JSONB for density, category order, display labels, palette token names, visibility and product tile options |
| `updated_by`, `updated_at` | Audit attribution and timestamp |

Use a unique scope key for property + outlet + terminal, with a documented precedence of terminal → outlet → property → defaults. RLS and RPCs must authorize every read/write; UI role checks are not a security boundary. Keep stock quantities and financial values out of layout JSON. Do not store raw hex values; persist palette token names only.

## Palette tokens

The canonical source remains `src/index.css` under `:root`. New category tokens should be defined there once:

- `--pos-tile-coastal-teal`
- `--pos-tile-deep-lagoon`
- `--pos-tile-sea-green`
- `--pos-tile-sand-gold`
- `--pos-tile-coral`
- `--pos-tile-reef-blue`
- `--pos-tile-rose-coral`
- `--pos-tile-slate`
- `--pos-tile-neutral`
- `--pos-tile-highlight`

Sand Gold uses its specified dark foreground; other category tiles use white. Product tiles default to neutral with dark text. Components must reference variables, not raw color literals. Validate actual contrast pairs before release. The application remains light-only.

## Data and safety boundaries

- Read/write menu data through `inventoryService` or a dedicated menu-layout service, never directly from presentational components.
- Keep the current product stock ledger authoritative; tile stock is a display snapshot, not a reservation.
- Preserve the existing negative-stock block behavior until the backend policy is explicitly verified.
- Preserve each product's production center so Kitchen/Bar routing remains unchanged.
- Scope queries by the current verified tenant key (`property_id`) and outlet key only where the schema confirms it.
- Do not rename or merge legacy category/product rows automatically. Data-quality actions require explicit confirmation and an audit trail.
- Search must not bypass server-side authorization or use stale stock as proof that settlement can proceed.

## Verification targets

Navigation, root/category search, typo-tolerant normalization, SKU/barcode lookup, stock states, modifiers, long labels, keyboard access, responsive layouts, 300+ item performance, editor permissions, cross-property denial, KDS recovery, print routing, room-charge posting, receipts, cashier reconciliation and Shift Report regression.
