-- Phase 10: production-readiness index cleanup
-- The canonical unique index is printer_assignments_printer_id_assignment_type_key.
-- Remove the duplicate index created by earlier printer-assignment hardening.
drop index if exists public.printer_assignments_printer_type_unique;
