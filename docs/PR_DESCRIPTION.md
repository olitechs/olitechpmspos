# Pull Request: OliTechs POS hardening and Coastal Linen theme

## Summary

This feature branch contains the route/link audit fixes, POS-to-stock workflow design and client-side safeguards, plus the OliTechs Coastal Linen theme migration. It does not include an applied database migration or a production deployment.

## Part 1 — Routes and links

- Added dedicated branded `/terms` and `/privacy` destinations for the public footer.
- Normalized the `store_keeper` and `storekeeper` aliases for Stores authorization/navigation.
- Removed the dead X social destination while retaining the remaining reachable social links.
- Added route/role regression coverage and recorded the link, asset and route findings in `docs/audit/BROKEN_LINKS_AND_ROUTES.md`.

## Part 2 — POS-to-stock

- Researched the requested restaurant/POS/inventory products and documented the current settlement-triggered stock path, data model, event/void/refund rules, API contracts, tests, Mermaid flow and migration gates in `docs/stock-deduction-workflow.md`.
- Hardened client retry identity and receipt-line stock tracking metadata; unlinked/unverified receipt lines warn the cashier.
- Added a POS low-stock badge using the current `min_stock` value; zero/negative catalog stock remains blocked in the product grid.
- Added stock-contract coverage for recipes, sent-item voids, refunds, split tender, negative stock and duplicate submissions.
- No database migration was authored or applied. The repository’s provenance/security review still requires exact live SQL/grant/RLS/trigger reconciliation and production-equivalent runtime tests before changing stock ledger or location-balance ownership.

## Part 3 — Theme and POS UI

- Consolidated literal colors into `src/index.css` and mapped Tailwind, shadcn, components, print helpers and templates to semantic CSS variables.
- Enforced light-only Coastal Linen styling, status colors, diagonal-striped out-of-order rooms, accessible room/status labels and token-based warning/error states.
- Updated shared POS presentation for tablet/touch targets; added searchable category products, explicit catalog loading/empty/error/retry states, and low-/out-of-stock badges. A failed property catalog request no longer falls through to saleable demo products. Floor Plan now explains no-zone/no-table states; payment and Shift Reports expose waiting, error, empty and retry feedback while preserving payment, printing and export behavior.
- Preserved existing public asset paths and the `ThemeToggle.jsx` file; SVG/manifest paths are template-backed and generated from CSS tokens. The retained compatibility component displays only “Coastal Linen · Light.”
- Kept receipt paper/ink and the void-slip warning colors visually unchanged through `--print-*` tokens.
- Standardized visible product-name casing to exact `OliTechs` across the HTML title, UI, manifest, README and receipt/print copy. No app-owned email template was found; provider-managed auth email branding remains unverified outside this repository.
- Added strict color/token and contrast checks plus the per-file audit in `docs/audit/COASTAL_LINEN_COLOR_AUDIT.md`.

## Part 4 — Storekeeper Dashboard

- Added `/stores` as the Storekeeper Dashboard landing page with role-gated Stores access, responsive KPI cards, a property-scoped data service, and explicit loading/empty/error/retry states. Dashboard cards and item results deep-link to existing inventory, purchasing, transfer, count, history, valuation, sales-report and item-management routes.
- Added period, department, saved stock-location and global item/SKU/barcode-input filters; operational panels cover posted goods receipts, purchase orders, transfers and recent stock movements. Stock alerts include reorder/on-hand/recorded expiry and activity signals, prioritized with actions to open supported workflows.
- Added sales-versus-recorded-use and department comparison charts, plus current valuation and top-item/wastage lists. Values use existing property-scoped APIs and are not replaced with sample data; estimates are labeled.
- Kept the existing database schema unchanged. The current account context exposes one property, not a business/branch switcher; saved stock locations are product filters and movement rows do not consistently carry branch/location. COGS, historical valuation changes, expected/late deliveries, requisition queues, batch expiry, par levels, dismissal notes, price-jump baselines and several unusual-activity baselines remain unavailable or explicitly qualified because the current schema/APIs do not support them.
- Moved **Manage stores**, **POS Devices** and **Printers** out of Stores navigation into a Back Office-only Store administration group. Former Stores URLs redirect to the Back Office destinations to preserve bookmarks. Dashboard alert rows now include a keyboard-accessible inspection action and a role-aware item detail dialog with recorded stock thresholds, SKU/barcode, category, saved location, supplier and expiry details where available, plus supported follow-up actions.

