-- =====================================================================
-- FB Menus — 14_devices_and_activity_log.sql
-- Devices: push_subscriptions.last_seen_at for "last active" display.
-- Activity log: sign-ins (client-logged), user/device management (server-logged
-- by manage-users using the service role). Read/delete require the "users" right;
-- inserting your own sign_in/device_registered row is allowed to any signed-in user.
-- =====================================================================
alter table public.push_subscriptions add column if not exists last_seen_at timestamptz not null default now();

create table public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  outlet_id   uuid not null references public.outlets (id) on delete cascade,
  user_id     uuid references auth.users (id) on delete set null,
  actor_email text,
  action      text not null check (action in (
                'sign_in', 'user_created', 'user_rights_changed', 'user_removed',
                'password_reset', 'device_registered', 'device_removed')),
  detail      jsonb not null default '{}',
  device      text,
  created_at  timestamptz not null default now()
);
create index activity_log_outlet_idx on public.activity_log (outlet_id, created_at desc);

revoke all on public.activity_log from anon, authenticated;
grant select, insert, delete on public.activity_log to authenticated;
alter table public.activity_log enable row level security;

create policy activity_log_read on public.activity_log for select to authenticated
  using (private.has_perm(outlet_id, 'users'));
create policy activity_log_self_insert on public.activity_log for insert to authenticated
  with check (user_id = (select auth.uid()) and action in ('sign_in', 'device_registered'));
create policy activity_log_delete on public.activity_log for delete to authenticated
  using (private.has_perm(outlet_id, 'users'));

create or replace function public.prune_activity_log(p_outlet uuid, p_days integer default 90)
returns void language sql security invoker set search_path = '' as $$
  delete from public.activity_log where outlet_id = p_outlet and created_at < now() - make_interval(days => p_days);
$$;
revoke execute on function public.prune_activity_log(uuid, integer) from public;
grant execute on function public.prune_activity_log(uuid, integer) to authenticated;
