-- Run only against the disposable fixture in pos-menu-rpc-authorization.yml.
-- Reconnect between authorization contexts so the STABLE RPC's cached plan never
-- observes mutated JWT/session claims in one database session.

\set ON_ERROR_STOP on

begin;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated","email":"pos@example.invalid"}', true);
select set_config('test.platform_owner', 'false', true);
select set_config('test.member_property', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('test.property_role', 'owner', true);
select set_config('test.staff_property', '', true);
select set_config('test.staff_role', '', true);
set local role authenticated;
do $owner$
declare v_rows integer;
begin
  select count(*) into v_rows from public.fn_list_pos_menu('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  if v_rows <> 1 then raise exception 'FAIL: owner should read exactly one own-property menu row'; end if;
  raise notice 'PASS: property owner can read own menu';
end
$owner$;
rollback;

\connect

begin;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated","email":"pos@example.invalid"}', true);
select set_config('test.platform_owner', 'false', true);
select set_config('test.member_property', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('test.property_role', 'owner', true);
set local role authenticated;
do $cross_property$
begin
  begin
    perform 1 from public.fn_list_pos_menu('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    raise exception 'FAIL: cross-property menu access was allowed';
  exception when sqlstate '42501' then
    raise notice 'PASS: cross-property menu access is rejected';
  end;
end
$cross_property$;
rollback;

\connect

begin;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated","email":"pos@example.invalid"}', true);
select set_config('test.platform_owner', 'false', true);
select set_config('test.member_property', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('test.property_role', 'housekeeping', true);
select
  current_setting('test.property_role', true) as configured_property_role,
  public.property_role('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') as effective_property_role,
  public.is_platform_owner() as platform_owner,
  public.is_member_of_property('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') as is_member,
  public.current_staff_role('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') as current_staff_role;
set local role authenticated;
do $non_pos_member$
begin
  begin
    perform 1 from public.fn_list_pos_menu('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise exception 'FAIL: non-POS property role was allowed';
  exception when sqlstate '42501' then
    raise notice 'PASS: non-POS property member is rejected';
  end;
end
$non_pos_member$;
rollback;

\connect

begin;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated","email":"pos@example.invalid"}', true);
select set_config('test.platform_owner', 'false', true);
select set_config('test.member_property', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('test.property_role', '', true);
select set_config('test.staff_property', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('test.staff_role', 'housekeeping_supervisor', true);
set local role authenticated;
do $unrelated_staff$
begin
  begin
    perform 1 from public.fn_list_pos_menu('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise exception 'FAIL: unrelated active staff session was allowed';
  exception when sqlstate '42501' then
    raise notice 'PASS: unrelated active staff session is rejected';
  end;
end
$unrelated_staff$;
rollback;

\connect

begin;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated","email":"pos@example.invalid"}', true);
select set_config('test.platform_owner', 'false', true);
select set_config('test.member_property', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('test.property_role', '', true);
select set_config('test.staff_property', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('test.staff_role', 'front_desk', true);
set local role authenticated;
do $allowed_staff$
declare v_rows integer;
begin
  select count(*) into v_rows from public.fn_list_pos_menu('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  if v_rows <> 1 then raise exception 'FAIL: allowed front desk POS staff should read menu'; end if;
  raise notice 'PASS: allowed front desk POS role can read menu';
end
$allowed_staff$;
rollback;

\connect

begin;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated","email":"pos@example.invalid"}', true);
select set_config('test.platform_owner', 'false', true);
select set_config('test.member_property', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('test.property_role', '', true);
select set_config('test.staff_property', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('test.staff_role', 'housekeeping_supervisor', true);
insert into public.staff(property_id, is_active, user_id, email, assigned_modules)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true, auth.uid(), 'pos@example.invalid', array['frontoffice','pos']);
set local role authenticated;
do $module_assignment$
declare v_rows integer;
begin
  select count(*) into v_rows from public.fn_list_pos_menu('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  if v_rows <> 1 then raise exception 'FAIL: explicit POS module assignment should grant menu read'; end if;
  raise notice 'PASS: explicit POS module assignment grants menu read';
end
$module_assignment$;
rollback;

\connect

begin;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '{}', true);
set local role authenticated;
do $missing_identity$
begin
  begin
    perform 1 from public.fn_list_pos_menu('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise exception 'FAIL: missing JWT role/identity was allowed';
  exception when sqlstate '42501' then
    raise notice 'PASS: missing JWT identity is rejected';
  end;
end
$missing_identity$;
rollback;

\connect

begin;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $service$
declare v_rows integer;
begin
  select count(*) into v_rows from public.fn_list_pos_menu('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  if v_rows <> 1 then raise exception 'FAIL: trusted service role should read requested menu'; end if;
  raise notice 'PASS: service role retains trusted access';
end
$service$;
rollback;
