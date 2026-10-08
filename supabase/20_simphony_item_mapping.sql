-- =====================================================================
-- FB Menus — 20_simphony_item_mapping.sql
-- Simphony catalogue + per-dish mapping for POS transaction integration.
-- Initial catalogue: RVC 101 - Roshan Restaurant (Price Records, 2026-10-08).
-- =====================================================================

create table if not exists public.simphony_catalog_items (
  id                  uuid primary key default gen_random_uuid(),
  outlet_id           uuid not null references public.outlets(id) on delete cascade,
  rvc_number          integer not null check (rvc_number > 0),
  object_number       bigint not null check (object_number > 0),
  definition_sequence integer not null default 1 check (definition_sequence > 0),
  price_sequence      integer not null default 1 check (price_sequence > 0),
  name                text not null,
  price               numeric(10,2) not null default 0 check (price >= 0),
  major_group         text,
  family_group        text,
  is_active           boolean not null default true,
  source              text not null default 'manual',
  source_updated_at   timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint simphony_catalog_unique unique
    (outlet_id, rvc_number, object_number, definition_sequence, price_sequence),
  constraint simphony_catalog_id_outlet_unique unique (id, outlet_id)
);

create index if not exists simphony_catalog_outlet_rvc_idx
  on public.simphony_catalog_items(outlet_id, rvc_number, name);
create index if not exists simphony_catalog_object_idx
  on public.simphony_catalog_items(outlet_id, object_number);

create table if not exists public.simphony_item_mappings (
  id              uuid primary key default gen_random_uuid(),
  outlet_id       uuid not null,
  item_id         uuid not null,
  rvc_number      integer not null check (rvc_number > 0),
  catalog_item_id uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint simphony_mapping_item_fk foreign key (item_id, outlet_id)
    references public.items(id, outlet_id) on delete cascade,
  constraint simphony_mapping_catalog_fk foreign key (catalog_item_id, outlet_id)
    references public.simphony_catalog_items(id, outlet_id) on delete restrict,
  constraint simphony_mapping_item_rvc_unique unique (item_id, rvc_number),
  constraint simphony_mapping_catalog_unique unique (catalog_item_id)
);

create index if not exists simphony_mappings_outlet_idx
  on public.simphony_item_mappings(outlet_id, rvc_number);

revoke all on public.simphony_catalog_items from anon;
revoke all on public.simphony_item_mappings from anon;
grant select on public.simphony_catalog_items to authenticated;
grant select, insert, update, delete on public.simphony_item_mappings to authenticated;

alter table public.simphony_catalog_items enable row level security;
alter table public.simphony_item_mappings enable row level security;

drop policy if exists simphony_catalog_admin_read on public.simphony_catalog_items;
create policy simphony_catalog_admin_read on public.simphony_catalog_items
  for select to authenticated using (private.has_perm(outlet_id, 'dishes'));

drop policy if exists simphony_mappings_admin_read on public.simphony_item_mappings;
drop policy if exists simphony_mappings_admin_insert on public.simphony_item_mappings;
drop policy if exists simphony_mappings_admin_update on public.simphony_item_mappings;
drop policy if exists simphony_mappings_admin_delete on public.simphony_item_mappings;
create policy simphony_mappings_admin_read on public.simphony_item_mappings
  for select to authenticated using (private.has_perm(outlet_id, 'dishes'));
create policy simphony_mappings_admin_insert on public.simphony_item_mappings
  for insert to authenticated with check (private.has_perm(outlet_id, 'dishes'));
create policy simphony_mappings_admin_update on public.simphony_item_mappings
  for update to authenticated
  using (private.has_perm(outlet_id, 'dishes'))
  with check (private.has_perm(outlet_id, 'dishes'));
create policy simphony_mappings_admin_delete on public.simphony_item_mappings
  for delete to authenticated using (private.has_perm(outlet_id, 'dishes'));

-- Seed the current Roshan web-menu items plus Local Water Large for the
-- controlled POS integration test. Simphony prices are before 15% VAT;
-- Roshan guest-menu prices include VAT.
with o as (select id from public.outlets where slug = 'roshan')
insert into public.simphony_catalog_items
  (outlet_id,rvc_number,object_number,definition_sequence,price_sequence,name,price,major_group,family_group,is_active,source,source_updated_at)
