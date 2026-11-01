# Printer settings defect and UI refresh

Date: 1 November 2026
Branch: `fix/printer-settings-atomic-save-coastal-ui`

## Defect found

The property printer settings page saved a physical printer with one Supabase request, deleted its routing assignments with a second request, and inserted replacements with a third request. If the assignment delete or insert failed, the printer record could be saved while routing was missing or partially replaced. The UI then proceeded to verification using the old local variable names rather than the record returned by the save operation.

## Fix

- Added `fn_save_property_printer_config`, a property-scoped, SECURITY INVOKER RPC. Printer create/update and assignment replacement occur in one PostgreSQL transaction; an invalid assignment or failed write rolls back the whole operation.
- The RPC validates property-level manager authority, printer ownership on update, connection requirements and the allowed assignment types. Execute is revoked from PUBLIC and anon and granted to authenticated users.
- The page now calls the RPC, deduplicates assignment types, handles save failures, verifies the returned saved printer, and clears the connection timeout after verification.
- Replaced the retired navy/amber and fixed light palette in the property printer settings page with the canonical Coastal Linen semantic tokens, including status, alert, discovery and destructive-action states.

## Validation and deployment gate

- Added source-contract regression tests to `npm run test:architecture`.
- The migration is additive and has not been applied to production.
- The live database connection was unavailable for a complete read-only check during this task. Before deployment, verify the current property printer schema includes the columns referenced by the RPC and exercise owner/admin/manager authorization, cross-property denial, atomic rollback, all connection types, and the printer assignment constraint in an isolated PostgreSQL/Supabase-equivalent fixture.
- Physical printer and local agent tests still require a workstation with the supported hardware.
