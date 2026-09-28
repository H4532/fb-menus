// FB Menus — place-order Edge Function.
// Guest phone → POST {slug, location_type, location, name?, note?, lang?, items:[…]}
// 1. public.place_order() validates everything and recomputes prices (service role).
// 2. Responds to the guest immediately with the order number.
// 3. Sends the notification e-mail in the background (Resend if configured, else FormSubmit) and records the result.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const KNOWN = ['OUTLET_NOT_FOUND', 'ORDERING_CLOSED', 'LOCATION_REQUIRED', 'EMPTY_ORDER', 'RATE_LIMIT',
  'BAD_QTY', 'ITEM_NOT_FOUND', 'ITEM_UNAVAILABLE', 'OPTION_INVALID', 'OPTION_REQUIRED'];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METHOD' }, 405);

  const raw = await req.text();
  if (raw.length > 20000) return json({ error: 'BAD_REQUEST' }, 413);
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'BAD_REQUEST' }, 400); }

  const { data, error } = await admin.rpc('place_order', { p_payload: payload });
  if (error) {
    const [code, ...rest] = String(error.message || '').split(':');
    if (KNOWN.includes(code)) return json({ error: code, detail: rest.join(':') || null }, 422);
    console.error('place_order failed', error);
    return json({ error: 'BAD_REQUEST' }, 400);
  }

  // @ts-ignore EdgeRuntime is provided by Supabase
  EdgeRuntime.waitUntil(notify(data.id));
  return json({ order_no: data.order_no, subtotal: data.subtotal, item_count: data.item_count, id: data.id });
});

// ---------------------------------------------------------------------------
type L = Record<string, string>;
const en = (o: L | null | undefined) => (o?.en || o?.ar || Object.values(o || {})[0] || '') as string;
const ar = (o: L | null | undefined) => (o?.ar || '') as string;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const money = (n: unknown) => Number(n).toFixed(2);

