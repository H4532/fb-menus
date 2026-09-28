-- =====================================================================
-- FB Menus — 10_prep_time_estimates.sql
-- items.prep_minutes            preparation time per dish (admin → Dishes)
-- orders.estimated_minutes      longest prep time in the order; staff can edit
-- orders.ready_by               set on acceptance (and on later edits) = now() + estimate
-- get_public_menu() also returns "prep" per item (see 10b in the live project;
-- the full function is in 07_ordering.sql with the extra line
--   'prep', it.prep_minutes,
-- added to the item object).
-- =====================================================================
alter table public.items  add column if not exists prep_minutes smallint check (prep_minutes between 0 and 240);
alter table public.orders add column if not exists estimated_minutes smallint check (estimated_minutes between 0 and 480);
alter table public.orders add column if not exists ready_by timestamptz;
grant update (estimated_minutes) on public.orders to authenticated;

create or replace function public.orders_ready_by()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status in ('accepted') and new.estimated_minutes is not null
     and (old.status is distinct from new.status or old.estimated_minutes is distinct from new.estimated_minutes) then
    new.ready_by := now() + make_interval(mins => new.estimated_minutes);
  elsif new.status = 'new' then
    new.ready_by := null;
  end if;
  return new;
end;
$$;
drop trigger if exists orders_ready_by on public.orders;
create trigger orders_ready_by before update on public.orders
  for each row execute function public.orders_ready_by();

create or replace function public.orders_set_estimate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.orders o
     set estimated_minutes = (select max(i.prep_minutes) from public.order_items oi
                              join public.items i on i.id = oi.item_id where oi.order_id = o.id)
   where o.id = new.id and o.estimated_minutes is null;
  return null;
end;
$$;
drop trigger if exists orders_set_estimate on public.orders;
create trigger orders_set_estimate after update of subtotal on public.orders
  for each row when (old.subtotal is distinct from new.subtotal and new.status = 'new')
  execute function public.orders_set_estimate();

drop function if exists public.guest_order_status(uuid[]);
create function public.guest_order_status(p_ids uuid[])
returns table (id uuid, status text, updated_at timestamptz, status_history jsonb, estimated_minutes smallint, ready_by timestamptz)
language sql stable security definer set search_path = ''
as $$
  select o.id, o.status, o.updated_at,
         (select coalesce(jsonb_agg(h - 'by'), '[]'::jsonb) from jsonb_array_elements(o.status_history) h),
         o.estimated_minutes, o.ready_by
  from public.orders o
  where o.id = any (p_ids[1:20]) and o.created_at > now() - interval '3 days';
$$;
revoke execute on function public.guest_order_status(uuid[]) from public;
grant execute on function public.guest_order_status(uuid[]) to anon, authenticated;
