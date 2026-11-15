-- Durable queue for reservation confirmation messages.
-- Safe to re-run; row access remains restricted to platform owners and property members.

create table if not exists public.confirmation_messages (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete cascade,
  channel text not null default 'email',
  recipient text,
  subject text,
  body text,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.confirmation_messages enable row level security;

drop policy if exists confirmation_messages_select
  on public.confirmation_messages;

create policy confirmation_messages_select
  on public.confirmation_messages
  for select
  to authenticated
  using (
    public.is_platform_owner()
    or public.is_member_of_property(property_id)
  );

grant select on public.confirmation_messages to authenticated;

create index if not exists confirmation_messages_property_created_idx
  on public.confirmation_messages (property_id, created_at desc);

notify pgrst, 'reload schema';
