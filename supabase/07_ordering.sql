-- =====================================================================
-- FB Menus — 07_ordering.sql
-- Guest ordering from table/room QR codes, e-mail notification, admin orders.
--   * outlets.ordering        public flag {"enabled": bool} (shown to guests)
--   * outlet_order_settings   PRIVATE: notification e-mails (admins only)
--   * orders / order_items    written ONLY by place_order() via the
--                             place-order Edge Function (service role);
--                             prices are recomputed here, never trusted from the phone
--   * private.app_settings    e-mail provider key etc. (service role only)
-- =====================================================================

alter table public.outlets
  add column if not exists ordering jsonb not null default '{"enabled": false}'::jsonb
  check (jsonb_typeof(ordering) = 'object');

create table if not exists private.app_settings (
  key   text primary key,
  value text not null
);
revoke all on private.app_settings from public, anon, authenticated;

create table public.outlet_order_settings (
  outlet_id     uuid primary key references public.outlets (id) on delete cascade,
  notify_emails text[] not null default '{}'
                  check (cardinality(notify_emails) <= 5),
  updated_at    timestamptz not null default now()
);

create table public.orders (
  id            uuid primary key default gen_random_uuid(),
  outlet_id     uuid not null references public.outlets (id) on delete cascade,
  order_no      integer not null,
  location_type text not null check (location_type in ('table', 'room')),
  location      text not null check (location ~ '^[A-Za-z0-9-]{1,10}$'),
  guest_name    text check (char_length(guest_name) <= 60),
  guest_note    text check (char_length(guest_note) <= 300),
  lang          text,
  subtotal      numeric(10,2) not null default 0,
  item_count    integer not null default 0,
  status        text not null default 'new'
                  check (status in ('new', 'accepted', 'ready', 'served', 'cancelled')),
  notified_at   timestamptz,
  notify_error  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint orders_no_unique unique (outlet_id, order_no)
);
create index orders_outlet_created_idx on public.orders (outlet_id, created_at desc);
create index orders_location_recent_idx on public.orders (outlet_id, location_type, location, created_at desc);

create table public.order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  outlet_id  uuid not null references public.outlets (id) on delete cascade,
  item_id    uuid references public.items (id) on delete set null,
  name       jsonb not null,
  qty        integer not null check (qty between 1 and 20),
  unit_price numeric(10,2) not null,
  line_total numeric(10,2) not null,
  options    jsonb not null default '[]',
  note       text check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);
create index order_items_order_idx  on public.order_items (order_id);
create index order_items_outlet_idx on public.order_items (outlet_id);
create index order_items_item_idx   on public.order_items (item_id);

create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();
create trigger outlet_order_settings_set_updated_at before update on public.outlet_order_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Privileges + RLS (new tables get Supabase default grants → reset them)
-- ---------------------------------------------------------------------
revoke all on public.orders, public.order_items, public.outlet_order_settings from anon, authenticated;
grant select on public.orders, public.order_items to authenticated;
grant update (status) on public.orders to authenticated;
grant select, insert, update on public.outlet_order_settings to authenticated;

alter table public.orders                enable row level security;
alter table public.order_items           enable row level security;
alter table public.outlet_order_settings enable row level security;

create policy orders_admin_read on public.orders
  for select to authenticated using (private.is_outlet_admin(outlet_id));
create policy orders_admin_update on public.orders
  for update to authenticated
  using (private.is_outlet_admin(outlet_id)) with check (private.is_outlet_admin(outlet_id));
create policy order_items_admin_read on public.order_items
  for select to authenticated using (private.is_outlet_admin(outlet_id));
create policy order_settings_owner_read on public.outlet_order_settings
  for select to authenticated using (private.is_outlet_admin(outlet_id));
create policy order_settings_owner_insert on public.outlet_order_settings
  for insert to authenticated with check (private.is_outlet_owner(outlet_id));
