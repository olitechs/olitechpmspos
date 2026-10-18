revoke all on function public.fn_bulk_upsert_store_products(uuid,jsonb) from anon, public;
grant execute on function public.fn_bulk_upsert_store_products(uuid,jsonb) to authenticated;

revoke all on function public.fn_sync_product_default_location() from anon, public, authenticated;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='fn_record_pos_sale'
  loop
    execute 'revoke all on function ' || r.signature || ' from anon, public';
    execute 'grant execute on function ' || r.signature || ' to authenticated';
  end loop;
end $$;