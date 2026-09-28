-- =====================================================================
-- FB Menus — 11_user_rights.sql
-- Per-user rights on each outlet: orders, dishes, menus, settings, users.
-- Roles are presets (owner = everything). Enforced by RLS via private.has_perm().
-- Accounts are created/removed by the manage-users Edge Function.
-- =====================================================================
alter table public.outlet_admins drop constraint if exists outlet_admins_role_check;
alter table public.outlet_admins add constraint outlet_admins_role_check
  check (role in ('owner', 'manager', 'editor', 'staff', 'custom'));
alter table public.outlet_admins add column if not exists permissions text[] not null default '{}'
  check (permissions <@ array['orders', 'dishes', 'menus', 'settings', 'users']::text[]);
alter table public.outlet_admins add column if not exists display_name text check (char_length(display_name) <= 60);
update public.outlet_admins set permissions = array['orders','dishes','menus','settings','users'] where role = 'owner';
update public.outlet_admins set permissions = array['orders','dishes','menus'] where role = 'editor' and permissions = '{}';

create or replace function private.has_perm(p_outlet uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.outlet_admins a
    where a.outlet_id = p_outlet and a.user_id = (select auth.uid())
      and (a.role = 'owner' or p_perm = any (a.permissions)));
$$;
revoke execute on function private.has_perm(uuid, text) from public;
grant execute on function private.has_perm(uuid, text) to anon, authenticated;

do $$
declare t text; p text;
begin
  for t, p in select * from (values
      ('items','dishes'), ('category_items','dishes'), ('item_option_groups','dishes'),
      ('menus','menus'), ('menu_schedules','menus'), ('categories','menus'),
      ('option_groups','menus'), ('options','menus'), ('buffet_prices','menus')) as v(t, p)
  loop
    execute format('drop policy if exists %1$s_admin_insert on public.%1$I', t);
    execute format('drop policy if exists %1$s_admin_update on public.%1$I', t);
    execute format('drop policy if exists %1$s_admin_delete on public.%1$I', t);
    execute format('create policy %1$s_admin_insert on public.%1$I for insert to authenticated with check (private.has_perm(outlet_id, %2$L))', t, p);
    execute format('create policy %1$s_admin_update on public.%1$I for update to authenticated using (private.has_perm(outlet_id, %2$L)) with check (private.has_perm(outlet_id, %2$L))', t, p);
    execute format('create policy %1$s_admin_delete on public.%1$I for delete to authenticated using (private.has_perm(outlet_id, %2$L))', t, p);
  end loop;
end $$;

drop policy if exists outlets_owner_update on public.outlets;
create policy outlets_settings_update on public.outlets for update to authenticated
  using (private.has_perm(id, 'settings')) with check (private.has_perm(id, 'settings'));

drop policy if exists order_settings_owner_read on public.outlet_order_settings;
drop policy if exists order_settings_owner_insert on public.outlet_order_settings;
drop policy if exists order_settings_owner_update on public.outlet_order_settings;
create policy order_settings_read on public.outlet_order_settings for select to authenticated using (private.has_perm(outlet_id, 'settings'));
create policy order_settings_insert on public.outlet_order_settings for insert to authenticated with check (private.has_perm(outlet_id, 'settings'));
create policy order_settings_update on public.outlet_order_settings for update to authenticated
  using (private.has_perm(outlet_id, 'settings')) with check (private.has_perm(outlet_id, 'settings'));

drop policy if exists orders_admin_read on public.orders;
drop policy if exists orders_admin_update on public.orders;
drop policy if exists order_items_admin_read on public.order_items;
create policy orders_read on public.orders for select to authenticated using (private.has_perm(outlet_id, 'orders'));
create policy orders_update on public.orders for update to authenticated
  using (private.has_perm(outlet_id, 'orders')) with check (private.has_perm(outlet_id, 'orders'));
create policy order_items_read on public.order_items for select to authenticated using (private.has_perm(outlet_id, 'orders'));

drop policy if exists outlet_admins_read on public.outlet_admins;
create policy outlet_admins_read on public.outlet_admins for select to authenticated
  using (user_id = (select auth.uid()) or private.has_perm(outlet_id, 'users'));

drop policy if exists menu_photos_admin_insert on storage.objects;
drop policy if exists menu_photos_admin_update on storage.objects;
drop policy if exists menu_photos_admin_delete on storage.objects;
create policy menu_photos_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-photos' and private.has_perm(private.storage_outlet_id(name), 'dishes'));
create policy menu_photos_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'menu-photos' and private.has_perm(private.storage_outlet_id(name), 'dishes'))
  with check (bucket_id = 'menu-photos' and private.has_perm(private.storage_outlet_id(name), 'dishes'));
create policy menu_photos_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'menu-photos' and private.has_perm(private.storage_outlet_id(name), 'dishes'));

-- Trigger-only functions: not callable through the API.
revoke execute on function public.orders_set_estimate() from public, anon, authenticated;
revoke execute on function public.orders_ready_by() from public, anon, authenticated;
revoke execute on function public.orders_track_status() from public, anon, authenticated;
