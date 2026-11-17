-- Resend-backed employee invitation notifications and reliable delivery outbox.
-- Additive only: preserves existing invitation rows and permission data.

create table if not exists public.employee_email_outbox (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  invitation_id uuid references public.employee_invitations(id) on delete set null,
  event_type text not null check (event_type in ('employee_invitation','employee_welcome','property_admin_invited','property_admin_accepted')),
  recipient_email text not null,
  recipient_name text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  provider_message_id text,
  idempotency_key text not null unique,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists employee_email_outbox_due_idx
  on public.employee_email_outbox(status, next_attempt_at)
  where status in ('pending','failed');
create index if not exists employee_email_outbox_property_idx
  on public.employee_email_outbox(property_id, created_at desc);

alter table public.employee_email_outbox enable row level security;
revoke all on public.employee_email_outbox from public, anon, authenticated;
-- Only the Edge Function's service-role client can read or mutate this queue.

create or replace function public.fn_queue_employee_acceptance_emails()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property_name text;
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    select coalesce(nullif(p.business_name,''), p.name)
      into v_property_name
    from public.properties p where p.id = new.property_id;

    insert into public.employee_email_outbox(
      property_id, invitation_id, event_type, recipient_email, recipient_name,
      payload, idempotency_key
    ) values (
      new.property_id, new.id, 'employee_welcome', new.email, new.full_name,
      jsonb_build_object('property_name', coalesce(v_property_name,'your property')),
      'employee-welcome:' || new.id::text
    ) on conflict (idempotency_key) do nothing;

    insert into public.employee_email_outbox(
      property_id, invitation_id, event_type, recipient_email, recipient_name,
      payload, idempotency_key
    )
    select new.property_id, new.id, 'property_admin_accepted', lower(pr.email),
      coalesce(pr.full_name, pr.email),
      jsonb_build_object(
        'employee_name', new.full_name,
        'employee_email', new.email,
        'property_name', coalesce(v_property_name,'your property'),
        'staff_role', new.staff_role
      ),
      'property-admin-accepted:' || new.id::text || ':' || pu.user_id::text
    from public.property_users pu
    join public.profiles pr on pr.id = pu.user_id
    where pu.property_id = new.property_id
      and pu.role in ('owner','admin','manager')
      and pr.email is not null
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists employee_invitation_acceptance_email_queue on public.employee_invitations;
create trigger employee_invitation_acceptance_email_queue
after update of status on public.employee_invitations
for each row execute function public.fn_queue_employee_acceptance_emails();

-- Repair the employee acceptance transaction: a successful invitation must
-- also create the low-privilege property membership required by authService.
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
    raise exception 'Sign in with the account you created from your invitation email.' using errcode = '42501';
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
    raise exception 'This invitation is no longer valid. Ask your administrator to resend it.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and lower(email) = lower(v_inv.email)
  ) then
    raise exception 'This invitation was issued to a different email address. Sign in with %.', v_inv.email using errcode = '42501';
  end if;

  select * into v_staff from public.staff
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

    return jsonb_build_object('ok', true, 'already_member', true, 'property_id', v_inv.property_id);
  end if;

  perform public.fn_assert_licence_available(v_inv.property_id);

  select * into v_staff from public.staff
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
      extensions.crypt(encode(extensions.gen_random_bytes(18), 'hex'), extensions.gen_salt('bf', 12)),
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
    jsonb_build_object('invitation_id', v_inv.id, 'staff_id', v_staff.id, 'user_id', auth.uid())
  );

  return jsonb_build_object(
    'ok', true,
    'already_member', false,
    'property_id', v_inv.property_id,
    'staff_id', v_staff.id
  );
end;
$function$;

revoke all on function public.fn_queue_employee_acceptance_emails() from public, anon, authenticated;
revoke all on function public.fn_accept_employee_invitation(text) from public, anon;
grant execute on function public.fn_accept_employee_invitation(text) to authenticated;

notify pgrst, 'reload schema';
