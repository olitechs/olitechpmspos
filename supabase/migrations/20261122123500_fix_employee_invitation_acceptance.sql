-- An invitation reserves an employee licence while it is pending.
-- Acceptance consumes that reservation; do not count the same seat twice.
-- Keep employees as low-privilege property members and bind acceptance to the
-- exact email address for which the invitation was issued.

create or replace function public.fn_accept_employee_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_inv public.employee_invitations;
  v_staff public.staff;
begin
  if auth.uid() is null then
    raise exception 'Sign in with the account you created from your invitation email.'
      using errcode = '42501';
  end if;

  if p_token is null or length(btrim(p_token)) < 16 then
    raise exception 'Invalid invitation token.' using errcode = '22023';
  end if;

  select * into v_inv
  from public.employee_invitations
  where status = 'pending'
    and expires_at > now()
    and token_hash = extensions.crypt(btrim(p_token), token_hash)
  limit 1;

  if v_inv.id is null then
    raise exception 'This invitation is no longer valid. Ask your administrator to resend it.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and lower(email) = lower(v_inv.email)
  ) then
    raise exception 'This invitation was issued to a different email address. Sign in with %.',
      v_inv.email using errcode = '42501';
  end if;

  select * into v_staff
  from public.staff
  where property_id = v_inv.property_id and user_id = auth.uid()
  limit 1;

  if v_staff.id is not null then
    insert into public.property_users(property_id, user_id, role)
    values (v_inv.property_id, auth.uid(), 'waiter')
    on conflict (property_id, user_id) do nothing;

    update public.employee_invitations
      set status = 'accepted',
          accepted_at = coalesce(accepted_at, now()),
          auth_user_id = auth.uid(),
          updated_at = now()
    where id = v_inv.id;

    return jsonb_build_object(
      'ok', true,
      'already_member', true,
      'property_id', v_inv.property_id
    );
  end if;

  -- The pending invitation already reserves this employee's licence seat.
  -- Activating the employee and accepting the invitation happen atomically,
  -- so checking availability again here would double-count the same seat.

  select * into v_staff
  from public.staff
  where property_id = v_inv.property_id
    and is_active = false
    and lower(email) = lower(v_inv.email)
  limit 1;

  if v_staff.id is not null then
    update public.staff
      set is_active = true,
          user_id = auth.uid(),
          role_id = coalesce(v_inv.role_id, role_id),
          department_id = coalesce(v_inv.department_id, department_id),
          assigned_modules = coalesce(v_inv.assigned_modules, assigned_modules),
          last_login = now(),
          updated_at = now()
    where id = v_staff.id
    returning * into v_staff;
  else
    insert into public.staff(
      full_name, email, role, assigned_modules, pin_hash, is_active,
      property_id, created_by, user_id, role_id, department_id, last_login
    )
    values (
      v_inv.full_name, v_inv.email, v_inv.staff_role,
      coalesce(v_inv.assigned_modules, '{}'),
      extensions.crypt(
        encode(extensions.gen_random_bytes(18), 'hex'),
        extensions.gen_salt('bf', 12)
      ),
      true, v_inv.property_id, v_inv.invited_by, auth.uid(),
      v_inv.role_id, v_inv.department_id, now()
    )
    returning * into v_staff;
  end if;

  -- Employees are members, never property owners/admins. Workspace-level
  -- authorization continues to come from staff.assigned_modules and permissions.
  insert into public.property_users(property_id, user_id, role)
  values (v_inv.property_id, auth.uid(), 'waiter')
  on conflict (property_id, user_id) do nothing;

  update public.employee_invitations
    set status = 'accepted',
        accepted_at = now(),
        auth_user_id = auth.uid(),
        updated_at = now()
  where id = v_inv.id;

  insert into public.audit_logs(actor_id, action, property_id, new_value)
  values (
    auth.uid(), 'employee_invitation_accepted', v_inv.property_id,
    jsonb_build_object(
      'invitation_id', v_inv.id,
      'staff_id', v_staff.id,
      'user_id', auth.uid()
    )
  );

  return jsonb_build_object(
    'ok', true,
    'already_member', false,
    'property_id', v_inv.property_id,
    'staff_id', v_staff.id
  );
end;
$function$;

revoke all on function public.fn_accept_employee_invitation(text) from public, anon;
grant execute on function public.fn_accept_employee_invitation(text) to authenticated;