async function notify(orderId: string) {
  const { data: n, error } = await admin.rpc('order_notification', { p_order_id: orderId });
  if (error || !n) { console.error('order_notification failed', error); return; }

  const record = (fields: Record<string, unknown>) => admin.from('orders').update(fields).eq('id', orderId);
  if (!n.notify_emails?.length) { await record({ notify_error: 'No notification e-mail set in admin Settings.' }); return; }

  const o = n.order;
  const where = o.location_type === 'room' ? `Room ${o.location}` : `Table ${o.location}`;
  const whereAr = o.location_type === 'room' ? `غرفة ${o.location}` : `طاولة ${o.location}`;
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: n.outlet.timezone, dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(o.created_at));
  const cur = n.outlet.currency;

  const rows = n.items.map((i: any) => {
    const opts = (i.options || []).map((x: any) =>
      `${esc(en(x.group))}: <b>${esc(en(x.option))}</b>${Number(x.price) > 0 && x.pricing === 'add' ? ` (+${money(x.price)})` : ''}`).join('<br>');
    return `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #e3ebe7;font-size:20px;font-weight:700;vertical-align:top;color:#B45309">${i.qty}×</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e3ebe7;vertical-align:top">
          <div style="font-size:16px;font-weight:700">${esc(en(i.name))}</div>
          ${ar(i.name) ? `<div dir="rtl" style="color:#5C6E64">${esc(ar(i.name))}</div>` : ''}
          ${opts ? `<div style="margin-top:4px;font-size:14px">${opts}</div>` : ''}
          ${i.note ? `<div style="margin-top:6px;padding:6px 8px;background:#FFF4D6;border-radius:6px;font-size:14px">📝 ${esc(i.note)}</div>` : ''}
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid #e3ebe7;text-align:right;vertical-align:top;white-space:nowrap">${money(i.line_total)}</td>
      </tr>`;
  }).join('');

  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#15241C">
    <div style="background:#D97706;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0">
      <div style="font-size:14px;opacity:.9">${esc(en(n.outlet.name))} · 🟡 New order</div>
      <div style="font-size:28px;font-weight:800;margin-top:4px">#${o.order_no} — ${esc(where)}</div>
      <div dir="rtl" style="font-size:16px;margin-top:2px">طلب جديد · ${esc(whereAr)}</div>
    </div>
    <div style="border:1px solid #d5e0da;border-top:0;padding:16px 20px;border-radius:0 0 12px 12px">
      <p style="margin:0 0 8px;color:#5C6E64">${esc(time)}${o.guest_name ? ` · Guest: <b style="color:#15241C">${esc(o.guest_name)}</b>` : ''}</p>
      ${o.guest_note ? `<p style="margin:0 0 12px;padding:8px 10px;background:#FFF4D6;border-radius:8px">📝 ${esc(o.guest_note)}</p>` : ''}
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#D97706;color:#fff">
          <th style="padding:8px;text-align:left;font-size:13px">Qty</th>
          <th style="padding:8px;text-align:left;font-size:13px">Item</th>
          <th style="padding:8px;text-align:right;font-size:13px">Amount</th>
        </tr></thead>${rows}
        <tr><td></td><td style="padding:12px 8px;font-weight:700">Total (${o.item_count} items, VAT incl.)</td>
            <td style="padding:12px 8px;text-align:right;font-weight:800;font-size:18px;white-space:nowrap">${esc(cur)} ${money(o.subtotal)}</td></tr>
      </table>
      ${n.admin_url ? `<p style="margin-top:16px"><a href="${esc(n.admin_url)}" style="background:#145A3C;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Open orders</a></p>` : ''}
      <p style="margin-top:16px;font-size:12px;color:#8a9a92">Prices recalculated by the server. Guests are not charged online — confirm the order with the table/room.</p>
    </div>
  </div>`;

  const text = [`New order #${o.order_no} — ${where}`, time, o.guest_name ? `Guest: ${o.guest_name}` : '',
    ...n.items.map((i: any) => `${i.qty}x ${en(i.name)}${(i.options || []).map((x: any) => ` / ${en(x.option)}`).join('')}${i.note ? ` — note: ${i.note}` : ''}  ${money(i.line_total)}`),
    o.guest_note ? `Order note: ${o.guest_note}` : '', `Total: ${cur} ${money(o.subtotal)}`, n.admin_url || ''].filter(Boolean).join('\n');

  const subject = `🟡 NEW · Order #${o.order_no} · ${where} · ${en(n.outlet.name)}`;
  try {
    if (n.resend_api_key) {
      // Preferred: Resend (HTML e-mail with status colours, needs an API key in private.app_settings).
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${n.resend_api_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: n.mail_from, to: n.notify_emails, subject, html, text }),
      });
      if (res.ok) await record({ notified_at: new Date().toISOString(), notify_error: null });
      else await record({ notify_error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` });
      return;
    }

    // Fallback: FormSubmit relay (no account; one-time activation link sent to the address).
    const [to, ...cc] = n.notify_emails;
    const items = n.items.map((i: any) => [
      `${i.qty} x ${en(i.name)}${ar(i.name) ? ` (${ar(i.name)})` : ''} = ${money(i.line_total)}`,
      ...(i.options || []).map((x: any) => `    - ${en(x.group)}: ${en(x.option)}`),
      i.note ? `    * Note: ${i.note}` : '',
    ].filter(Boolean).join('\n')).join('\n');
    const fields: Record<string, string> = {
      _subject: subject,
      _template: 'table',
      _captcha: 'false',
      'Status': '🟡 NEW  |  جديد',
      'Order': `#${o.order_no}`,
      'Where': `${where}  |  ${whereAr}`,
      'Time': time,
      'Items': items,
      'Total': `${cur} ${money(o.subtotal)} (${o.item_count} items, VAT incl.)`,
    };
    if (o.guest_name) fields['Guest'] = o.guest_name;
    if (o.guest_note) fields['Order note'] = o.guest_note;
    if (n.admin_url) fields['Open orders'] = n.admin_url;
    if (cc.length) fields._cc = cc.join(',');
    const site = (n.admin_url || 'https://h4532.github.io/fb-menus/admin/').replace(/admin\/.*$/, '');
    const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(to)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: new URL(site).origin, Referer: `${site}${n.outlet.slug}/` },
      body: JSON.stringify(fields),
    });
    const body = await res.json().catch(() => ({} as any));
    if (res.ok && String(body.success) === 'true') {
      await record({ notified_at: new Date().toISOString(), notify_error: null });
    } else if (/activat/i.test(body.message || '')) {
      await record({ notify_error: `Waiting for activation: open the FormSubmit e-mail sent to ${to} and click "Activate Form".` });
    } else {
      await record({ notify_error: `FormSubmit ${res.status}: ${String(body.message || '').slice(0, 250)}` });
    }
  } catch (e) {
    await record({ notify_error: `E-mail failed: ${String(e).slice(0, 300)}` });
  }
}