## Part 5 — Data-native report documents

- Replaced application-screen printing and Room Planner screenshot PDF capture with shared report definitions, a data-native PDF/XLSX engine and accessible Download PDF / Download Excel / Print PDF Preview menu. Preview opens the generated PDF, not the app DOM. Removed `html2canvas` as a direct app dependency; jsPDF still installs it transitively, but no active report code uses it.
- Converted the active Management Sales Summary/Report, Stock Control, monthly POS sales by item/category/shift, payment-type aggregate, Folio statement/receipt, Room Planner calendar and supported Shift Report document paths. Existing POS receipt, kitchen/bar ticket, local Print Agent/ESC/POS and shift thermal printing remain separate.
- Added property/date-scoped paginated receipt/movement adapters; Excel Summary/detail sheets, formulas, formats, safe formula escaping and applicable conditional formatting; conditional Bar/Kitchen sheets; embedded Noto Sans PDFs; append-only export audit metadata and progress/error messaging.
- Added implementation status to `docs/audit/PRINT_EXPORT_AUDIT.md`, `docs/reporting-engine.md`, and synthetic sample PDFs/XLSX (seven core families × two formats) plus rendered new-document PNGs in `docs/report-samples/`. No production data is included.
- Dedicated X/Z/EOD, PO/GRN, requisition/count/wastage/transfer, user-directory, generic arrival/departure and Settings report exports remain unavailable where the screen/query is absent or not sufficient. Live financial reconciliation and authenticated desktop/tablet download/share/print-preview validation remain open.

## Validation

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm run test:architecture` — 179 passed, 0 failed.
- `npm run test:reports` — 11 report-definition, safe-filter and synthetic document tests passed; PDF/XLSX generation covered 1/50/500 rows. Samples opened/converted with LibreOffice and PDFs rendered for visual inspection.
- `npm run build` — passed. Vite still reports a large-main-chunk advisory (>500 kB).
- `npm run check:contrast` — required body/surface/room/deposit pairs passed. The user-mandated white-on-Paid and white-on-Not-paid pairs measure 2.99:1 and 2.52:1; they cannot meet WCAG AA without changing the specified colors, so they are explicitly flagged.
- Local HTTP: `/`, `/manus-routes.json`, `/manifest.json` and `/olitechs-logo.svg` returned 200; all 65 source routes matched the manifest.

## Remaining risks / review notes

- Authenticated POS screens and tablet before/after screenshots could not be captured: no Supabase environment variables or test staff account were provided; the sandbox renders its safe setup gate. See `docs/audit/screenshots/local-preview-setup-gate.png` for the diagnostic, not as a POS screenshot.
- Authenticated dashboard data rendering and staff-specific deep-link interaction likewise require a configured Supabase property and test staff account; source/contract checks and the production build passed, but no live account was available for an interactive session.
- No printer hardware or workstation Print Agent was attached; printing was validated by source/contract tests only.
- `v6/` is an inactive historical duplicate with 59 files containing 735 legacy palette references. It was not modified because repository guidance marks it inactive; verify it is not served before claiming the theme covers that historical tree.
- Refund restock quantity/disposition, post-fire wastage, movement source-key uniqueness, and authoritative location-balance reconciliation remain migration-gated; see the design document.
- The build-size advisory remains out of scope for this theme/link hardening.
