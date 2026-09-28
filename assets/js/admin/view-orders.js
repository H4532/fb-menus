// FB Menus admin — Orders: live list of guest orders from table/room QR codes.
import { esc } from '../core/i18n.js';
import * as api from './api.js';
import { $, $$, toast, errorToast, money } from './ui.js';

const POLL_MS = 15000;
const NEXT = { new: 'accepted', accepted: 'ready', ready: 'served' };
const LABEL = { new: 'New', accepted: 'Accepted', ready: 'Ready', served: 'Served', cancelled: 'Cancelled' };
const DOT = { new: '🟡', accepted: '🔵', ready: '🟢', served: '⚪', cancelled: '🔴' };
let activationWarned = false;
let TZ = 'Asia/Riyadh';
const clock = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
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
  return clock(iso);
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
  TZ = ctx.outlet.timezone || TZ;
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
  const dot = (st) => `<i class="sd sd-${st}" aria-hidden="true"></i>`;
  const timeline = (o.status_history || []).map((h) =>
    `<span class="tl tl-${h.status}">${dot(h.status)}${LABEL[h.status] || h.status} <small>${clock(h.at)}</small></span>`).join('<span class="tl-arrow">→</span>');
  const mail = o.notified_at
    ? '<span class="tag tag-info">E-mailed</span>'
    : (o.notify_error ? `<span class="tag tag-warn" title="${esc(o.notify_error)}">E-mail not sent</span>` : '');
  return `
    <article class="order-card st-${o.status}" data-order="${o.id}">
      <header class="order-band">
        <div class="ob-main">
          <strong class="order-no">#${o.order_no}</strong>
          <span class="order-where">${esc(where)}</span>
        </div>
        <div class="ob-side">
          <span class="ob-status">${dot(o.status)}${LABEL[o.status]}</span>
          <span class="ob-ago">${esc(ago(o.created_at))}</span>
        </div>
      </header>
      <div class="order-body">
        ${timeline ? `<p class="order-timeline">${timeline}</p>` : ''}
        ${o.guest_name ? `<p class="order-guest">Guest: <strong>${esc(o.guest_name)}</strong></p>` : ''}
        <table class="order-table">
          <thead><tr><th>Qty</th><th>Item</th><th class="num">Amount</th></tr></thead>
          <tbody>
            ${items.map((i) => `
              <tr>
                <td class="oi-qty">${i.qty}×</td>
                <td>
                  <span class="oi-name">${esc(en(i.name))}</span>${ar(i.name) ? ` <span class="nm-sub" dir="rtl">${esc(ar(i.name))}</span>` : ''}
                  ${(i.options || []).length ? `<span class="oi-opts">${i.options.map((x) => `${esc(en(x.group))}: <b>${esc(en(x.option))}</b>`).join(' · ')}</span>` : ''}
                  ${i.note ? `<span class="oi-note">📝 ${esc(i.note)}</span>` : ''}
                </td>
                <td class="num">${money(i.line_total)}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot><tr><td></td><td>Total <small>(${o.item_count} items)</small></td><td class="num">${money(o.subtotal)}</td></tr></tfoot>
        </table>
        ${o.guest_note ? `<p class="oi-note order-note">📝 ${esc(o.guest_note)}</p>` : ''}
        ${etaBlock(o)}
        <footer class="order-foot">
          <span class="order-mail">${mail}</span>
          <span class="order-actions">
            ${['new', 'accepted'].includes(o.status) ? `<button type="button" class="btn btn-small btn-st btn-st-cancelled" data-status="cancelled" data-id="${o.id}">${dot('cancelled')}Cancel</button>` : ''}
            ${NEXT[o.status] ? `<button type="button" class="btn btn-small btn-st btn-st-${NEXT[o.status]}" data-status="${NEXT[o.status]}" data-id="${o.id}">${dot(NEXT[o.status])}${ACTION[o.status]}</button>` : ''}
          </span>
        </footer>
      </div>
    </article>`;
}

function etaBlock(o) {
  if (o.status === 'new' || o.status === 'accepted') {
    const v = o.estimated_minutes ?? '';
    const label = o.status === 'new' ? 'Estimated time' : 'Adjust: ready in';
    return `
      <div class="eta-edit" data-eta-for="${o.id}">
        <span class="eta-label">⏱ ${label}</span>
        <button type="button" class="eta-step" data-eta-step="-5" aria-label="5 minutes less">−5</button>
        <input type="number" min="0" max="480" step="1" inputmode="numeric" value="${v}" data-eta-input aria-label="Minutes">
        <span class="eta-unit">min</span>
        <button type="button" class="eta-step" data-eta-step="5" aria-label="5 minutes more">+5</button>
        ${o.status === 'accepted' && o.ready_by ? `<span class="eta-ready">Ready by <strong>${clock(o.ready_by)}</strong></span>` : ''}
        ${o.status === 'accepted' ? '<button type="button" class="btn btn-small btn-quiet" data-eta-save>Update</button>' : ''}
      </div>`;
  }
  if (o.ready_by) return `<p class="eta-ready eta-past">⏱ Was due ${clock(o.ready_by)}</p>`;
  return '';
}

function readEta(card) {
  const input = card.querySelector('[data-eta-input]');
  if (!input || input.value === '') return null;
  const n = Math.round(Number(input.value));
  if (!Number.isFinite(n) || n < 0 || n > 480) throw new Error('Estimated time must be between 0 and 480 minutes.');
  return n;
}

async function onAction(ctx, e) {
  const step = e.target.closest('[data-eta-step]');
  if (step) {
    const input = step.closest('.eta-edit').querySelector('[data-eta-input]');
    input.value = Math.max(0, Math.min(480, (Number(input.value) || 0) + Number(step.dataset.etaStep)));
    return;
  }
  const saveEta = e.target.closest('[data-eta-save]');
  if (saveEta) {
    const card = saveEta.closest('.order-card');
    try {
      await api.setOrderEstimate(card.dataset.order, readEta(card));
      toast('Estimated time updated');
      api.notifyStatus(card.dataset.order).catch(() => {});
      refresh(ctx, false);
    } catch (err) { errorToast(err); }
    return;
  }
  const btn = e.target.closest('[data-status]');
  if (!btn) return;
  if (btn.dataset.status === 'cancelled' && !confirm('Cancel this order?')) return;
  btn.disabled = true;
  try {
    // Accepting locks in the (possibly edited) estimate first, so "ready by" is right.
    if (btn.dataset.status === 'accepted') {
      const card = btn.closest('.order-card');
      await api.setOrderEstimate(btn.dataset.id, readEta(card));
    }
    await api.setOrderStatus(btn.dataset.id, btn.dataset.status);
    toast(`${DOT[btn.dataset.status]} Order ${LABEL[btn.dataset.status].toLowerCase()}`);
    refresh(ctx, false);
    // E-mail the change in the background; tell staff only if it didn't go out.
    api.notifyStatus(btn.dataset.id).then((r) => {
      if (r?.sent) toast('Status e-mailed');
      else if (r?.reason && (!/activation/i.test(r.reason) || !activationWarned)) {
        if (/activation/i.test(r.reason)) activationWarned = true;
        toast(`Status saved. E-mail not sent: ${r.reason}`, 'error');
      }
    }).catch(() => {});
  } catch (err) {
    errorToast(err);
    btn.disabled = false;
  }
}