select o.id, v.rvc, v.obj, 1, 1, v.name, v.price, v.major_group, v.family_group, true, 'simphony_price_records_2026_10_08', '2026-10-08T17:14:00+03'::timestamptz
from o cross join (values
  (101,112070007::bigint,'Butter Chicken',69.57,'10 - Food','1207 - Main Others'),
  (101,111120004::bigint,'Caesar Salad',39.13,'10 - Food','1112 - Salads'),
  (101,115040007::bigint,'Cheese Sandwich',43.48,'10 - Food','1504 - Sandwiches Cold'),
  (101,114040001::bigint,'Cheesecake with Blackberry Sauce',30.43,'10 - Food','1404 - Cake'),
  (101,114020005::bigint,'Chocolate Cake',30.43,'10 - Food','1402 - Dessert Hot'),
  (101,111120017::bigint,'Greek Salad',34.78,'10 - Food','1112 - Salads'),
  (101,112030003::bigint,'Chicken Grilled',69.57,'10 - Food','1203 - Main Grill'),
  (101,112020002::bigint,'Grilled Salmon',95.65,'10 - Food','1202 - Main Seafood'),
  (101,115040001::bigint,'Holiday Inn Club Sandwich',52.17,'10 - Food','1504 - Sandwiches Cold'),
  (101,112030001::bigint,'Mix Grill Platter',108.70,'10 - Food','1203 - Main Grill'),
  (101,112050002::bigint,'Pizza Vegetarian',43.48,'10 - Food','1205 - Main Pizza'),
  (101,114010001::bigint,'Seasonal Fruits Slices',30.43,'10 - Food','1401 - Dessert Cold'),
  (101,112040002::bigint,'Spaghetti Bolognaise',43.48,'10 - Food','1204 - Main Pasta'),
  (101,112040001::bigint,'Spaghetti Napolitano',39.13,'10 - Food','1204 - Main Pasta'),
  (101,115040010::bigint,'Steak Sandwich',52.17,'10 - Food','1504 - Sandwiches Cold'),
  (101,120010004::bigint,'Local Water Large',10.44,'20 - Beverage Non Alcohol','2001 - Mineral Water Small')
) as v(rvc,obj,name,price,major_group,family_group)
on conflict (outlet_id,rvc_number,object_number,definition_sequence,price_sequence)
do update set name=excluded.name, price=excluded.price, major_group=excluded.major_group,
  family_group=excluded.family_group, is_active=true, source=excluded.source,
  source_updated_at=excluded.source_updated_at, updated_at=now();

-- Pre-map the 15 dishes already published on the Roshan web menu.
with o as (select id from public.outlets where slug='roshan'),
pairs(web_name,obj) as (values
  ('Butter Chicken',112070007::bigint),
  ('Caesar Salad',111120004::bigint),
  ('Cheese Sandwich',115040007::bigint),
  ('Cheesecake with Blackberry Sauce',114040001::bigint),
  ('Chocolate Cake',114020005::bigint),
  ('Greek Salad',111120017::bigint),
  ('Grilled Chicken',112030003::bigint),
  ('Grilled Salmon',112020002::bigint),
  ('Holiday Inn Club Sandwich',115040001::bigint),
  ('Mix Grill Platter',112030001::bigint),
  ('Pizza Vegetarian',112050002::bigint),
  ('Seasonal Fruits Slices',114010001::bigint),
  ('Spaghetti Bolognaise Pasta',112040002::bigint),
  ('Spaghetti Napolitano Pasta',112040001::bigint),
  ('Steak Sandwich',115040010::bigint)
)
insert into public.simphony_item_mappings(outlet_id,item_id,rvc_number,catalog_item_id)
select o.id, i.id, 101, c.id
from o
join public.items i on i.outlet_id=o.id
join pairs p on i.name->>'en'=p.web_name
join public.simphony_catalog_items c on c.outlet_id=o.id and c.rvc_number=101 and c.object_number=p.obj
on conflict (item_id,rvc_number) do update
set catalog_item_id=excluded.catalog_item_id, updated_at=now();
