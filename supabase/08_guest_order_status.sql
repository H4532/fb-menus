-- =====================================================================
-- FB Menus — 08_guest_order_status.sql
-- Guests can look up the status of orders they placed. They must present
-- the order's random id (only the ordering phone has it); max 20 ids, last 3 days.
-- =====================================================================
create or replace function public.guest_order_status(p_ids uuid[])
returns table (id uuid, status text, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.status, o.updated_at
  from public.orders o
  where o.id = any (p_ids[1:20])
    and o.created_at > now() - interval '3 days';
$$;
revoke execute on function public.guest_order_status(uuid[]) from public;
grant execute on function public.guest_order_status(uuid[]) to anon, authenticated;
