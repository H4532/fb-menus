// FB Menus admin — Orders: live list of guest orders from table/room QR codes.
import { esc } from '../core/i18n.js';
import * as api from './api.js';
import { $, $$, toast, errorToast, money } from './ui.js';

const POLL_MS = 15000;
const NEXT = { new: 'accepted', accepted: 'ready', ready: 'served' };
const LABEL = { new: 'New', accepted: 'Accepted', ready: 'Ready', served: 'Served', cancelled: 'Cancelled' };
const ACTION = { new: 'Accept', accepted: 'Mark ready', ready: 'Mark served' };

let timer = null;
let seen = new Set();
let filter = 'active';
let audioCtx = null;

const en = (o) => o?.en || o?.ar || Object.values(o || {})[0] || '';
const ar = (o) => o?.ar || '';

function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function beep() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.frequency.value = 880; g.gain.value = 0.15;
    o.start(); o.stop(audioCtx.currentTime + 0.25);
  } catch { /* audio not allowed yet */ }
}

export function renderOrders(ctx) {
  const root = $('#view');
  root.dataset.view = 'orders';
  const enabled = Boolean(ctx.outlet.ordering?.enabled);
  root.innerHTML = `
    <div class="view-head">
      <h1>Orders</h1>
      <div class="seg" role="tablist" aria-label="Filter">
        <button type="button" role="tab" data-filter="active" aria-selected="${filter === 'active'}">Open</button>
        <button type="button" role="tab" data-filter="all" aria-selected="${filter === 'all'}">All today</button>
      </div>
    </div>
    ${enabled ? '' : `<p class="notice">Guests can’t order yet. Turn on <strong>Take orders</strong> in Settings.</p>`}
    <p class="hint">Updates every 15 seconds. New orders beep and show at the top.</p>
    <div id="orders-list"><div class="loading"><span class="spinner"></span></div></div>`;

  $$('[data-filter]', root).forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.filter;
    $$('[data-filter]', root).forEach((x) => x.setAttribute('aria-selected', x === b));
    refresh(ctx, false);
  }));
  root.addEventListener('click', (e) => onAction(ctx, e));

  clearInterval(timer);
  seen = new Set();
  refresh(ctx, true);
  timer = setInterval(() => {
    if ($('#view')?.dataset.view !== 'orders') { clearInterval(timer); document.title = document.title.replace(/^\(\d+\) /, ''); return; }
    refresh(ctx, false);
  }, POLL_MS);
}

async function refresh(ctx, first) {
  const since = new Date();
  since.setHours(since.getHours() - 18);          // "today" for a restaurant day incl. late night
  let orders;
  try {
    orders = await api.loadOrders(ctx.outlet.id, since.toISOString());
  } catch (err) {
    if (first) errorToast(err);
    return;
  }
  const fresh = orders.filter((o) => !seen.has(o.id));
  if (!first && fresh.some((o) => o.status === 'new')) {
    beep();
    toast(`New order #${fresh[0].order_no}`);
  }
  orders.forEach((o) => seen.add(o.id));

  const open = orders.filter((o) => ['new', 'accepted', 'ready'].includes(o.status));
  const newCount = orders.filter((o) => o.status === 'new').length;
  document.title = `${newCount ? `(${newCount}) ` : ''}${document.title.replace(/^\(\d+\) /, '')}`;
  const list = filter === 'active' ? open : orders;
  const host = $('#orders-list');
  if (!host) return;
  host.innerHTML = list.length
    ? `<div class="order-grid">${list.map(card).join('')}</div>`
    : `<div class="empty"><p>${filter === 'active' ? 'No open orders.' : 'No orders today yet.'}</p></div>`;
}

function card(o) {
  const where = o.location_type === 'room' ? `Room ${o.location}` : `Table ${o.location}`;
  const items = (o.order_items || []).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const mail = o.notified_at
    ? '<span class="tag tag-info">E-mailed</span>'
    : (o.notify_error ? `<span class="tag tag-warn" title="${esc(o.notify_error)}">E-mail not sent</span>` : '');
  return `
    <article class="order-card st-${o.status}" data-order="${o.id}">
      <header class="order-head">
        <div>
          <strong class="order-no">#${o.order_no}</strong>
          <span class="order-where">${esc(where)}</span>
        </div>
        <div class="order-meta">
          <span class="status status-${o.status}">${LABEL[o.status]}</span>
          <span class="hint">${esc(ago(o.created_at))}</span>
        </div>
      </header>
      ${o.guest_name ? `<p class="order-guest">Guest: <strong>${esc(o.guest_name)}</strong></p>` : ''}
      <ul class="order-items" role="list">
        ${items.map((i) => `
          <li>
            <span class="oi-qty">${i.qty}×</span>
            <span class="oi-main">
              <span class="oi-name">${esc(en(i.name))}${ar(i.name) ? ` <span class="nm-sub" dir="rtl">${esc(ar(i.name))}</span>` : ''}</span>
              ${(i.options || []).length ? `<span class="oi-opts">${i.options.map((x) => `${esc(en(x.group))}: <b>${esc(en(x.option))}</b>`).join(' · ')}</span>` : ''}
              ${i.note ? `<span class="oi-note">📝 ${esc(i.note)}</span>` : ''}
            </span>
            <span class="oi-total">${money(i.line_total)}</span>
          </li>`).join('')}
      </ul>
      ${o.guest_note ? `<p class="oi-note order-note">📝 ${esc(o.guest_note)}</p>` : ''}
      <footer class="order-foot">
        <span class="order-total">${o.item_count} items · <strong>${money(o.subtotal)}</strong> ${mail}</span>
        <span class="order-actions">
          ${['new', 'accepted'].includes(o.status) ? `<button type="button" class="btn btn-small btn-danger-quiet" data-status="cancelled" data-id="${o.id}">Cancel</button>` : ''}
          ${NEXT[o.status] ? `<button type="button" class="btn btn-small btn-primary" data-status="${NEXT[o.status]}" data-id="${o.id}">${ACTION[o.status]}</button>` : ''}
        </span>
      </footer>
    </article>`;
}

async function onAction(ctx, e) {
  const btn = e.target.closest('[data-status]');
  if (!btn) return;
  if (btn.dataset.status === 'cancelled' && !confirm('Cancel this order?')) return;
  btn.disabled = true;
  try {
    await api.setOrderStatus(btn.dataset.id, btn.dataset.status);
    toast(`Order ${LABEL[btn.dataset.status].toLowerCase()}`);
    refresh(ctx, false);
  } catch (err) {
    errorToast(err);
    btn.disabled = false;
  }
}
