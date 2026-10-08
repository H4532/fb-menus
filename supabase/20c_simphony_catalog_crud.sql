-- =====================================================================
-- FB Menus — 20c_simphony_catalog_crud.sql
-- Allow dish admins to maintain the Simphony catalogue used for mappings.
-- =====================================================================

grant insert, update, delete on public.simphony_catalog_items to authenticated;

drop policy if exists simphony_catalog_admin_insert on public.simphony_catalog_items;
drop policy if exists simphony_catalog_admin_update on public.simphony_catalog_items;
drop policy if exists simphony_catalog_admin_delete on public.simphony_catalog_items;

create policy simphony_catalog_admin_insert on public.simphony_catalog_items
  for insert to authenticated
  with check (private.has_perm(outlet_id, 'dishes'));

create policy simphony_catalog_admin_update on public.simphony_catalog_items
  for update to authenticated
  using (private.has_perm(outlet_id, 'dishes'))
  with check (private.has_perm(outlet_id, 'dishes'));

create policy simphony_catalog_admin_delete on public.simphony_catalog_items
  for delete to authenticated
  using (private.has_perm(outlet_id, 'dishes'));
