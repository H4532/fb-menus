// FB Menus — loads an outlet's public menu with ONE request and keeps a
// copy on the device, so repeat visits open instantly and weak Wi-Fi or a
// dropped connection still shows the last good menu.
// No Supabase library needed on the guest side: plain fetch keeps it light.
import { SUPABASE_URL, SUPABASE_KEY } from '../platform.js';

const cacheKey = (slug) => `fbm:menu:${slug}`;
const TIMEOUT_MS = 10000;

export function readCached(slug) {
  try {
    const raw = localStorage.getItem(cacheKey(slug));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCached(slug, data) {
  try { localStorage.setItem(cacheKey(slug), JSON.stringify(data)); } catch { /* quota / private mode */ }
}

export async function fetchMenu(slug) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_menu`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_slug: slug }),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data) throw new Error('not-found');
    writeCached(slug, data);
    return data;
  } finally {
    clearTimeout(timer);
  }
}
