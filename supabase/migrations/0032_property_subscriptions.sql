-- Property subscriptions and subscription events
-- Defensive PostgreSQL-compatible migration.

create table if not exists public.property_subscriptions (
  property_id uuid primary key references public.properties(id) on delete cascade,
  plan_code text not null default 'starter',
  status text not null default 'trial'
    check (status in ('trial','active','past_due','suspended','cancelled')),
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  grace_ends_at timestamptz,
  enabled_modules text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.property_subscriptions enable row level security;

drop policy if exists property_subscriptions_select on public.property_subscriptions;
create policy property_subscriptions_select
on public.property_subscriptions for select
using (public.is_platform_owner() or public.is_member_of_property(property_id));

create or replace function public.fn_get_subscription(p_property_id uuid)
returns public.property_subscriptions
language plpgsql security definer set search_path=public
as $$
declare v public.property_subscriptions;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not authorized';
  end if;
  select * into v from public.property_subscriptions where property_id=p_property_id;
  return v;
end;
$$;

create or replace function public.fn_upsert_subscription(
  p_property_id uuid,p_plan_code text,p_status text,
  p_trial_ends_at timestamptz,p_current_period_ends_at timestamptz,
  p_grace_ends_at timestamptz,p_enabled_modules text[]
)
returns public.property_subscriptions
language plpgsql security definer set search_path=public
as $$
declare v public.property_subscriptions;
begin
  if not (
    public.is_platform_owner()
    or exists (
      select 1 from public.property_users pu
      where pu.property_id=p_property_id
        and pu.user_id=auth.uid()
        and pu.role in ('owner','admin')
    )
  ) then
    raise exception 'Not authorized to manage subscription';
  end if;

  if p_status not in ('trial','active','past_due','suspended','cancelled') then
    raise exception 'Invalid subscription status';
  end if;

  insert into public.property_subscriptions(
    property_id,plan_code,status,trial_ends_at,current_period_ends_at,
    grace_ends_at,enabled_modules,updated_by
  )
  values(
    p_property_id,coalesce(nullif(p_plan_code,''),'starter'),p_status,
    p_trial_ends_at,p_current_period_ends_at,p_grace_ends_at,
    coalesce(p_enabled_modules,'{}'),auth.uid()
  )
  on conflict(property_id) do update set
    plan_code=excluded.plan_code,
    status=excluded.status,
    trial_ends_at=excluded.trial_ends_at,
    current_period_ends_at=excluded.current_period_ends_at,
    grace_ends_at=excluded.grace_ends_at,
    enabled_modules=excluded.enabled_modules,
    updated_at=now(),
    updated_by=auth.uid()
  returning * into v;

  return v;
end;
$$;

create or replace function public.fn_subscription_access(
  p_property_id uuid,p_module text
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  s public.property_subscriptions;
  allowed boolean:=false;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not authorized';
  end if;

  if public.is_platform_owner() then
    return jsonb_build_object('allowed',true,'reason','platform_owner');
  end if;

  select * into s
  from public.property_subscriptions
  where property_id=p_property_id;

  if s.property_id is null then
    return jsonb_build_object('allowed',false,'reason','subscription_not_configured');
  end if;

  allowed :=
    s.status in ('trial','active','past_due')
    and (s.current_period_ends_at is null or s.current_period_ends_at >= now())
    and (s.trial_ends_at is null or s.trial_ends_at >= now());

  if s.grace_ends_at is not null
     and s.grace_ends_at >= now()
     and s.status in ('past_due','suspended') then
    allowed:=true;
  end if;

  if cardinality(s.enabled_modules)>0
     and not (p_module=any(s.enabled_modules)) then
    allowed:=false;
  end if;

  return jsonb_build_object(
    'allowed',allowed,
    'status',s.status,
    'plan_code',s.plan_code,
    'reason',case when allowed then 'active' else 'subscription_required' end,
    'period_ends_at',s.current_period_ends_at,
    'trial_ends_at',s.trial_ends_at
  );
end;
$$;

grant execute on function public.fn_get_subscription(uuid) to authenticated;
grant execute on function public.fn_upsert_subscription(uuid,text,text,timestamptz,timestamptz,timestamptz,text[]) to authenticated;
grant execute on function public.fn_subscription_access(uuid,text) to authenticated;

create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  event_type text not null,
  provider text,
  external_event_id text,
  status text not null default 'received'
    check (status in ('received','processed','ignored','failed')),
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(provider,external_event_id)
);

alter table public.subscription_events enable row level security;

drop policy if exists subscription_events_select on public.subscription_events;
create policy subscription_events_select
on public.subscription_events for select
using (public.is_platform_owner() or public.is_member_of_property(property_id));

create or replace function public.fn_record_subscription_event(
  p_property_id uuid,p_event_type text,p_provider text,
  p_external_event_id text,p_payload jsonb
)
returns public.subscription_events
language plpgsql security definer set search_path=public
as $$
declare v public.subscription_events;
begin
  if not public.is_platform_owner() then
    raise exception 'Subscription events are provider/system managed';
  end if;

  insert into public.subscription_events(
    property_id,event_type,provider,external_event_id,payload
  )
  values(
    p_property_id,p_event_type,p_provider,p_external_event_id,
    coalesce(p_payload,'{}'::jsonb)
  )
  on conflict(provider,external_event_id)
  do update set payload=excluded.payload
  returning * into v;

  return v;
end;
$$;

grant execute on function public.fn_record_subscription_event(uuid,text,text,text,jsonb)
  to authenticated;

notify pgrst,'reload schema';
