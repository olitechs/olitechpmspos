-- Storekeeper Phase 3 — dry-run role split review.
--
-- This migration is deliberately review-only. It records what the role split
-- would mean for existing staff and never updates public.staff. Reassignment
-- remains an explicit administrator action through fn_set_employee_role.

create table if not exists public.stores_role_split_review (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  staff_name text,
  current_role text,
  current_role_id uuid,
  assigned_modules text[] not null default '{}'::text[],
  current_permission_codes text[] not null default '{}'::text[],
  proposed_role text not null,
  required_action text not null,
  reviewed_at timestamptz not null default now(),
  unique (property_id, staff_id)
);

alter table public.stores_role_split_review enable row level security;

drop policy if exists stores_role_split_review_select on public.stores_role_split_review;
create policy stores_role_split_review_select on public.stores_role_split_review
  for select to authenticated
  using (
    public.is_platform_owner()
    or (
      public.is_member_of_property(property_id)
      and public.is_hotel_admin(property_id)
    )
  );

revoke all on table public.stores_role_split_review from anon, authenticated;
grant select on table public.stores_role_split_review to authenticated;

create or replace function public.fn_refresh_stores_role_split_review(p_property_id uuid)
returns setof public.stores_role_split_review
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null
     or not (public.is_platform_owner() or public.is_hotel_admin(p_property_id)) then
    raise exception 'Only property administrators can review role changes.' using errcode = '42501';
  end if;

  insert into public.stores_role_split_review (
    property_id, staff_id, staff_name, current_role, current_role_id,
    assigned_modules, current_permission_codes, proposed_role, required_action, reviewed_at
  )
  select
    s.property_id,
    s.id,
    s.full_name,
    s.role,
    s.role_id,
    coalesce(s.assigned_modules, '{}'::text[]),
    coalesce(public.fn_employee_permission_codes(s.property_id, s.id), '{}'::text[]),
    case lower(coalesce(s.role, ''))
      when 'store_manager' then 'store_manager'
      when 'storekeeper' then 'storekeeper'
      when 'store_keeper' then 'storekeeper'
      else 'storekeeper'
    end,
    case
      when s.role_id is not null then 'No staff-role change required; template permissions are authoritative.'
      when lower(coalesce(s.role, '')) = 'store_manager' then 'No reassignment; Store Manager remains compatible.'
      else 'Confirm canonical Storekeeper role if this employee should remain non-manager.'
    end,
    now()
  from public.staff s
  where s.property_id = p_property_id
    and lower(coalesce(s.role, '')) in ('store_manager', 'storekeeper', 'store_keeper')
  on conflict (property_id, staff_id) do update
    set staff_name = excluded.staff_name,
        current_role = excluded.current_role,
        current_role_id = excluded.current_role_id,
        assigned_modules = excluded.assigned_modules,
        current_permission_codes = excluded.current_permission_codes,
        proposed_role = excluded.proposed_role,
        required_action = excluded.required_action,
        reviewed_at = now();

  return query
    select r.*
    from public.stores_role_split_review r
    where r.property_id = p_property_id
    order by r.staff_name nulls last, r.staff_id;
end;
$function$;

revoke all on function public.fn_refresh_stores_role_split_review(uuid) from public, anon;
grant execute on function public.fn_refresh_stores_role_split_review(uuid) to authenticated;

notify pgrst, 'reload schema';
