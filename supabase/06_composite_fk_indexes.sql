-- =====================================================================
-- FB Menus — 06_composite_fk_indexes.sql
-- Indexes covering the composite (parent_id, outlet_id) foreign keys
-- (clears Supabase performance advisor lint 0001).
-- =====================================================================
drop index if exists public.menu_schedules_menu_idx;
create index menu_schedules_menu_idx on public.menu_schedules (menu_id, outlet_id);

drop index if exists public.categories_menu_sort_idx;
create index categories_menu_sort_idx on public.categories (menu_id, outlet_id, sort_order);

drop index if exists public.category_items_sort_idx;
drop index if exists public.category_items_item_idx;
create index category_items_sort_idx on public.category_items (category_id, outlet_id, sort_order);
create index category_items_item_idx on public.category_items (item_id, outlet_id);

drop index if exists public.options_group_sort_idx;
create index options_group_sort_idx on public.options (group_id, outlet_id, sort_order);

drop index if exists public.item_option_groups_group_idx;
create index item_option_groups_group_idx on public.item_option_groups (group_id, outlet_id);
create index item_option_groups_item_idx  on public.item_option_groups (item_id, outlet_id);

drop index if exists public.buffet_prices_menu_idx;
create index buffet_prices_menu_idx on public.buffet_prices (menu_id, outlet_id, sort_order);
