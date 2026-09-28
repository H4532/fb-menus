// FB Menus — "My orders": orders sent from this phone are kept on the device,
// show live status, can be re-ordered, and saved as a receipt image.
import { SUPABASE_URL, SUPABASE_KEY } from '../platform.js';
import { t, tr, esc, lang, isRtl } from '../core/i18n.js';
import { price, number } from '../core/format.js';

const KEEP = 20;
export const STATUS_DOT = { new: '🟡', accepted: '🔵', ready: '🟢', served: '⚪', cancelled: '🔴', unknown: '🟡' };
const ACTIVE = ['new', 'accepted', 'ready'];
const WATCH_MS = 20000;
const WATCH_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const storeKey = (slug) => `fbm:orders:${slug}`;

export function savedOrders(slug) {
  try {
    const list = JSON.parse(localStorage.getItem(storeKey(slug)) || '[]');
    return list.filter((o) => Date.now() - new Date(o.at).getTime() < MAX_AGE_MS);
  } catch {
    return [];
  }
}

export function saveOrder(slug, snapshot) {
  const list = [snapshot, ...savedOrders(slug).filter((o) => o.id !== snapshot.id)].slice(0, KEEP);
  try { localStorage.setItem(storeKey(slug), JSON.stringify(list)); } catch { /* storage full / private mode */ }
}

function clearOrders(slug) {
  try { localStorage.removeItem(storeKey(slug)); } catch { /* ignore */ }
}

/** Build the snapshot kept on the phone from the sent cart. */
export function snapshotFrom(res, lines, data, location) {
  return {
    id: res.id,
    order_no: res.order_no,
    at: new Date().toISOString(),
    where: location,
    subtotal: Number(res.subtotal),
    currency: data.outlet.currency,
    timezone: data.outlet.timezone,
    outlet: { name: data.outlet.name, tagline: data.outlet.tagline },
    lines: lines.filter((l) => !l.problem).map((l) => ({
      item_id: l.item_id,
      option_ids: l.option_ids,
      qty: l.qty,
      name: l.item.name,
      options: l.options.map((o) => o.option.name),
      note: l.note || '',
      total: l.total,
    })),
    status: 'new',
  };
}

