-- =====================================================================
-- FB Menus — 09_order_status_history.sql
-- Timeline of status changes per order ({status, at, by}), shown in the admin,
-- in status e-mails and (without "by") on the guest's phone.
-- =====================================================================
alter table public.orders add column if not exists status_history jsonb not null default '[]'::jsonb;

update public.orders
set status_history = jsonb_build_array(jsonb_build_object('status', 'new', 'at', created_at))
    || case when status <> 'new' then jsonb_build_array(jsonb_build_object('status', status, 'at', updated_at)) else '[]'::jsonb end
where status_history = '[]'::jsonb;

create or replace function public.orders_track_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status_history := jsonb_build_array(jsonb_build_object('status', new.status, 'at', now()));
  elsif new.status is distinct from old.status then
    new.status_history := coalesce(old.status_history, '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('status', new.status, 'at', now(), 'by', (select auth.uid())));
  end if;
  return new;
end;
$$;

drop trigger if exists orders_track_status on public.orders;
create trigger orders_track_status before insert or update on public.orders
  for each row execute function public.orders_track_status();

drop function if exists public.guest_order_status(uuid[]);
create function public.guest_order_status(p_ids uuid[])
returns table (id uuid, status text, updated_at timestamptz, status_history jsonb)
language sql stable security definer set search_path = ''
as $$
  select o.id, o.status, o.updated_at,
         (select coalesce(jsonb_agg(h - 'by'), '[]'::jsonb) from jsonb_array_elements(o.status_history) h)
  from public.orders o
  where o.id = any (p_ids[1:20])
    and o.created_at > now() - interval '3 days';
$$;
revoke execute on function public.guest_order_status(uuid[]) from public;
grant execute on function public.guest_order_status(uuid[]) to anon, authenticated;
