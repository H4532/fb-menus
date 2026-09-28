-- =====================================================================
-- FB Menus — 02_functions.sql
-- Helper functions, triggers, public menu RPC, admin reorder RPCs.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Access helpers (SECURITY DEFINER so RLS policies can call them
-- without recursing into outlet_admins' own policies)
-- ---------------------------------------------------------------------
create or replace function public.is_outlet_admin(p_outlet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.outlet_admins a
    where a.outlet_id = p_outlet_id
      and a.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_outlet_owner(p_outlet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.outlet_admins a
    where a.outlet_id = p_outlet_id
      and a.user_id = (select auth.uid())
      and a.role = 'owner'
  );
$$;

-- Extracts the outlet id from a storage object key "<outlet_id>/…".
-- Returns null (instead of raising) when the first segment is not a uuid.
create or replace function public.storage_outlet_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1)
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

-- ---------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Outlets: touch updated_at and bump data_version on any settings change.
create or replace function public.outlets_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.data_version = old.data_version then
    new.data_version := old.data_version + 1;
  end if;
  return new;
end;
$$;

create trigger outlets_before_update
  before update on public.outlets
  for each row execute function public.outlets_before_update();

-- ---------------------------------------------------------------------
-- data_version bump on any content change (definer: editors may not
-- have UPDATE rights on outlets)
-- ---------------------------------------------------------------------
create or replace function public.bump_outlet_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outlet uuid;
begin
  if tg_op = 'DELETE' then
    v_outlet := old.outlet_id;
  else
    v_outlet := new.outlet_id;
  end if;

  update public.outlets
     set data_version = data_version + 1
   where id = v_outlet;

  return null;
end;
$$;

do $$
declare
  t text;
begin
  -- updated_at triggers
  foreach t in array array[
    'menus','menu_schedules','categories','items',
    'option_groups','options','buffet_prices'
  ] loop
    execute format(
      'create trigger %1$s_set_updated_at before update on public.%1$I
         for each row execute function public.set_updated_at()', t);
  end loop;

  -- data_version triggers
  foreach t in array array[
    'menus','menu_schedules','categories','items','category_items',
    'option_groups','options','item_option_groups','buffet_prices'
  ] loop
    execute format(
      'create trigger %1$s_bump_version after insert or update or delete on public.%1$I
         for each row execute function public.bump_outlet_version()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Public menu: the whole outlet menu in ONE request.
--
-- Shape:
-- {
--   "outlet": {...settings, data_version},
--   "menus": [{ id, slug, name, description, type, schedules[], buffet_prices[],
--               categories: [{ id, name, description, items: [item_id…] }] }],
--   "items": { "<item_id>": { …, option_groups: [group_id…] } },
--   "option_groups": { "<group_id>": { name, selection, min, max, pricing, options[] } }
-- }
-- Returns null when the slug is unknown or the outlet is inactive.
-- Hidden (is_active = false) rows are excluded; sold-out items are included
-- with "available": false so the client can grey them out or hide them.
-- ---------------------------------------------------------------------
create or replace function public.get_public_menu(p_slug text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with
  o as (
    select * from public.outlets
    where slug = p_slug and is_active
  ),
  m as (
    select mn.* from public.menus mn
    join o on mn.outlet_id = o.id
    where mn.is_active
  ),
  c as (
    select ct.* from public.categories ct
    join m on ct.menu_id = m.id
    where ct.is_active
  ),
  ci as (
    select x.category_id, x.item_id, x.sort_order
    from public.category_items x
    join c on c.id = x.category_id
    join public.items i on i.id = x.item_id and i.is_active
  ),
  it as (
    select i.* from public.items i
    where i.id in (select item_id from ci)
  ),
  iog as (
    select g.item_id, g.group_id, g.sort_order
    from public.item_option_groups g
    where g.item_id in (select id from it)
  ),
  grp as (
    select og.* from public.option_groups og
    where og.id in (select group_id from iog)
  )
  select case when not exists (select 1 from o) then null else
  jsonb_build_object(
    'outlet', (
      select jsonb_build_object(
        'id', o.id,
        'slug', o.slug,
        'name', o.name,
        'tagline', o.tagline,
        'timezone', o.timezone,
        'languages', to_jsonb(o.languages),
        'default_language', o.default_language,
        'currency', o.currency,
        'vat_rate', o.vat_rate,
        'prices_include_vat', o.prices_include_vat,
        'service_charge_pct', o.service_charge_pct,
        'price_note', o.price_note,
        'calorie_note', o.calorie_note,
        'opening_hours', o.opening_hours,
        'contact', o.contact,
        'unavailable_display', o.unavailable_display,
        'data_version', o.data_version
      ) from o
    ),

    'menus', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'slug', m.slug,
        'name', m.name,
        'description', m.description,
        'type', m.menu_type,
        'schedules', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'days', to_jsonb(s.days),
                   'start', left(s.start_time::text, 5),
                   'end',   left(s.end_time::text, 5))
                 order by s.start_time)
          from public.menu_schedules s
          where s.menu_id = m.id
        ), '[]'::jsonb),
        'buffet_prices', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', b.id,
                   'label', b.label,
                   'price', b.price,
                   'days', to_jsonb(b.days),
                   'start', left(b.start_time::text, 5),
                   'end',   left(b.end_time::text, 5),
                   'note', b.note)
                 order by b.sort_order, b.created_at)
          from public.buffet_prices b
          where b.menu_id = m.id and b.is_active
        ), '[]'::jsonb),
        'categories', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', c.id,
                   'name', c.name,
                   'description', c.description,
                   'items', coalesce((
                     select jsonb_agg(ci.item_id order by ci.sort_order, ci.item_id)
                     from ci
                     where ci.category_id = c.id
                   ), '[]'::jsonb))
                 order by c.sort_order, c.created_at)
          from c
          where c.menu_id = m.id
        ), '[]'::jsonb)
      ) order by m.sort_order, m.created_at)
      from m
    ), '[]'::jsonb),

    'items', coalesce((
      select jsonb_object_agg(it.id, jsonb_build_object(
        'id', it.id,
        'name', it.name,
        'description', it.description,
        'type', it.item_type,
        'price', it.price,
        'calories', it.calories,
        'caffeine_mg', it.caffeine_mg,
        'spice', it.spice_level,
        'allergens', to_jsonb(it.allergens),
        'dietary', to_jsonb(it.dietary),
        'badges', to_jsonb(it.badges),
        'photo', it.photo_path,
        'available', it.is_available,
        'option_groups', coalesce((
          select jsonb_agg(iog.group_id order by iog.sort_order)
          from iog
          where iog.item_id = it.id
        ), '[]'::jsonb)
      ))
      from it
    ), '{}'::jsonb),

    'option_groups', coalesce((
      select jsonb_object_agg(grp.id, jsonb_build_object(
        'id', grp.id,
        'name', grp.name,
        'selection', grp.selection,
        'min', grp.min_select,
        'max', grp.max_select,
        'pricing', grp.pricing,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', op.id,
                   'name', op.name,
                   'price', op.price,
                   'calories', op.calories,
                   'is_default', op.is_default,
                   'available', op.is_available)
                 order by op.sort_order, op.created_at)
          from public.options op
          where op.group_id = grp.id
        ), '[]'::jsonb)
      ))
      from grp
    ), '{}'::jsonb)
  ) end;
