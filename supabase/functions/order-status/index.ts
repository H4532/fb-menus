// FB Menus — order-status Edge Function.
// Called by the admin panel after staff change an order's status.
// Verifies the caller is an admin of that outlet, then e-mails the status
// change (Resend if configured, else FormSubmit) with a colour per status.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// One palette everywhere (admin, guest phone, e-mail).
const STATUS: Record<string, { en: string; ar: string; dot: string; color: string; bg: string }> = {
  new:       { en: 'New',       ar: 'جديد',         dot: '🟡', color: '#B45309', bg: '#FEF3C7' },
  accepted:  { en: 'Accepted',  ar: 'قيد التحضير',  dot: '🔵', color: '#1D4ED8', bg: '#DBEAFE' },
  ready:     { en: 'Ready',     ar: 'جاهز',         dot: '🟢', color: '#15803D', bg: '#DCFCE7' },
  served:    { en: 'Served',    ar: 'تم التقديم',   dot: '⚪', color: '#475569', bg: '#E2E8F0' },
  cancelled: { en: 'Cancelled', ar: 'ملغى',         dot: '🔴', color: '#B91C1C', bg: '#FEE2E2' },
};

type L = Record<string, string>;
const en = (o: L | null | undefined) => (o?.en || o?.ar || Object.values(o || {})[0] || '') as string;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const money = (n: unknown) => Number(n).toFixed(2);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METHOD' }, 405);

  // 1. Who is calling?
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: userData } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (!user) return json({ error: 'UNAUTHORIZED' }, 401);

  let orderId = '';
  try { orderId = String((await req.json()).order_id || ''); } catch { /* handled below */ }
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({ error: 'BAD_REQUEST' }, 400);

  // 2. Is the caller an admin of this order's outlet?
  const { data: row } = await admin.from('orders').select('outlet_id').eq('id', orderId).maybeSingle();
  if (!row) return json({ error: 'NOT_FOUND' }, 404);
  const { data: member } = await admin.from('outlet_admins').select('role')
    .eq('outlet_id', row.outlet_id).eq('user_id', user.id).maybeSingle();
  if (!member) return json({ error: 'FORBIDDEN' }, 403);

  // 3. Build and send the e-mail.
  const { data: n, error } = await admin.rpc('order_notification', { p_order_id: orderId });
  if (error || !n) return json({ sent: false, reason: 'Order not found.' });
  if (!n.notify_emails?.length) return json({ sent: false, reason: 'No notification e-mail set in Settings.' });

  const o = n.order;
  const st = STATUS[o.status] || STATUS.new;
  const where = o.location_type === 'room' ? `Room ${o.location}` : `Table ${o.location}`;
  const tz = n.outlet.timezone;
  const hhmm = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const timeline = (o.status_history || []).map((h: any) => `${(STATUS[h.status] || st).dot} ${(STATUS[h.status] || st).en} ${hhmm(h.at)}`).join('  →  ');
  const itemsText = n.items.map((i: any) => `${i.qty} x ${en(i.name)}${(i.options || []).length ? ` (${i.options.map((x: any) => en(x.option)).join(', ')})` : ''}`).join('\n');
  const subject = `${st.dot} ${st.en.toUpperCase()} · Order #${o.order_no} · ${where} · ${en(n.outlet.name)}`;

  try {
    if (n.resend_api_key) {
      const html = `
      <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#15241C">
        <div style="background:${st.color};color:#fff;padding:18px 20px;border-radius:12px 12px 0 0">
          <div style="font-size:14px;opacity:.9">${esc(en(n.outlet.name))} · Order #${o.order_no} · ${esc(where)}</div>
          <div style="font-size:30px;font-weight:800;margin-top:4px">${st.dot} ${esc(st.en)}</div>
          <div dir="rtl" style="font-size:16px">${esc(st.ar)}</div>
        </div>
        <div style="border:1px solid #d5e0da;border-top:0;padding:16px 20px;border-radius:0 0 12px 12px;background:#fff">
          <p style="margin:0 0 12px;padding:8px 10px;background:${st.bg};color:${st.color};border-radius:8px;font-weight:600">${esc(timeline)}</p>
          <table style="width:100%;border-collapse:collapse;margin:0 0 12px">
            <thead><tr style="background:${st.color};color:#fff">
              <th style="padding:8px;text-align:left;font-size:13px">Qty</th>
              <th style="padding:8px;text-align:left;font-size:13px">Item</th>
              <th style="padding:8px;text-align:right;font-size:13px">Amount</th>
            </tr></thead>
            <tbody>${n.items.map((i: any) => `
              <tr style="background:${st.bg}">
                <td style="padding:8px;border-bottom:1px solid #fff;font-weight:700;color:${st.color}">${i.qty}×</td>
                <td style="padding:8px;border-bottom:1px solid #fff">${esc(en(i.name))}${(i.options || []).length ? `<div style="font-size:13px;color:#5C6E64">${i.options.map((x: any) => esc(en(x.option))).join(', ')}</div>` : ''}${i.note ? `<div style="font-size:13px">📝 ${esc(i.note)}</div>` : ''}</td>
                <td style="padding:8px;border-bottom:1px solid #fff;text-align:right;white-space:nowrap">${money(i.line_total)}</td>
              </tr>`).join('')}
              <tr><td></td><td style="padding:10px 8px;font-weight:700">Total</td>
                  <td style="padding:10px 8px;text-align:right;font-weight:800;white-space:nowrap">${esc(n.outlet.currency)} ${money(o.subtotal)}</td></tr>
            </tbody>
          </table>
          ${n.admin_url ? `<p style="margin-top:16px"><a href="${esc(n.admin_url)}" style="background:#145A3C;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Open orders</a></p>` : ''}
        </div>
      </div>`;
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${n.resend_api_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: n.mail_from, to: n.notify_emails, subject, html, text: `${subject}\n${timeline}\n\n${itemsText}` }),
      });
      return res.ok ? json({ sent: true }) : json({ sent: false, reason: `Resend ${res.status}` });
    }

    const [to, ...cc] = n.notify_emails;
    const fields: Record<string, string> = {
      _subject: subject,
      _template: 'table',
      _captcha: 'false',
      'Status': `${st.dot} ${st.en.toUpperCase()}  |  ${st.ar}`,
      'Order': `#${o.order_no}`,
      'Where': where,
      'Timeline': timeline,
      'Items': itemsText,
      'Total': `${n.outlet.currency} ${money(o.subtotal)}`,
      'Changed by': user.email || '',
    };
    if (n.admin_url) fields['Open orders'] = n.admin_url;
    if (cc.length) fields._cc = cc.join(',');
    const site = (n.admin_url || 'https://h4532.github.io/fb-menus/admin/').replace(/admin\/.*$/, '');
    const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(to)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: new URL(site).origin, Referer: `${site}${n.outlet.slug}/` },
      body: JSON.stringify(fields),
    });
    const body = await res.json().catch(() => ({} as any));
    if (res.ok && String(body.success) === 'true') return json({ sent: true });
    if (/activat/i.test(body.message || '')) return json({ sent: false, reason: `Waiting for activation: click “Activate Form” in the FormSubmit e-mail sent to ${to}.` });
    return json({ sent: false, reason: `FormSubmit: ${String(body.message || res.status).slice(0, 200)}` });
  } catch (e) {
    return json({ sent: false, reason: `E-mail failed: ${String(e).slice(0, 200)}` });
  }
});
