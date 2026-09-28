-- =====================================================================
-- FB Menus — 04_storage.sql
-- Photo bucket. Public read (served by the CDN through
-- /storage/v1/object/public/menu-photos/...). Writes limited to admins of
-- the outlet whose id is the first folder of the object key:
--   <outlet_id>/items/<uuid>-400.webp
--   <outlet_id>/items/<uuid>-1200.webp
--   <outlet_id>/branding/...
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menu-photos',
  'menu-photos',
  true,
  2097152,                                   -- 2 MB (client compresses to ~100–300 KB)
  array['image/webp', 'image/jpeg', 'image/png', 'image/svg+xml']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Admins can list/see their outlet's objects (needed by the API for delete/replace).
create policy menu_photos_admin_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'menu-photos'
    and public.is_outlet_admin(public.storage_outlet_id(name))
  );

create policy menu_photos_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'menu-photos'
    and public.is_outlet_admin(public.storage_outlet_id(name))
  );

create policy menu_photos_admin_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'menu-photos'
    and public.is_outlet_admin(public.storage_outlet_id(name))
  )
  with check (
    bucket_id = 'menu-photos'
    and public.is_outlet_admin(public.storage_outlet_id(name))
  );

create policy menu_photos_admin_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'menu-photos'
    and public.is_outlet_admin(public.storage_outlet_id(name))
  );
