// FB Menus — platform settings shared by every outlet and the admin panel.
// The publishable key is safe to publish: row-level security in the
// database decides what each visitor can read or write.

export const SUPABASE_URL = 'https://swjffroqtxfbsmtjpimw.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_9iSpnZU7vc1n2K4kMMjYNg_l55LW1XU';
export const PHOTO_BUCKET = 'menu-photos';

// Photo sizes produced by the admin uploader. photo_path in the database is
// stored without suffix; the files are "<path>-400.webp" and "<path>-1200.webp".
export const PHOTO_SIZES = { thumb: 400, large: 1200 };

export function photoUrl(path, size = 'thumb') {
  if (!path) return null;
  const px = PHOTO_SIZES[size] || PHOTO_SIZES.thumb;
  return `${SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${path}-${px}.webp`;
}
