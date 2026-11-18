-- Already APPLIED to Supabase project mszogmazldxjsiytrlxr (OliTechs PMS+POS).
-- Kept here so the repo's version control matches the live database. Do NOT re-run on production.

-- 1. Self-claim only your own, still-ownerless property
create or replace function public.can_self_claim_owner(p_property_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.properties p
                 where p.id = p_property_id and p.created_by = auth.uid())
     and not exists (select 1 from public.property_users pu
                 where pu.property_id = p_property_id and pu.role = 'owner');
$$;
revoke execute on function public.can_self_claim_owner(uuid) from public, anon;
grant execute on function public.can_self_claim_owner(uuid) to authenticated;

drop policy if exists property_users_insert on public.property_users;
create policy property_users_insert on public.property_users for insert
with check (
  public.is_platform_owner()
  or public.property_role(property_id) in ('owner','admin')
  or (user_id = (select auth.uid()) and role = 'owner'
      and public.can_self_claim_owner(property_id))
);

-- 2. Lock internal functions
revoke execute on function public.create_pending_property_for_user(uuid,text,text,text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 3. Explicit guard for status/package
create or replace function public.guard_property_status_package()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_platform_owner()
     and (new.status is distinct from old.status or new.package is distinct from old.package) then
    raise exception 'Only a platform owner can change status or package.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.guard_property_status_package() from public, anon, authenticated;

drop trigger if exists trg_guard_property_status_package on public.properties;
create trigger trg_guard_property_status_package
before update on public.properties for each row execute function public.guard_property_status_package();

drop policy if exists properties_update_owner_admin on public.properties;
create policy properties_update_owner_admin on public.properties for update
using (public.is_platform_owner() or public.property_role(id) in ('owner','admin'))
with check (public.is_platform_owner() or public.property_role(id) in ('owner','admin'));
