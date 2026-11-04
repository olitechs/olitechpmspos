begin;

alter table public.property_printers
  add column if not exists character_width integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'property_printers_character_width_check'
      and conrelid = 'public.property_printers'::regclass
  ) then
    alter table public.property_printers
      add constraint property_printers_character_width_check
      check (character_width is null or character_width between 24 and 64);
  end if;
end
$$;

comment on column public.property_printers.character_width is
  'Optional thermal print character width override. NULL uses paper_width default (80mm=48, 58mm=32).';

notify pgrst, 'reload schema';

commit;
