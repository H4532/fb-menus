-- Follow-up for databases where 20_simphony_item_mapping already ran.
alter table public.simphony_item_mappings
  drop constraint if exists simphony_mapping_catalog_unique;

create index if not exists simphony_mappings_item_fk_idx
  on public.simphony_item_mappings(item_id, outlet_id);
create index if not exists simphony_mappings_catalog_fk_idx
  on public.simphony_item_mappings(catalog_item_id, outlet_id);
