-- OliTechs PMS+POS — Property members RPC schema-cache repair
-- 0037: ensure the platform property-members RPC exists in production
-- and force PostgREST to reload its schema after deployment.
--
-- This is intentionally idempotent. It repairs environments where the
-- platform owner/member migration was present in Git but was not reflected
-- in PostgREST's live schema cache.

create or replace function public.platform_list_property_members(p_property_id uuid)
returns table(
  membership_id uuid,
  user_id uuid,
  email text,
  full_name text,
  role public.property_member_role,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    pu.id,
    p.id,
    p.email,
    p.full_name,
    pu.role,
    pu.created_at
  from public.property_users pu
  join public.profiles p on p.id = pu.user_id
  where public.is_platform_owner()
    and pu.property_id = p_property_id
  order by
    case pu.role
      when 'owner' then 0
      when 'admin' then 1
      else 2
    end,
    coalesce(p.full_name, p.email);
$$;

grant execute on function public.platform_list_property_members(uuid)
  to authenticated;

revoke execute on function public.platform_list_property_members(uuid)
  from anon, public;

notify pgrst, 'reload schema';
