-- =====================================================================
-- FB Menus — 05_private_helpers.sql
-- Moves the RLS helper functions out of the API-exposed "public" schema
-- (clears Supabase security advisor lints 0028/0029). Policies reference
-- functions by OID, so they keep working after the move.
-- =====================================================================
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

alter function public.is_outlet_admin(uuid)   set schema private;
alter function public.is_outlet_owner(uuid)   set schema private;
alter function public.storage_outlet_id(text) set schema private;

revoke execute on function private.is_outlet_admin(uuid)   from public;
revoke execute on function private.is_outlet_owner(uuid)   from public;
revoke execute on function private.storage_outlet_id(text) from public;
grant  execute on function private.is_outlet_admin(uuid)   to anon, authenticated;
grant  execute on function private.is_outlet_owner(uuid)   to anon, authenticated;
grant  execute on function private.storage_outlet_id(text) to anon, authenticated;
