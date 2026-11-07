# Plan — Real Print and Export for OliTechs

## Goal and constraints

Replace screen-print and screenshot-based report output with one shared, data-driven PDF/XLSX workflow across the active OliTechs web application. Reuse OliTechs and the approved Coastal Linen design system. Keep all working features intact; do not change POS receipt, kitchen/bar ticket, ESC/POS, Shift Report thermal printing, or Local Print Agent behavior. No destructive database changes, no production data access during validation, and all commits remain on `fix/real-print-export` (never push to `main`).

## Audit-driven decisions

The active screen-print defects are transactional Sales Report (`window.print()`), Guest Folio statement (`window.print()`), and Room Planner (`html2canvas` screenshot PDF plus browser screen print). The payment receipt is a separate guest document and should become a real generated PDF. Existing Shift Report XLSX and Store movement XLSX are data-driven; retain their output semantics, improve formatting/limits and add audit logging rather than replacing them with screenshots. Monthly item/category/shift and standalone payment-type reports did not have dedicated views, but the source schema provides posted POS receipt rows and `items` JSON, plus linked shift records; new report tables can be built from those real sources. Requisition, X/Z, EOD and other missing operational datasets remain unsupported until actual schema/data is available.

## Architecture and serving

- **Shared report definitions:** normalized report definition includes stable report key, title/subtitle, property, period, active safe filters, generated-by/time, summary metrics and one or more named sections with column key/label/type/format/width, rows and optional totals. Use the same definition to render the new Sales Breakdown table and create its PDF/XLSX; existing report views adapt their RPC result into the same contract.
- **PDF:** use existing `jspdf` plus `jspdf-autotable` for vector tables, repeating column headers, row wrapping and page-break management. A branded header/footer is drawn per page with `Page n of N`, report filters and generated metadata. Choose portrait for tables with at most seven columns and landscape for wider tables. Embed Noto Sans loaded lazily from a local project asset for Unicode-safe output. Build only from structured data—no app DOM print and no html2canvas.
- **Excel:** use ExcelJS (lazy-loaded) for genuine `.xlsx` sheets, Coastal Linen/brand styling, frozen header rows, autofilters, sensible widths, number/date/currency formats, subtotal/grand-total formulas, simple operational conditional formatting, print area, fit-to-width/repeated titles and summary/detail sheets. Text that could be interpreted as a formula is escaped; numeric negatives remain numeric. Keep the existing `xlsx` package for current import/compatibility paths until those are separately migrated.
- **Shared export controls:** consistent accessible menu for Download PDF, Download Excel, and Print (opens the generated PDF in a new preview tab, not the app window). Do not offer Email without a real supported send workflow. Show generating/progress/error state. Export report data already fetched with authorized property-scoped queries; the report engine never performs unrestricted queries or reads screen markup.
- **Data adapters:** reuse existing `fn_management_report`/`fn_management_sales_detail` for the management report. New monthly item/category/shift breakdowns select only `created_at,items,total,payment_method,status,shift_id,pos_shift_id` from property-scoped posted receipts, page the results, and map shift IDs to `pos_shifts.shift_no/date`. Item/category aggregation derives only from receipt item JSON, with unknown categories clearly labeled; no guest, room, payment reference, cashier or private notes are selected. Stock report uses the existing role-filtered product/movement datasets. Folio export allowlists ledger columns and includes only the selected reservation. Room Planner exports an operational schedule and Excel date matrix from current planner data, not hidden form state or a DOM screenshot.
- **Audit log:** reuse append-only `audit_logs` via authenticated insert of `actor_id`, `property_id`, action `report_exported`, and a bounded metadata object containing report key, file format, row count and safe filter snapshot (no raw report rows, PII or free-text search). Existing platform Audit Log RPC already includes these events; enhance its UI to show the safe metadata. Fail with a clear message if the audit record cannot be saved so an export is not silently unlogged. No schema migration is needed.
- **Thermal boundary:** document PDF/XLSX remains separate from `printService`, ESC/POS encoders, local print-agent transport, receipt/ticket templates and Shift Report `Re-print`/`Print & Close Shift`. Keep these code paths and expected print payloads unchanged. Add audit events to the existing genuine shift workbook without changing thermal actions.

## Project structure

- `src/services/reportDocumentEngine.js` — client-side PDF/XLSX rendering, safe text, formatting, download/preview and export logging.
- `src/services/reportDefinitions.js` — report model builders and shared column definitions.
- `src/components/shared/DocumentExportMenu.jsx` — accessible shared document controls.
- `src/components/modules/Reports.jsx` — management report adapter and monthly sales item/category/shift/payment tables.
- `src/components/modules/Folio.jsx`, `src/components/pms/RoomPlanner.jsx`, `src/pages/Store.jsx`, `src/pages/ShiftReport.jsx` — active data-backed controls using shared definitions; thermal actions remain untouched.
- `src/services/reportingService.js` and `src/services/inventoryService.js` — property-scoped, bounded data adapters.
- `src/assets/fonts/` or `public/fonts/` — licensed Noto Sans font for lazy PDF embedding.
- `src/**/*.test.*` — report aggregation, filter, permission, audit metadata, formula-safety, document structure and thermal-invariance tests.
- `docs/audit/PRINT_EXPORT_AUDIT.md`, `docs/reporting-engine.md`, `docs/PR_DESCRIPTION.md` — audit, extension guide and pull-request delivery notes.
- `docs/samples/` — synthetic-data PDF/XLSX examples; no live guest, staff or financial transactions.

## Design

Reuse the existing OliTechs Coastal Linen visual language: white/soft-white paper, Deep Lagoon headings, Coastal Teal accents, restrained separators, no purple or large dark blocks. PDF/Excel theme reads the existing CSS tokens in the browser; app UI remains tokenized. Use the current logo asset when available, a compact report hierarchy, readable section labels and generated-by/time/property/period metadata. Avoid decorative images. The report should be calm and professional, with a clear data table before any optional charts.

## Main outcome groups

1. Audit all active print/export points and record the exact behavior, data/query source, filter scope, sensitive fields and thermal separation.
2. Implement one shared structured-data PDF/XLSX engine, branded templates, safe filters, export control and append-only Audit Log events.
3. Add/convert supported report families: Sales Summary, Sales Report, Stock Control, Monthly Sales by Item, Monthly Sales by Category, Monthly Sales by Shift and Sales by Payment Type. Convert every other actual screen-print/screenshot report path found in Phase 1 (Room Planner, Folio and guest payment receipt) and retain/audit existing Shift/Store workbooks.
4. Preserve actual source-data semantics, branch/property and role scopes, no guest or staff PII leakage beyond necessary Folio/room schedule fields, no formula injection, no silent capped exports and no invented unsupported report outputs.
5. Generate synthetic sample documents; validate output structure/layout/totals/privacy and rerun lint/typecheck/build/regression suite. Browser/live data checks are optional only when an authorized test session is available; do not claim them without evidence.

## Dependency and scale constraints

Use `exceljs` and `jspdf-autotable` in lazy chunks alongside existing `jspdf`; avoid a new service/serverless deployment. Keep calculations off the main UI hot path where practical, page the 500-row receipt query, show progress and stop visibly at a documented maximum instead of silently truncating. Use the existing `xlsx` import/export dependency until its import consumers are out of scope. No migration execution or production deployment is part of this task.