$$;

-- Cheap version check so clients can skip re-downloading an unchanged menu.
create or replace function public.get_menu_version(p_slug text)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select data_version from public.outlets where slug = p_slug and is_active;
$$;

-- ---------------------------------------------------------------------
-- Admin: drag-and-drop reordering.
-- SECURITY INVOKER → RLS decides which rows the caller may update;
-- ids belonging to other outlets are silently ignored.
-- ---------------------------------------------------------------------
create or replace function public.reorder(p_table text, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_table not in ('menus', 'categories', 'option_groups', 'options', 'buffet_prices') then
    raise exception 'reorder: table % is not reorderable', p_table;
  end if;

  execute format(
    'update public.%I t
        set sort_order = o.ord * 10
       from unnest($1) with ordinality as o(id, ord)
      where t.id = o.id
        and t.sort_order is distinct from o.ord * 10', p_table)
  using p_ids;
end;
$$;

create or replace function public.reorder_category_items(p_category_id uuid, p_item_ids uuid[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.category_items t
     set sort_order = o.ord * 10
    from unnest(p_item_ids) with ordinality as o(item_id, ord)
   where t.category_id = p_category_id
     and t.item_id = o.item_id
     and t.sort_order is distinct from o.ord * 10;
$$;

create or replace function public.reorder_item_option_groups(p_item_id uuid, p_group_ids uuid[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.item_option_groups t
     set sort_order = o.ord * 10
    from unnest(p_group_ids) with ordinality as o(group_id, ord)
   where t.item_id = p_item_id
     and t.group_id = o.group_id
     and t.sort_order is distinct from o.ord * 10;
$$;

-- ---------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------
revoke execute on function public.reorder(text, uuid[])                        from public, anon;
revoke execute on function public.reorder_category_items(uuid, uuid[])         from public, anon;
revoke execute on function public.reorder_item_option_groups(uuid, uuid[])     from public, anon;
revoke execute on function public.bump_outlet_version()                        from public, anon, authenticated;

grant execute on function public.get_public_menu(text)                         to anon, authenticated;
grant execute on function public.get_menu_version(text)                        to anon, authenticated;
grant execute on function public.is_outlet_admin(uuid)                         to anon, authenticated;
grant execute on function public.is_outlet_owner(uuid)                         to anon, authenticated;
grant execute on function public.storage_outlet_id(text)                       to anon, authenticated;
grant execute on function public.reorder(text, uuid[])                         to authenticated;
grant execute on function public.reorder_category_items(uuid, uuid[])          to authenticated;
grant execute on function public.reorder_item_option_groups(uuid, uuid[])      to authenticated;