async function fetchStatuses(ids) {
  if (!ids.length) return {};
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/guest_order_status`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_ids: ids.slice(0, 20) }),
    });
    if (!res.ok) return {};
    return Object.fromEntries((await res.json()).map((r) => [r.id, r.status]));
  } catch {
    return {};
  }
}

const whereText = (w) => t(w.type === 'room' ? 'where_room' : 'where_table', { n: w.value });

function when(o) {
  return new Intl.DateTimeFormat(lang() === 'ar' ? 'ar-SA-u-nu-arab-ca-gregory' : lang(), {
    timeZone: o.timezone || 'Asia/Riyadh', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  }).format(new Date(o.at));
}

// ---------------------------------------------------------------------------
// "My orders" sheet
// ---------------------------------------------------------------------------
export async function openMyOrders({ slug, dialog, orderAgain }) {
  const list = savedOrders(slug);
  const draw = (statuses = {}) => {
    dialog.innerHTML = `
      <div class="sheet cart" role="document">
        <button type="button" class="sheet-close" data-close aria-label="${esc(t('close'))}">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
        <div class="sheet-body">
          <h2 class="sheet-title">${esc(t('my_orders'))}</h2>
          <p class="cart-where">${esc(t('my_orders_hint'))}</p>
          ${list.length ? list.map((o) => {
            const st = statuses[o.id] || o.status || 'unknown';
            return `
              <article class="my-order st-${esc(st)}" data-id="${esc(o.id)}">
                <header>
                  <strong>#${esc(o.order_no)}</strong>
                  <span>${esc(whereText(o.where))} · ${esc(when(o))}</span>
                  <span class="my-status st-${esc(st)}">${STATUS_DOT[st] || ''} ${esc(t(`status_${st}`))}</span>
                </header>
                <ul role="list">
                  ${o.lines.map((l) => `
                    <li><span>${l.qty}× ${esc(tr(l.name))}${l.options.length ? ` <small>(${l.options.map((x) => esc(tr(x))).join(', ')})</small>` : ''}</span>
                        <span>${price(l.total)}</span></li>`).join('')}
                </ul>
                <div class="my-total"><span>${esc(t('total'))}</span><strong>${price(o.subtotal)}</strong></div>
                <div class="my-actions">
                  <button type="button" class="btn-ghost" data-receipt="${esc(o.id)}">🧾 ${esc(t('save_receipt'))}</button>
                  ${orderAgain ? `<button type="button" class="btn-ghost" data-again="${esc(o.id)}">↻ ${esc(t('order_again'))}</button>` : ''}
                </div>
              </article>`;
          }).join('') : `<p class="muted cart-empty">${esc(t('no_saved_orders'))}</p>`}
          ${list.length ? `<button type="button" class="link-quiet" data-clear>${esc(t('clear_history'))}</button>` : ''}
        </div>
      </div>`;

    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.querySelectorAll('[data-receipt]').forEach((b) => b.addEventListener('click', () => {
      saveReceipt(list.find((o) => o.id === b.dataset.receipt));
    }));
    dialog.querySelectorAll('[data-again]').forEach((b) => b.addEventListener('click', () => {
      orderAgain(list.find((o) => o.id === b.dataset.again));
      dialog.close();
    }));
    dialog.querySelector('[data-clear]')?.addEventListener('click', () => {
      clearOrders(slug);
      list.length = 0;
      draw();
    });
  };

  draw();
  if (!dialog.open) dialog.showModal();
  dialog.onclick = (e) => { if (e.target === dialog) dialog.close(); };

  // Live status, then remember it on the phone.
  const statuses = await fetchStatuses(list.map((o) => o.id));
  if (Object.keys(statuses).length && dialog.open) {
    list.forEach((o) => { if (statuses[o.id]) o.status = statuses[o.id]; });
    try { localStorage.setItem(storeKey(slug), JSON.stringify(list)); } catch { /* ignore */ }
    draw(statuses);
  }
}

// ---------------------------------------------------------------------------
// Receipt image (PNG) — shared to Photos/WhatsApp or downloaded
// ---------------------------------------------------------------------------
export async function saveReceipt(order, onDone) {
  if (!order) return;
  const rtl = isRtl();
  const W = 900;
  const P = 56;
  const cur = lang() === 'ar' ? 'ر.س' : order.currency;
  const money = (n) => (lang() === 'ar' ? `${number(n, 2)} ${cur}` : `${cur} ${number(n, 2)}`);
  const green = getComputedStyle(document.documentElement).getPropertyValue('--c-primary').trim() || '#145A3C';
  const FONT = '"Readex Pro", "Segoe UI", Tahoma, sans-serif';

  try {
    await Promise.all([document.fonts.load(`600 32px ${FONT}`, 'Aa'), document.fonts.load(`600 32px ${FONT}`, 'عربي')]);
  } catch { /* draw with fallback fonts */ }

  // Measure pass, then draw pass.
  const draw = (ctx, measureOnly) => {
    let y = 0;
    const set = (size, weight = 400, color = '#15241C') => {
      ctx.font = `${weight} ${size}px ${FONT}`;
      ctx.fillStyle = color;
      ctx.direction = rtl ? 'rtl' : 'ltr';
    };
    // start/end helpers that respect reading direction
    const start = (s, yy) => { ctx.textAlign = rtl ? 'right' : 'left'; if (!measureOnly) ctx.fillText(s, rtl ? W - P : P, yy); };
    const end = (s, yy) => { ctx.textAlign = rtl ? 'left' : 'right'; if (!measureOnly) ctx.fillText(s, rtl ? P : W - P, yy); };
    const wrap = (s, max) => {
      const words = String(s).split(' ');
      const out = [];
      let line = '';
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width > max && line) { out.push(line); line = w; } else line = test;
      }
      if (line) out.push(line);
      return out;
    };

    // Header band
    if (!measureOnly) { ctx.fillStyle = green; ctx.fillRect(0, 0, W, 200); }
    set(46, 700, '#fff'); start(tr(order.outlet.name), 86);
    set(26, 300, '#fff'); start(tr(order.outlet.tagline), 132);
    set(24, 400, '#E4F0EB'); start(t('receipt_title'), 172);
    y = 200 + 70;

    set(64, 800, green); start(`#${order.order_no}`, y);
    set(28, 600); end(whereText(order.where), y - 18);
    set(24, 400, '#5C6E64'); end(when(order), y + 16);
    y += 48;
    if (!measureOnly) { ctx.fillStyle = green; ctx.fillRect(P, y, W - 2 * P, 3); }
    y += 50;

    for (const l of order.lines) {
      set(30, 600);
      const nameLines = wrap(`${number(l.qty)}×  ${tr(l.name)}`, W - 2 * P - 220);
      nameLines.forEach((s, i) => start(s, y + i * 40));
      set(30, 600, green); end(money(l.total), y);
      y += nameLines.length * 40;
      if (l.options.length) {
        set(24, 400, '#5C6E64');
        wrap(l.options.map((x) => tr(x)).join(' · '), W - 2 * P - 60).forEach((s) => { start(s, y); y += 34; });
      }
      if (l.note) {
        set(24, 400, '#6B4E00');
        wrap(lang() === 'ar' ? `«${l.note}»` : `“${l.note}”`, W - 2 * P - 60).forEach((s) => { start(s, y); y += 34; });
      }
      y += 22;
    }

    if (!measureOnly) { ctx.fillStyle = '#D5E0DA'; ctx.fillRect(P, y - 6, W - 2 * P, 2); }
    y += 50;
    set(34, 700); start(t('total'), y);
    set(38, 800, green); end(money(order.subtotal), y);
    y += 40;
    set(22, 400, '#5C6E64'); start(t('vat_incl'), y);
    y += 60;
    set(22, 400, '#5C6E64');
    wrap(t('pay_note'), W - 2 * P).forEach((s) => { start(s, y); y += 32; });
    return y + 40;
  };

  const probe = document.createElement('canvas').getContext('2d');
  const H = Math.ceil(draw(probe, true));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  draw(ctx, false);

  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const fileName = `order-${order.order_no}.png`;
  const file = new File([blob], fileName, { type: 'image/png' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `${t('receipt_title')} #${order.order_no}` });
      onDone?.();
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;           // guest closed the share sheet
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  onDone?.();
}

