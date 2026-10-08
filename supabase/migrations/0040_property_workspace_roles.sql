-- Phase 1: property workspace module assignments.
-- Existing staff keep their role but receive the correct workspace instead of
-- the previous broad backoffice/store defaults.

update public.staff
set assigned_modules = case role
  when 'super_admin' then array['backoffice','frontoffice','pos','store']::text[]
  when 'hotel_admin' then array['backoffice','frontoffice','pos','store']::text[]
  when 'front_office_manager' then array['frontoffice']::text[]
  when 'receptionist' then array['frontoffice']::text[]
  when 'front_desk' then array['frontoffice']::text[]
  when 'pos_staff' then array['pos']::text[]
  when 'waiter' then array['pos']::text[]
  when 'cashier' then array['pos']::text[]
  when 'store_manager' then array['store']::text[]
  when 'fb_manager' then array['pos','store']::text[]
  when 'housekeeping_supervisor' then array['frontoffice']::text[]
  else assigned_modules
end
where role in (
  'super_admin','hotel_admin','front_office_manager','receptionist','front_desk',
  'pos_staff','waiter','cashier','store_manager','fb_manager','housekeeping_supervisor'
);
