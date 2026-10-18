-- Phase 5 hardening: enforce property/printer ownership at the database boundary.
create unique index if not exists property_printers_property_id_id_unique
  on public.property_printers(property_id,id);

alter table public.printer_assignments
  drop constraint if exists printer_assignments_property_printer_fk;
alter table public.printer_assignments
  add constraint printer_assignments_property_printer_fk
  foreign key (property_id, printer_id)
  references public.property_printers(property_id,id)
  on delete cascade;

alter table public.fnb_print_jobs
  drop constraint if exists fnb_print_jobs_property_printer_fk;
alter table public.fnb_print_jobs
  add constraint fnb_print_jobs_property_printer_fk
  foreign key (property_id, printer_id)
  references public.property_printers(property_id,id)
  on delete set null;

notify pgrst,'reload schema';