create policy order_settings_owner_update on public.outlet_order_settings
  for update to authenticated
  using (private.is_outlet_owner(outlet_id)) with check (private.is_outlet_owner(outlet_id));

-- ---------------------------------------------------------------------
-- place_order(payload) — called by the Edge Function with the service role.
-- payload: {slug, location_type, location, name?, note?, lang?,
--           items: [{item_id, qty, option_ids: [], note?}]}
-- Errors are raised as short codes the guest page translates.
-- ---------------------------------------------------------------------
create or replace function public.place_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outlet   public.outlets%rowtype;
  v_loc_type text := p_payload->>'location_type';
  v_loc      text := nullif(btrim(p_payload->>'location'), '');
  v_lines    jsonb := p_payload->'items';
  v_line     jsonb;
  v_item     public.items%rowtype;
  v_grp      public.option_groups%rowtype;
  v_qty      integer;
  v_opt_ids  uuid[];
  v_base     numeric;
  v_add      numeric;
  v_unit     numeric;
  v_opts     jsonb;
  v_sel      integer;
  v_order_id uuid;
  v_no       integer;
  v_subtotal numeric := 0;
  v_count    integer := 0;
begin
  select * into v_outlet from public.outlets where slug = p_payload->>'slug' and is_active;
  if not found then raise exception 'OUTLET_NOT_FOUND'; end if;
  if not coalesce((v_outlet.ordering->>'enabled')::boolean, false) then raise exception 'ORDERING_CLOSED'; end if;
  if v_loc_type is null or v_loc_type not in ('table', 'room') or v_loc is null or v_loc !~ '^[A-Za-z0-9-]{1,10}$' then
    raise exception 'LOCATION_REQUIRED';
  end if;
  if jsonb_typeof(v_lines) is distinct from 'array' or jsonb_array_length(v_lines) not between 1 and 30 then
    raise exception 'EMPTY_ORDER';
  end if;

  -- Anti-spam: per table/room and per outlet.
  if (select count(*) from public.orders
       where outlet_id = v_outlet.id and location_type = v_loc_type and location = v_loc
         and created_at > now() - interval '10 minutes') >= 5
     or (select count(*) from public.orders
       where outlet_id = v_outlet.id and created_at > now() - interval '10 minutes') >= 60 then
    raise exception 'RATE_LIMIT';
  end if;

  perform pg_advisory_xact_lock(hashtext('orders:' || v_outlet.id::text));
  select coalesce(max(order_no), 0) + 1 into v_no from public.orders where outlet_id = v_outlet.id;

  insert into public.orders (outlet_id, order_no, location_type, location, guest_name, guest_note, lang)
  values (v_outlet.id, v_no, v_loc_type, v_loc,
          left(nullif(btrim(p_payload->>'name'), ''), 60),
          left(nullif(btrim(p_payload->>'note'), ''), 300),
          left(p_payload->>'lang', 5))
  returning id into v_order_id;

  for v_line in select value from jsonb_array_elements(v_lines) loop
    begin
      v_qty := (v_line->>'qty')::integer;
    exception when others then
      raise exception 'BAD_REQUEST';
    end;
    if v_qty is null or v_qty not between 1 and 20 then raise exception 'BAD_QTY'; end if;

    select i.* into v_item
    from public.items i
    where i.id = (v_line->>'item_id')::uuid
      and i.outlet_id = v_outlet.id
      and i.is_active
      and exists (
        select 1 from public.category_items ci
        join public.categories c on c.id = ci.category_id and c.is_active
        join public.menus m on m.id = c.menu_id and m.is_active
        where ci.item_id = i.id);
    if not found then raise exception 'ITEM_NOT_FOUND'; end if;
    if not v_item.is_available then
      raise exception 'ITEM_UNAVAILABLE:%', coalesce(v_item.name->>'en', v_item.name->>'ar', '');
    end if;

    select coalesce(array_agg(distinct x::uuid), '{}') into v_opt_ids
    from jsonb_array_elements_text(coalesce(v_line->'option_ids', '[]'::jsonb)) as x;

    if exists (
      select 1 from unnest(v_opt_ids) as sel(id)
      where not exists (
        select 1 from public.options o
        join public.item_option_groups g on g.group_id = o.group_id and g.item_id = v_item.id
        where o.id = sel.id and o.is_available)) then
      raise exception 'OPTION_INVALID';
    end if;

    v_base := v_item.price;
    v_add := 0;
    v_opts := '[]'::jsonb;
    for v_grp in
      select og.* from public.item_option_groups g
      join public.option_groups og on og.id = g.group_id
      where g.item_id = v_item.id
      order by g.sort_order
    loop
      select count(*) into v_sel from public.options o where o.group_id = v_grp.id and o.id = any (v_opt_ids);
      if v_sel < v_grp.min_select or (v_grp.max_select is not null and v_sel > v_grp.max_select) then
        raise exception 'OPTION_REQUIRED:%', coalesce(v_grp.name->>'en', v_grp.internal_name);
      end if;
      if v_sel > 0 then
        if v_grp.pricing = 'replace' then
          select o.price into v_base from public.options o where o.group_id = v_grp.id and o.id = any (v_opt_ids) limit 1;
        else
          v_add := v_add + (select coalesce(sum(o.price), 0) from public.options o where o.group_id = v_grp.id and o.id = any (v_opt_ids));
        end if;
        v_opts := v_opts || (
          select jsonb_agg(jsonb_build_object('group', v_grp.name, 'option', o.name, 'price', o.price, 'pricing', v_grp.pricing) order by o.sort_order)
          from public.options o where o.group_id = v_grp.id and o.id = any (v_opt_ids));
      end if;
    end loop;

    v_unit := v_base + v_add;
    insert into public.order_items (order_id, outlet_id, item_id, name, qty, unit_price, line_total, options, note)
    values (v_order_id, v_outlet.id, v_item.id, v_item.name, v_qty, v_unit, v_unit * v_qty, v_opts,
            left(nullif(btrim(v_line->>'note'), ''), 200));
    v_subtotal := v_subtotal + v_unit * v_qty;
    v_count := v_count + v_qty;
  end loop;

  update public.orders set subtotal = v_subtotal, item_count = v_count where id = v_order_id;
  return jsonb_build_object('id', v_order_id, 'order_no', v_no, 'subtotal', v_subtotal, 'item_count', v_count);
