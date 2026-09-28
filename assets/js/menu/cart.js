// FB Menus — guest cart. Kept on the phone per outlet + table/room, sent to
// the place-order Edge Function. Prices shown here are for the guest's
// information only; the server recalculates everything.
import { SUPABASE_URL, SUPABASE_KEY } from '../platform.js';

const TTL_MS = 4 * 60 * 60 * 1000;           // forget a cart after 4 hours
let key = null;
let lines = [];
const listeners = new Set();

/** Where the guest is ordering from, based on the QR code (?t=12 or ?r=1204). */
export function locationFromUrl(params) {
  const clean = (v) => (v && /^[A-Za-z0-9-]{1,10}$/.test(v) ? v : null);
  const room = clean(params.get('r'));
  if (room) return { type: 'room', value: room };
  const table = clean(params.get('t'));
  if (table) return { type: 'table', value: table };
  return null;
}

export function initCart(slug, location) {
  key = `fbm:cart:${slug}:${location.type}:${location.value}`;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    lines = saved && Date.now() - saved.at < TTL_MS ? saved.lines : [];
  } catch {
    lines = [];
  }
}

function save() {
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), lines })); } catch { /* ignore */ }
  listeners.forEach((fn) => fn(lines));
}

export const onCartChange = (fn) => listeners.add(fn);
export const getLines = () => lines;

const lineKey = (itemId, optionIds, note) => `${itemId}|${[...optionIds].sort().join(',')}|${(note || '').trim()}`;

export function addLine(itemId, optionIds, qty, note) {
  const k = lineKey(itemId, optionIds, note);
  const existing = lines.find((l) => l.key === k);
  if (existing) existing.qty = Math.min(20, existing.qty + qty);
  else lines.push({ key: k, item_id: itemId, option_ids: [...optionIds], qty, note: (note || '').trim() });
  save();
}

export function setQty(k, qty) {
  const l = lines.find((x) => x.key === k);
  if (!l) return;
  if (qty <= 0) lines = lines.filter((x) => x.key !== k);
  else l.qty = Math.min(20, qty);
  save();
}

export function removeLine(k) {
  lines = lines.filter((x) => x.key !== k);
  save();
}

export function clearCart() {
  lines = [];
  save();
}

/** Unit price for an item with chosen options (same rules as the server). */
export function unitPrice(data, itemId, optionIds) {
  const item = data.items[itemId];
  if (!item) return null;
  let base = Number(item.price);
  let add = 0;
  for (const gid of item.option_groups) {
    const g = data.option_groups[gid];
    if (!g) continue;
    const chosen = g.options.filter((o) => optionIds.includes(o.id));
    if (!chosen.length) continue;
    if (g.pricing === 'replace') base = Number(chosen[0].price);
    else add += chosen.reduce((s, o) => s + Number(o.price), 0);
  }
  return base + add;
}

/** Lines enriched with current menu data; `problem` is set when a line can't be ordered. */
export function resolvedLines(data) {
  return lines.map((l) => {
    const item = data.items[l.item_id];
    const unit = unitPrice(data, l.item_id, l.option_ids);
    let problem = null;
    if (!item) problem = 'ITEM_NOT_FOUND';
    else if (!item.available) problem = 'ITEM_UNAVAILABLE';
    else {
      const allOpts = item.option_groups.flatMap((g) => data.option_groups[g]?.options || []);
      if (l.option_ids.some((id) => !allOpts.find((o) => o.id === id && o.available))) problem = 'OPTION_INVALID';
    }
    const options = item ? item.option_groups.flatMap((gid) => {
      const g = data.option_groups[gid];
      return (g?.options || []).filter((o) => l.option_ids.includes(o.id)).map((o) => ({ group: g, option: o }));
    }) : [];
    return { ...l, item, unit, total: unit == null ? 0 : unit * l.qty, options, problem };
  });
}

export function totals(data) {
  const r = resolvedLines(data).filter((l) => !l.problem);
  return { count: r.reduce((s, l) => s + l.qty, 0), amount: r.reduce((s, l) => s + l.total, 0) };
}

/** Send the order. Resolves with {order_no, subtotal} or throws {code, detail}. */
export async function submitOrder({ slug, location, name, note, lang }) {
  const body = {
    slug,
    location_type: location.type,
    location: location.value,
    name: name || null,
    note: note || null,
    lang,
    items: lines.map((l) => ({ item_id: l.item_id, qty: l.qty, option_ids: l.option_ids, note: l.note || null })),
  };
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/place-order`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw { code: 'NETWORK' };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { code: data.error || 'NETWORK', detail: data.detail || '' };
  return data;
}
