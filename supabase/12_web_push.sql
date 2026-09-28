-- =====================================================================
-- FB Menus — 12_web_push.sql
-- Team devices (push_subscriptions) and a trigger that asks the send-push
-- Edge Function to notify them for each new order. VAPID keys live in
-- private.app_settings (vapid_public_key / vapid_private_key / vapid_subject);
-- generate your own pair for a new installation.
-- =====================================================================
create extension if not exists pg_net with schema extensions;

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  outlet_id   uuid not null references public.outlets (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  device      text check (char_length(device) <= 200),
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  constraint push_subscriptions_unique unique (outlet_id, endpoint)
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
alter table public.push_subscriptions enable row level security;
create policy push_own_read on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy push_own_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()) and private.has_perm(outlet_id, 'orders'));
create policy push_own_update on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and private.has_perm(outlet_id, 'orders'));
create policy push_own_delete on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

alter table public.orders add column if not exists pushed_at timestamptz;

create or replace function public.push_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_object_agg(key, value) from private.app_settings
  where key in ('vapid_public_key', 'vapid_private_key', 'vapid_subject', 'admin_url');
$$;
revoke execute on function public.push_config() from public, anon, authenticated;
grant execute on function public.push_config() to service_role;

-- Replace the URL and key with your project's when installing elsewhere.
create or replace function public.orders_push_new()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://swjffroqtxfbsmtjpimw.supabase.co/functions/v1/send-push',
    body := jsonb_build_object('order_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'apikey', 'sb_publishable_9iSpnZU7vc1n2K4kMMjYNg_l55LW1XU'),
    timeout_milliseconds := 5000);
  return null;
exception when others then
  return null;
end;
$$;
revoke execute on function public.orders_push_new() from public, anon, authenticated;
drop trigger if exists orders_push_new on public.orders;
create trigger orders_push_new after update of subtotal on public.orders
  for each row when (old.subtotal is distinct from new.subtotal and new.status = 'new' and new.pushed_at is null)
  execute function public.orders_push_new();
