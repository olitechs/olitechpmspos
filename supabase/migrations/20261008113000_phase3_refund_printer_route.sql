-- Dedicated refund printer route
alter table public.printer_assignments drop constraint if exists printer_assignments_assignment_type_check;
alter table public.printer_assignments add constraint printer_assignments_assignment_type_check check (assignment_type in ('food_orders','drinks_orders','void_food_orders','void_drinks_orders','unsettled_bills','final_receipts','reports','shift_reports','refund_slips'));
create unique index if not exists printer_assignments_printer_type_unique on public.printer_assignments(printer_id,assignment_type);
notify pgrst,'reload schema';