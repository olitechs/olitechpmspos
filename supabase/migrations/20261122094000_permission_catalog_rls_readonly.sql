-- Restrict the static permission catalogue to read-only signed-in access.
-- It contains global permission labels only; application authorization is
-- enforced by the tenant-scoped permission RPCs and property_role_permissions.
begin;

alter table public.permission_catalog enable row level security;

drop policy if exists permission_catalog_authenticated_read on public.permission_catalog;
create policy permission_catalog_authenticated_read
  on public.permission_catalog
  for select
  to authenticated
  using (true);

revoke all on table public.permission_catalog from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.permission_catalog from authenticated;
grant select on table public.permission_catalog to authenticated;

commit;
