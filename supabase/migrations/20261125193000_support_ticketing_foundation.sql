-- OliTechs support tickets: secure first-phase persistence.
-- Attachments, Realtime and a dedicated support-agent role are intentionally
-- deferred until their authorization and operational requirements are tested.

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  assigned_to uuid references auth.users(id) on delete set null,
  subject text not null check (char_length(btrim(subject)) between 5 and 180),
  category text not null check (category in (
    'account_access', 'front_office', 'pos', 'inventory', 'payments',
    'reports', 'devices_printing', 'bug', 'other'
  )),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'waiting_for_user', 'resolved', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete restrict,
  sender_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  is_internal boolean not null default false,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists support_tickets_property_activity_idx
  on public.support_tickets (property_id, updated_at desc);
create index if not exists support_tickets_status_activity_idx
  on public.support_tickets (status, updated_at desc);
create index if not exists support_ticket_messages_ticket_created_idx
  on public.support_ticket_messages (ticket_id, created_at);
create index if not exists support_ticket_events_ticket_created_idx
  on public.support_ticket_events (ticket_id, created_at);

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
alter table public.support_ticket_events enable row level security;

drop policy if exists support_tickets_read on public.support_tickets;
create policy support_tickets_read on public.support_tickets
  for select to authenticated
  using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists support_tickets_platform_update on public.support_tickets;
create policy support_tickets_platform_update on public.support_tickets
  for update to authenticated
  using (public.is_platform_owner())
  with check (public.is_platform_owner());

drop policy if exists support_ticket_messages_read on public.support_ticket_messages;
create policy support_ticket_messages_read on public.support_ticket_messages
  for select to authenticated
  using (
    (not is_internal and exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id
        and (public.is_platform_owner() or public.is_member_of_property(t.property_id))
    ))
    or (is_internal and public.is_platform_owner())
  );

drop policy if exists support_ticket_messages_reply on public.support_ticket_messages;
create policy support_ticket_messages_reply on public.support_ticket_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and (
      (not is_internal and exists (
        select 1 from public.support_tickets t
        where t.id = ticket_id
          and t.status <> 'closed'
          and public.is_member_of_property(t.property_id)
      ))
      or (public.is_platform_owner())
    )
  );

drop policy if exists support_ticket_events_read on public.support_ticket_events;
create policy support_ticket_events_read on public.support_ticket_events
  for select to authenticated
  using (
    (not is_internal and exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id
        and (public.is_platform_owner() or public.is_member_of_property(t.property_id))
    ))
    or (is_internal and public.is_platform_owner())
  );

revoke all on public.support_tickets from anon, authenticated;
revoke all on public.support_ticket_messages from anon, authenticated;
revoke all on public.support_ticket_events from anon, authenticated;
grant select on public.support_tickets to authenticated;
grant update (assigned_to, priority, status, updated_at) on public.support_tickets to authenticated;
grant select, insert on public.support_ticket_messages to authenticated;
grant select on public.support_ticket_events to authenticated;

create or replace function public.create_support_ticket(
  p_property_id uuid,
  p_subject text,
  p_category text,
  p_priority text,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_ticket_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_property_id is null or not public.is_member_of_property(p_property_id) then
    raise exception 'You are not authorized to open a ticket for this property'
      using errcode = '42501';
  end if;

  if p_subject is null or char_length(btrim(p_subject)) not between 5 and 180 then
    raise exception 'Subject must be between 5 and 180 characters'
      using errcode = '22023';
  end if;

  if p_category not in (
    'account_access', 'front_office', 'pos', 'inventory', 'payments',
    'reports', 'devices_printing', 'bug', 'other'
  ) then
    raise exception 'Invalid support category' using errcode = '22023';
  end if;

  if coalesce(p_priority, 'normal') not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Invalid support priority' using errcode = '22023';
  end if;

  if p_message is null or char_length(btrim(p_message)) not between 1 and 10000 then
    raise exception 'Message must be between 1 and 10000 characters'
      using errcode = '22023';
  end if;

  insert into public.support_tickets (
    property_id, created_by, subject, category, priority
  ) values (
    p_property_id, v_user_id, btrim(p_subject), p_category,
    coalesce(p_priority, 'normal')
  ) returning id into v_ticket_id;

  insert into public.support_ticket_messages (ticket_id, sender_id, body)
  values (v_ticket_id, v_user_id, btrim(p_message));

  return v_ticket_id;
end;
$function$;

revoke all on function public.create_support_ticket(uuid, text, text, text, text) from public, anon;
grant execute on function public.create_support_ticket(uuid, text, text, text, text) to authenticated;

create or replace function public.record_support_ticket_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if tg_table_name = 'support_ticket_messages' then
    update public.support_tickets
       set last_message_at = new.created_at,
           updated_at = new.created_at
     where id = new.ticket_id;

    insert into public.support_ticket_events (
      ticket_id, actor_id, event_type, is_internal, details
    ) values (
      new.ticket_id, new.sender_id, 'message_added', new.is_internal, '{}'::jsonb
    );
    return new;
  end if;

  if tg_op = 'INSERT' then
    insert into public.support_ticket_events (
      ticket_id, actor_id, event_type, details
    ) values (new.id, new.created_by, 'ticket_created', '{}'::jsonb);
    return new;
  end if;

  if old.status is distinct from new.status then
    insert into public.support_ticket_events (
      ticket_id, actor_id, event_type, details
    ) values (
      new.id, auth.uid(), 'status_changed',
      jsonb_build_object('from', old.status, 'to', new.status)
    );
  end if;

  if old.priority is distinct from new.priority then
    insert into public.support_ticket_events (
      ticket_id, actor_id, event_type, details
    ) values (
      new.id, auth.uid(), 'priority_changed',
      jsonb_build_object('from', old.priority, 'to', new.priority)
    );
  end if;

  if old.assigned_to is distinct from new.assigned_to then
    insert into public.support_ticket_events (
      ticket_id, actor_id, event_type, details
    ) values (
      new.id, auth.uid(), 'assignment_changed',
      jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to)
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists support_tickets_record_event on public.support_tickets;
create trigger support_tickets_record_event
  after insert or update on public.support_tickets
  for each row execute function public.record_support_ticket_event();

drop trigger if exists support_ticket_messages_record_event on public.support_ticket_messages;
create trigger support_ticket_messages_record_event
  after insert on public.support_ticket_messages
  for each row execute function public.record_support_ticket_event();

drop trigger if exists support_tickets_set_updated_at on public.support_tickets;
create trigger support_tickets_set_updated_at
  before update on public.support_tickets
  for each row execute function public.set_updated_at();
