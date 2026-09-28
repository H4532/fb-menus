-- =====================================================================
-- FB Menus — 03_rls.sql
-- Row-level security.
--   * Guests (anon): read active menu data only.
--   * Outlet admins (owner/editor): full read, write menu content.
--   * Owners only: edit outlet settings.
--   * outlets / outlet_admins rows are created from the SQL editor
--     (service role bypasses RLS) — no insert policies on purpose.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Table privileges (explicit; RLS then filters rows)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

grant select on
  public.outlets, public.menus, public.menu_schedules, public.categories,
  public.items, public.category_items, public.option_groups, public.options,
  public.item_option_groups, public.buffet_prices
to anon, authenticated;

grant select on public.outlet_admins to authenticated;

grant update on public.outlets to authenticated;

grant insert, update, delete on
  public.menus, public.menu_schedules, public.categories, public.items,
  public.category_items, public.option_groups, public.options,
  public.item_option_groups, public.buffet_prices
to authenticated;

-- ---------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------
alter table public.outlets            enable row level security;
alter table public.outlet_admins      enable row level security;
alter table public.menus              enable row level security;
alter table public.menu_schedules     enable row level security;
alter table public.categories         enable row level security;
alter table public.items              enable row level security;
alter table public.category_items     enable row level security;
alter table public.option_groups      enable row level security;
alter table public.options            enable row level security;
alter table public.item_option_groups enable row level security;
alter table public.buffet_prices      enable row level security;

-- ---------------------------------------------------------------------
-- outlets
-- ---------------------------------------------------------------------
create policy outlets_read on public.outlets
  for select to anon, authenticated
  using (is_active or public.is_outlet_admin(id));

create policy outlets_owner_update on public.outlets
  for update to authenticated
  using (public.is_outlet_owner(id))
  with check (public.is_outlet_owner(id));

-- ---------------------------------------------------------------------
-- outlet_admins: users see their own memberships; owners see their team
-- ---------------------------------------------------------------------
create policy outlet_admins_read on public.outlet_admins
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_outlet_owner(outlet_id));

-- ---------------------------------------------------------------------
-- Public read policies
-- Tables with is_active: hidden rows visible to admins only.
-- ---------------------------------------------------------------------
create policy menus_read on public.menus
  for select to anon, authenticated
  using (is_active or public.is_outlet_admin(outlet_id));

create policy categories_read on public.categories
  for select to anon, authenticated
  using (is_active or public.is_outlet_admin(outlet_id));

create policy items_read on public.items
  for select to anon, authenticated
  using (is_active or public.is_outlet_admin(outlet_id));

create policy buffet_prices_read on public.buffet_prices
  for select to anon, authenticated
  using (is_active or public.is_outlet_admin(outlet_id));

create policy menu_schedules_read on public.menu_schedules
  for select to anon, authenticated using (true);

create policy category_items_read on public.category_items
  for select to anon, authenticated using (true);

create policy option_groups_read on public.option_groups
  for select to anon, authenticated using (true);

create policy options_read on public.options
  for select to anon, authenticated using (true);

create policy item_option_groups_read on public.item_option_groups
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------
-- Admin write policies (same rule on every content table)
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'menus','menu_schedules','categories','items','category_items',
    'option_groups','options','item_option_groups','buffet_prices'
  ] loop
    execute format(
      'create policy %1$s_admin_insert on public.%1$I
         for insert to authenticated
         with check (public.is_outlet_admin(outlet_id))', t);

    execute format(
      'create policy %1$s_admin_update on public.%1$I
         for update to authenticated
         using (public.is_outlet_admin(outlet_id))
         with check (public.is_outlet_admin(outlet_id))', t);

    execute format(
      'create policy %1$s_admin_delete on public.%1$I
         for delete to authenticated
         using (public.is_outlet_admin(outlet_id))', t);
  end loop;
end;
$$;
