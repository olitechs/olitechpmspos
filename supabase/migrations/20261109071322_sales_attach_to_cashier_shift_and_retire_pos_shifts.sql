-- Already APPLIED to Supabase project mszogmazldxjsiytrlxr (OliTechs PMS+POS).
-- Kept here so the repo's version control matches the live database. Do NOT re-run on production.

-- 1. Patch fn_record_pos_sale in place (each anchor verified before replacing)
do $do$
declare
  d text;
  sig regprocedure := 'public.fn_record_pos_sale(uuid,text,text,jsonb,numeric,numeric,numeric,numeric,text,uuid,uuid,text,uuid,text,text,jsonb)'::regprocedure;
  a1 text := $q$select id into v_shift from public.pos_shifts where property_id=p_property_id and status='open' and date=(now() at time zone 'Africa/Nairobi')::date order by opened_at desc limit 1;$q$;
  b1 text := $q$select id into v_shift from public.cashier_shifts where property_id=p_property_id and status='open' order by opened_at desc limit 1;$q$;
  a2 text := $q$not exists(select 1 from public.pos_shifts where id=v_shift and property_id=p_property_id and status='open')$q$;
  b2 text := $q$not exists(select 1 from public.cashier_shifts where id=v_shift and property_id=p_property_id and status='open')$q$;
  a3 text := $q$'Open a POS shift before recording sales.'$q$;
  b3 text := $q$'No open shift. Open a shift from the Shifts menu before recording sales.'$q$;
  a4 text := $q$auth.uid(),null,v_shift,v_key)$q$;
  b4 text := $q$auth.uid(),v_shift,null,v_key)$q$;
begin
  d := pg_get_functiondef(sig);
  if strpos(d, a1) = 0 then raise exception 'anchor 1 missing'; end if;
  if strpos(d, a2) = 0 then raise exception 'anchor 2 missing'; end if;
  if strpos(d, a3) = 0 then raise exception 'anchor 3 missing'; end if;
  if strpos(d, a4) = 0 then raise exception 'anchor 4 missing'; end if;
  d := replace(replace(replace(replace(d, a1, b1), a2, b2), a3, b3), a4, b4);
  execute d;
end
$do$;

-- 2. Retire the legacy pos_shifts system (table kept, empty, until the app no longer references it)
create or replace function public.fn_open_pos_shift(p_property_id uuid, p_opening_cash numeric default 0, p_notes text default null)
returns pos_shifts language plpgsql security definer set search_path to 'public' as $$
begin
  raise exception 'POS shifts are retired. Use Shifts > Open shift instead.';
end $$;

create or replace function public.fn_close_pos_shift(p_shift_id uuid, p_counted_cash numeric, p_notes text default null, p_manager_approved boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  raise exception 'POS shifts are retired. Use Shifts > Close shift instead.';
end $$;

create or replace function public.trg_block_legacy_pos_shift() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  raise exception 'pos_shifts is retired. Use cashier_shifts (Shifts menu).';
end $$;
drop trigger if exists pos_shifts_retired on public.pos_shifts;
create trigger pos_shifts_retired before insert on public.pos_shifts for each row execute function public.trg_block_legacy_pos_shift();

comment on table public.pos_shifts is 'RETIRED: replaced by cashier_shifts. Safe to drop once the app has no references.';
