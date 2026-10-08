-- Phase 9: RBAC + subscription entitlements
-- Server-side authorization is authoritative; UI visibility is only a convenience.

create or replace function public.fn_staff_module_access(p_property_id uuid,p_module text)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare v_role text; v_assigned text[]; v_module text:=lower(trim(coalesce(p_module,'')));
begin
 if public.is_platform_owner() then return true; end if;
 if not public.is_member_of_property(p_property_id) then return false; end if;
 if not exists(select 1 from public.properties p where p.id=p_property_id and p.status='active' and p.package<>'none') then return false; end if;
 select s.role,s.assigned_modules into v_role,v_assigned from public.staff s where s.property_id=p_property_id and s.user_id=auth.uid() and s.is_active=true limit 1;
 if v_role is null then return v_module in ('backoffice','frontoffice','pos','store') and public.property_role(p_property_id) in ('owner','admin','manager','reception','housekeeping'); end if;
 if v_role in ('super_admin','hotel_admin') then return true; end if;
 if coalesce(array_length(v_assigned,1),0)>0 then return v_module=any(v_assigned); end if;
 return case v_role
  when 'front_office_manager' then v_module='frontoffice'
  when 'receptionist' then v_module in ('frontoffice','pos')
  when 'front_desk' then v_module in ('frontoffice','pos')
  when 'pos_staff' then v_module='pos'
  when 'waiter' then v_module='pos'
  when 'cashier' then v_module='pos'
  when 'store_manager' then v_module='store'
  when 'fb_manager' then v_module in ('pos','store')
  when 'housekeeping_supervisor' then v_module='frontoffice'
  else false end;
end $$;

create or replace function public.fn_subscription_module_allowed(p_property_id uuid,p_module text)
returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((public.fn_subscription_access(p_property_id,p_module)->>'allowed')::boolean,false);
$$;

create or replace function public.can_backoffice(p_property_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select public.fn_subscription_module_allowed(p_property_id,'backoffice') and public.fn_staff_module_access(p_property_id,'backoffice');
$$;

create or replace function public.can_store_write(p_property_id uuid,p_category text default null)
returns boolean language sql stable security definer set search_path=public as $$
 select public.fn_subscription_module_allowed(p_property_id,'store')
 and public.fn_staff_module_access(p_property_id,'store')
 and (public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','store_manager','housekeeping_supervisor')
   or (public.current_staff_role(p_property_id)='fb_manager' and coalesce(p_category,'F&B')='F&B')
   or (public.current_staff_role(p_property_id) is null and public.property_role(p_property_id) in ('owner','admin','manager','storekeeper')));
$$;

create or replace function public.can_manage_pos_menu(p_property_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select public.fn_subscription_module_allowed(p_property_id,'pos')
 and public.fn_staff_module_access(p_property_id,'pos')
 and (public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','cashier','fb_manager','property_manager','general_manager')
   or (public.current_staff_role(p_property_id) is null and public.property_role(p_property_id) in ('owner','admin','manager','cashier')));
$$;

create or replace function public.create_staff_member(p_property_id uuid,p_full_name text,p_email text,p_phone text,p_role text,p_assigned_modules text[],p_pin_hash text,p_avatar text default null,p_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.staff; v_user_id uuid; v_count bigint; v_limit integer; v_modules text[]; v_bad text[];
begin
 if not public.is_hotel_admin(p_property_id) then raise exception 'Only a Hotel Admin can create staff.'; end if;
 if not public.fn_subscription_module_allowed(p_property_id,'backoffice') then raise exception 'Back Office is not enabled for this subscription.'; end if;
 if p_role not in ('super_admin','hotel_admin','front_office_manager','receptionist','front_desk','pos_staff','waiter','cashier','store_manager','fb_manager','housekeeping_supervisor') then raise exception 'Invalid staff role.'; end if;
 if length(p_pin_hash)<32 then raise exception 'Invalid PIN hash.'; end if;
 select case lower(coalesce(ps.plan_code,p.package::text)) when 'starter' then 1 when 'standard' then 1 when 'professional' then 10 when 'premium' then 10 else null end into v_limit from public.properties p left join public.property_subscriptions ps on ps.property_id=p.id where p.id=p_property_id;
 select count(*) into v_count from public.property_users where property_id=p_property_id;
 if v_limit is not null and v_count>=v_limit then raise exception 'Staff limit reached for this subscription.'; end if;
 v_modules:=coalesce(p_assigned_modules,'{}');
 select array_agg(x) into v_bad from unnest(v_modules) x where x not in ('backoffice','frontoffice','pos','store');
 if coalesce(array_length(v_bad,1),0)>0 then raise exception 'Invalid module assignment: %',array_to_string(v_bad,','); end if;
 select id into v_user_id from public.profiles where lower(email)=lower(nullif(trim(p_email),'')) limit 1;
 v_user_id:=coalesce(p_user_id,v_user_id);
 insert into public.staff(full_name,email,phone,role,assigned_modules,pin_hash,is_active,property_id,created_by,avatar,user_id)
 values(trim(p_full_name),nullif(trim(p_email),''),nullif(trim(p_phone),''),p_role,v_modules,p_pin_hash,true,p_property_id,auth.uid(),p_avatar,v_user_id) returning * into s;
 return jsonb_build_object('id',s.id,'full_name',s.full_name,'email',s.email,'phone',s.phone,'role',s.role,'assigned_modules',s.assigned_modules,'is_active',s.is_active,'property_id',s.property_id,'avatar',s.avatar,'last_login',s.last_login);
end $$;

revoke all on function public.fn_staff_module_access(uuid,text) from public,anon,authenticated;
revoke all on function public.fn_subscription_module_allowed(uuid,text) from public,anon,authenticated;
grant execute on function public.fn_staff_module_access(uuid,text) to authenticated;
grant execute on function public.fn_subscription_module_allowed(uuid,text) to authenticated;
