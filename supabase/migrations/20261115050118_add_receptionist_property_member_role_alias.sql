-- Accept the staff-facing "receptionist" role in property memberships.
-- The legacy property-level role "reception" remains supported.
alter type public.property_member_role add value if not exists 'receptionist';
