-- Add a dedicated shift-report printer route.
alter table public.printer_assignments drop constraint if exists printer_assignments_assignment_type_check;
alter table public.printer_assignments add constraint printer_assignments_assignment_type_check check (assignment_type in ('food_orders','drinks_orders','void_food_orders','void_drinks_orders','unsettled_bills','final_receipts','reports','shift_reports'));
-- Prefer existing reports printers as the default shift report destination.
insert into public.printer_assignments(property_id,printer_id,assignment_type)
select a.property_id,a.printer_id,'shift_reports'
from public.printer_assignments a
where a.assignment_type='reports'
on conflict (printer_id,assignment_type) do nothing;
notify pgrst,'reload schema';