// ---------------------------------------------------------------------------
// Live watch: recent open orders on this phone are checked every 20 s.
// onUpdate(activeOrders, changedOrders) is called after each check.
// ---------------------------------------------------------------------------
let watchTimer = null;
export function activeOrders(slug) {
  return savedOrders(slug).filter((o) => ACTIVE.includes(o.status || 'new')
    && Date.now() - new Date(o.at).getTime() < WATCH_MAX_AGE_MS);
}

export function watchOrders(slug, onUpdate) {
  clearTimeout(watchTimer);
  const tick = async () => {
    const watching = activeOrders(slug);
    if (!watching.length) { onUpdate([], []); return; }       // nothing open: stop until a new order
    const statuses = await fetchStatuses(watching.map((o) => o.id));
    const all = savedOrders(slug);
    const changed = [];
    for (const o of all) {
      const st = statuses[o.id];
      if (st && st !== o.status) { o.status = st; changed.push(o); }
    }
    if (changed.length) {
      try { localStorage.setItem(storeKey(slug), JSON.stringify(all)); } catch { /* ignore */ }
    }
    onUpdate(activeOrders(slug), changed);
    if (document.visibilityState !== 'hidden' || activeOrders(slug).length) watchTimer = setTimeout(tick, WATCH_MS);
  };
  tick();
}
