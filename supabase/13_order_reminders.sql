-- =====================================================================
-- FB Menus — 13_order_reminders.sql
-- Server-side reminders while an order stays "new": pg_cron calls the
-- send-push function every 30 s; claim_order_reminders() decides which orders
-- are due (per-outlet interval and maximum). Stops as soon as status changes.
-- Replace the project URL/key in the cron job when installing elsewhere.
-- =====================================================================
create extension if not exists pg_cron;

alter table public.outlet_order_settings
  add column if not exists remind_seconds integer not null default 30 check (remind_seconds in (0, 30, 60, 120, 300)),
  add column if not exists remind_max integer not null default 10 check (remind_max between 1 and 30);

alter table public.orders
  add column if not exists remind_count integer not null default 0,
  add column if not exists last_reminded_at timestamptz;

create or replace function public.claim_order_reminders()
returns table (order_id uuid, outlet_id uuid, remind_count integer, waiting_seconds integer)
language sql volatile security definer set search_path = '' as $$
  update public.orders o
     set remind_count = o.remind_count + 1, last_reminded_at = now()
    from public.outlet_order_settings s
   where s.outlet_id = o.outlet_id
     and s.remind_seconds > 0
     and o.status = 'new'
     and o.created_at > now() - interval '2 hours'
     and o.remind_count < s.remind_max
     and coalesce(o.last_reminded_at, o.created_at) <= now() - make_interval(secs => s.remind_seconds) + interval '3 seconds'
  returning o.id, o.outlet_id, o.remind_count, extract(epoch from now() - o.created_at)::integer;
$$;
revoke execute on function public.claim_order_reminders() from public, anon, authenticated;
grant execute on function public.claim_order_reminders() to service_role;

select cron.unschedule('fbm-order-reminders') where exists (select 1 from cron.job where jobname = 'fbm-order-reminders');
select cron.schedule('fbm-order-reminders', '30 seconds', $cron$
  select net.http_post(
    url := 'https://swjffroqtxfbsmtjpimw.supabase.co/functions/v1/send-push',
    body := '{"action":"remind"}'::jsonb,
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_9iSpnZU7vc1n2K4kMMjYNg_l55LW1XU"}'::jsonb,
    timeout_milliseconds := 8000);
$cron$);