end;
$$;

-- Everything the e-mail needs, in one call (service role only).
create or replace function public.order_notification(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order', to_jsonb(o) - 'outlet_id',
    'items', coalesce((select jsonb_agg(to_jsonb(i) - 'outlet_id' - 'order_id' order by i.created_at, i.id)
                       from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'outlet', jsonb_build_object('name', ot.name, 'tagline', ot.tagline, 'timezone', ot.timezone,
                                 'currency', ot.currency, 'slug', ot.slug),
    'notify_emails', coalesce(to_jsonb(s.notify_emails), '[]'::jsonb),
    'resend_api_key', (select value from private.app_settings where key = 'resend_api_key'),
    'mail_from', coalesce((select value from private.app_settings where key = 'mail_from'), 'Menu orders <onboarding@resend.dev>'),
    'admin_url', (select value from private.app_settings where key = 'admin_url')
  )
  from public.orders o
  join public.outlets ot on ot.id = o.outlet_id
  left join public.outlet_order_settings s on s.outlet_id = o.outlet_id
  where o.id = p_order_id;
$$;

revoke execute on function public.place_order(jsonb)        from public, anon, authenticated;
revoke execute on function public.order_notification(uuid)  from public, anon, authenticated;
grant  execute on function public.place_order(jsonb)        to service_role;
grant  execute on function public.order_notification(uuid)  to service_role;

-- Public menu now also returns the ordering on/off flag (never the e-mails).
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
        'data_version', o.data_version,
        'ordering', jsonb_build_object('enabled', coalesce((o.ordering->>'enabled')::boolean, false))
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
