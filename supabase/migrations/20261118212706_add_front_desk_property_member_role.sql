-- Keep the database property-member role enum aligned with the app's
-- Front Desk staff role. This is additive and preserves existing role values.
alter type public.property_member_role add value if not exists 'front_desk';

notify pgrst, 'reload schema';
