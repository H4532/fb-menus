-- =====================================================================
-- FB Menus — 01_schema.sql
-- Multi-tenant online menu platform (Supabase / PostgreSQL 15+)
--
-- Run order: 01_schema → 02_functions → 03_rls → 04_storage → 05_private_helpers → 06_composite_fk_indexes → seed/*.sql
--
-- Conventions
--   * Every table carries outlet_id.
--   * Child tables use composite FKs (x_id, outlet_id) → parent(id, outlet_id)
--     so a row can never point at another outlet's data.
--   * Translatable text is jsonb: {"en": "...", "ar": "...", "fr": "..."}.
--   * Day numbers: 0 = Sunday … 6 = Saturday (same as JS Date.getDay()).
--   * Times are local to outlets.timezone.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Outlets
-- ---------------------------------------------------------------------
create table public.outlets (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique
                        check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name                jsonb not null check (jsonb_typeof(name) = 'object'),
  tagline             jsonb not null default '{}' check (jsonb_typeof(tagline) = 'object'),
  timezone            text not null default 'Asia/Riyadh',
  languages           text[] not null default '{ar,en}'
                        check (cardinality(languages) between 1 and 5),
  default_language    text not null default 'ar',
  currency            text not null default 'SAR' check (currency ~ '^[A-Z]{3}$'),
  vat_rate            numeric(5,2) not null default 15 check (vat_rate between 0 and 100),
  prices_include_vat  boolean not null default true,
  service_charge_pct  numeric(5,2) not null default 0 check (service_charge_pct between 0 and 100),
  price_note          jsonb not null default '{}' check (jsonb_typeof(price_note) = 'object'),
  calorie_note        jsonb not null default '{}' check (jsonb_typeof(calorie_note) = 'object'),
  -- [{"days":[0,1,2,3,4,5,6],"open":"06:30","close":"23:00"}]
  opening_hours       jsonb not null default '[]' check (jsonb_typeof(opening_hours) = 'array'),
  -- {"phone":"+966…","room_service_ext":"…","whatsapp":"+966…","email":"…"}
  contact             jsonb not null default '{}' check (jsonb_typeof(contact) = 'object'),
  unavailable_display text not null default 'grey'
                        check (unavailable_display in ('grey', 'hide')),
  is_active           boolean not null default true,
  data_version        bigint not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint outlets_default_language_listed check (default_language = any (languages))
);

comment on column public.outlets.data_version is
  'Incremented on every change to the outlet or its menu data; used by clients for cache invalidation.';

-- ---------------------------------------------------------------------
-- Outlet admins (links Supabase Auth users to outlets)
-- ---------------------------------------------------------------------
create table public.outlet_admins (
  outlet_id  uuid not null references public.outlets (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'editor' check (role in ('owner', 'editor')),
  created_at timestamptz not null default now(),
  primary key (outlet_id, user_id)
);

create index outlet_admins_user_idx on public.outlet_admins (user_id);

comment on table public.outlet_admins is
  'owner = content + outlet settings; editor = content only. Managed from the SQL editor.';

-- ---------------------------------------------------------------------
-- Menus (Breakfast, A La Carte, Buffet, …)
-- ---------------------------------------------------------------------
create table public.menus (
  id          uuid primary key default gen_random_uuid(),
  outlet_id   uuid not null references public.outlets (id) on delete cascade,
  slug        text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,40}$'),
  name        jsonb not null check (jsonb_typeof(name) = 'object'),
  description jsonb not null default '{}' check (jsonb_typeof(description) = 'object'),
  menu_type   text not null default 'a_la_carte'
                check (menu_type in ('a_la_carte', 'buffet', 'set')),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint menus_slug_unique unique (outlet_id, slug),
  constraint menus_id_outlet_unique unique (id, outlet_id)
);

create index menus_outlet_sort_idx on public.menus (outlet_id, sort_order);

-- ---------------------------------------------------------------------
-- Menu serving hours. A menu with no schedule rows is available all day.
-- end_time < start_time means the window runs past midnight; "days"
-- refers to the day the window starts.
-- ---------------------------------------------------------------------
create table public.menu_schedules (
  id         uuid primary key default gen_random_uuid(),
  outlet_id  uuid not null,
  menu_id    uuid not null,
  days       smallint[] not null default '{0,1,2,3,4,5,6}'
               check (cardinality(days) > 0 and days <@ '{0,1,2,3,4,5,6}'::smallint[]),
  start_time time not null,
  end_time   time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_schedules_window check (start_time <> end_time),
  constraint menu_schedules_menu_fk foreign key (menu_id, outlet_id)
    references public.menus (id, outlet_id) on delete cascade
);

create index menu_schedules_menu_idx on public.menu_schedules (menu_id);

-- ---------------------------------------------------------------------
-- Categories (sections inside a menu)
-- ---------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  outlet_id   uuid not null,
  menu_id     uuid not null,
  name        jsonb not null check (jsonb_typeof(name) = 'object'),
  description jsonb not null default '{}' check (jsonb_typeof(description) = 'object'),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint categories_id_outlet_unique unique (id, outlet_id),
  constraint categories_menu_fk foreign key (menu_id, outlet_id)
    references public.menus (id, outlet_id) on delete cascade
);

create index categories_menu_sort_idx on public.categories (menu_id, sort_order);
create index categories_outlet_idx    on public.categories (outlet_id);

-- ---------------------------------------------------------------------
-- Items — the outlet's dish/drink library.
-- Placed into one or more categories through category_items.
--
-- photo_path is a storage key WITHOUT size suffix or extension:
--   "<outlet_id>/items/<uuid>"  → files "<…>-400.webp" and "<…>-1200.webp"
-- ---------------------------------------------------------------------
create table public.items (
  id           uuid primary key default gen_random_uuid(),
  outlet_id    uuid not null references public.outlets (id) on delete cascade,
  code         text check (code ~ '^[a-z0-9][a-z0-9-]{0,60}$'),   -- optional internal / POS code
  name         jsonb not null check (jsonb_typeof(name) = 'object'),
  description  jsonb not null default '{}' check (jsonb_typeof(description) = 'object'),
  item_type    text not null default 'single' check (item_type in ('single', 'combo')),
  price        numeric(10,2) not null default 0 check (price >= 0),
  calories     integer check (calories >= 0),
  caffeine_mg  integer check (caffeine_mg >= 0),
  spice_level  smallint not null default 0 check (spice_level between 0 and 3),
  allergens    text[] not null default '{}'
                 check (allergens <@ array[
                   'gluten','crustaceans','egg','fish','peanuts','soy','dairy','nuts',
                   'celery','mustard','sesame','sulphites','lupin','molluscs'
                 ]::text[]),
  dietary      text[] not null default '{}'
                 check (dietary <@ array['vegetarian','vegan','gluten_free','dairy_free']::text[]),
  badges       text[] not null default '{}'
                 check (cardinality(badges) <= 5
                        and array_to_string(badges, ',') ~ '^([a-z0-9_]+(,|$))*$'),
  photo_path   text,
  is_available boolean not null default true,   -- false = "sold out today"
  is_active    boolean not null default true,   -- false = hidden from guests
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint items_id_outlet_unique unique (id, outlet_id),
  constraint items_code_unique unique (outlet_id, code)
);

create index items_outlet_idx on public.items (outlet_id);

comment on column public.items.badges is
  'Codes such as chef_special, signature, new, local. Labels come from the frontend i18n files / outlet config.';

-- ---------------------------------------------------------------------
-- Item placement in categories (with per-category ordering)
-- ---------------------------------------------------------------------
create table public.category_items (
  outlet_id   uuid not null,
  category_id uuid not null,
  item_id     uuid not null,
  sort_order  integer not null default 0,
  primary key (category_id, item_id),
  constraint category_items_category_fk foreign key (category_id, outlet_id)
    references public.categories (id, outlet_id) on delete cascade,
  constraint category_items_item_fk foreign key (item_id, outlet_id)
    references public.items (id, outlet_id) on delete cascade
);

create index category_items_item_idx on public.category_items (item_id);
create index category_items_sort_idx on public.category_items (category_id, sort_order);

-- ---------------------------------------------------------------------
-- Option groups (Size, Milk, Choice of side, Add-ons, Combo steps)
--   pricing = 'replace' → chosen option's price/calories REPLACE the item's
--                         (sizes, protein choice). Single-select only.
--   pricing = 'add'     → chosen options' prices/calories are ADDED.
--   Required group      → min_select >= 1.
-- ---------------------------------------------------------------------
create table public.option_groups (
  id            uuid primary key default gen_random_uuid(),
  outlet_id     uuid not null references public.outlets (id) on delete cascade,
  internal_name text not null,                 -- admin-only label, e.g. "Coffee sizes (hot)"
  name          jsonb not null check (jsonb_typeof(name) = 'object'),
  selection     text not null default 'single' check (selection in ('single', 'multi')),
  min_select    smallint not null default 0 check (min_select >= 0),
  max_select    smallint default 1,            -- null = unlimited (multi only)
  pricing       text not null default 'add' check (pricing in ('add', 'replace')),
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint option_groups_id_outlet_unique unique (id, outlet_id),
  constraint option_groups_single_max
    check (selection = 'multi' or coalesce(max_select, 0) = 1),
  constraint option_groups_multi_max
    check (selection = 'single' or coalesce(max_select, 32767) >= greatest(min_select, 1)),
  constraint option_groups_replace_single
    check (pricing = 'add' or selection = 'single')
);

create index option_groups_outlet_idx on public.option_groups (outlet_id);

create table public.options (
  id           uuid primary key default gen_random_uuid(),
  outlet_id    uuid not null,
  group_id     uuid not null,
  name         jsonb not null check (jsonb_typeof(name) = 'object'),
  price        numeric(10,2) not null default 0 check (price >= 0),
  calories     integer check (calories >= 0),
  is_default   boolean not null default false,
  is_available boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint options_group_fk foreign key (group_id, outlet_id)
    references public.option_groups (id, outlet_id) on delete cascade
);

create index options_group_sort_idx on public.options (group_id, sort_order);

create table public.item_option_groups (
  outlet_id  uuid not null,
  item_id    uuid not null,
  group_id   uuid not null,
  sort_order integer not null default 0,
  primary key (item_id, group_id),
  constraint item_option_groups_item_fk foreign key (item_id, outlet_id)
    references public.items (id, outlet_id) on delete cascade,
  constraint item_option_groups_group_fk foreign key (group_id, outlet_id)
    references public.option_groups (id, outlet_id) on delete cascade
);

create index item_option_groups_group_idx on public.item_option_groups (group_id);

-- ---------------------------------------------------------------------
-- Buffet prices (Adult / Child 6–12 / …) by day and time.
-- Null start/end = follows the menu's schedule.
-- ---------------------------------------------------------------------
create table public.buffet_prices (
  id         uuid primary key default gen_random_uuid(),
  outlet_id  uuid not null,
  menu_id    uuid not null,
  label      jsonb not null check (jsonb_typeof(label) = 'object'),
  price      numeric(10,2) not null check (price >= 0),
  days       smallint[] not null default '{0,1,2,3,4,5,6}'
               check (cardinality(days) > 0 and days <@ '{0,1,2,3,4,5,6}'::smallint[]),
  start_time time,
  end_time   time,
  note       jsonb not null default '{}' check (jsonb_typeof(note) = 'object'),
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint buffet_prices_times check ((start_time is null) = (end_time is null)),
  constraint buffet_prices_menu_fk foreign key (menu_id, outlet_id)
    references public.menus (id, outlet_id) on delete cascade
);

create index buffet_prices_menu_idx on public.buffet_prices (menu_id, sort_order);
