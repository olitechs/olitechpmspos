# OliTechs Report and Document Engine

## What it does

`src/services/reportDefinitions.js` turns property-scoped data into a normalized report definition. That definition is rendered by `src/services/reportDocumentEngine.js` into a real PDF or XLSX document; it is also the row source for `src/components/shared/ReportDataTable.jsx`. `src/components/shared/DocumentExportMenu.jsx` exposes Download PDF, Download Excel and Print PDF Preview. Print preview opens the generated PDF, never the current application screen.

The export menu writes a bounded event to the existing append-only `audit_logs` table through `src/services/reportExportAuditService.js`. Safe filter normalization is isolated in `reportExportAuditCore.js`. Export errors surface to the user; the menu does not silently download a document when audit logging fails.

The browser PDF renderer reads the OliTechs brand CSS variables in `src/index.css`; Node sample generation resolves those same token names through `scripts/reportTheme.mjs`. Neither path has an independent hard-coded palette. PDF creation uses jsPDF and AutoTable, with the project Noto Sans asset embedded for Unicode. ExcelJS produces actual `.xlsx` workbooks with a Summary sheet, detail sheets, safe text escaping, number formats, totals formulas, conditional formatting where the fields apply, frozen/filter headers and print setup.

## Add a new data-backed report

1. Add or reuse an authorized service method that returns only the fields needed for the report. Scope it to the authenticated property and selected period; page large reads, expose progress and fail rather than silently truncate.
2. Add a `build...Definition({ sourceRows, filters, propertyName, generatedBy })` builder in `src/services/reportDefinitions.js`. Return a `createReportDefinition` with explicit columns (`key`, `label`, `type`, `format`, `width`, optional `total: 'sum'`), source rows, active filters and explanatory notes for any non-allocated metric.
3. Add a `ReportDataTable` view using that same definition and pass a definition builder to `DocumentExportMenu`. Do not rebuild a separate export-only query or use DOM capture.
4. Apply existing role checks to the report and the export control. Keep sensitive columns on explicit allowlists and include every export event in Audit Log.
5. Add pure definition tests and a synthetic generator test for totals, formula escaping, Unicode and pagination; run `npm run test:reports`, `npm run lint`, `npm run typecheck` and `npm run build`.

The sample generator is `scripts/generate-report-samples.mjs`; `npm run samples:reports` rewrites only `docs/report-samples/` with clearly synthetic fixtures.

## Current source coverage and limits

- Management Sales Summary/Report use `fn_management_report` and `fn_management_sales_detail` with the active property/date range. POS item/category/shift definitions use posted `pos_receipts` item JSON and linked shift rows. Department sheets are emitted only if Bar/Kitchen appears in the source. Receipt taxes/discounts are not allocated across departments or items; the reports explicitly state that limitation.
- The standalone Payment Type report is an aggregate of the management RPC, not settlement reconciliation, and contains no payment or customer references.
- Stock Control exports the actual current product list and paginated property-scoped stock movements, with the selected date/category/location and role-based cost visibility. The current products/movement schema does not establish batch-level expiry history or all requested purchasing/requisition/count/wastage report datasets.
- Folio and Room Planner builders export explicit selected-ledger/calendar fields; guest data remains restricted to the operational document scope. Room Planner calendar dates are kept as local date keys.
- Close Shift and Shift Report pages use generated document exports while their receipt/ticket/thermal print pathways remain distinct. POS ESC/POS and kitchen/bar tickets are not routed through PDF export.

No database schema or RLS policy changes are included. The platform Audit Log write path reuses the existing table and insert policy. Verify this policy in the deployment before relying on it in an environment with different migrations.

## Remaining risks and recommended next steps

- The report export conversion does not create missing dedicated screens/data definitions for X/Z reports, inventory counts, wastage, requisitions, PO/GRN/transfer reports, arrivals/departures, generic invoices or user-directory reports. Do not label these as supported exports until a real query, role policy and definition exist.
- Reconciliation is bounded by metric semantics: receipt totals, receipt-item revenue, management aggregates, tax, discount and refunds are not interchangeable. Source explanations are included where not allocated; property-specific automated reconciliation against an authenticated live database is still required before treating the new reporting calculations as a financial ledger.
- Automated synthetic tests verify PDF page count, page orientation, embedded text/Unicode, footer/header fields, no application controls in the PDF, formula cells, date/currency formats, privacy-safe filters and 1/50/500-row generation. ExcelJS does not calculate formula results; LibreOffice can open/convert the generated samples for office-compatibility checks.
- No authenticated desktop/tablet browser session was available for an end-to-end download/share-sheet or live print-preview test. The before screenshot of the prior screen-print is therefore not fabricated. A rendered screenshot of the new generated document is supplied as static visual evidence; capture a true before/after from the authorized test property before closing the UX acceptance item.
