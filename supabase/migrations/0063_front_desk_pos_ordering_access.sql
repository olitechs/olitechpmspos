-- Phase 5 — give existing front desk/reception staff the POS ordering workspace.
update public.staff
set assigned_modules = case
  when assigned_modules is null then array['frontoffice','pos']::text[]
  when not ('pos' = any(assigned_modules)) then array_append(assigned_modules,'pos')
  else assigned_modules
end
where is_active = true
  and role in ('front_desk','receptionist');