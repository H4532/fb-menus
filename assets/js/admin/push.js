// FB Menus admin — order notifications on this device (Web Push).
import { SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY } from '../platform.js';
import { sb } from './api.js';

const SW_URL = new URL('../../../admin/sw.js', import.meta.url);
const SCOPE = new URL('../../../admin/', import.meta.url).pathname;

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function registration() {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.register(SW_URL, { scope: SCOPE });
}

function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** 'unsupported' | 'install-first' | 'denied' | 'off' | 'on' */
export async function state() {
  if (isIOS() && !isStandalone()) return 'install-first';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

function deviceName() {
  const ua = navigator.userAgent;
  const d = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'Device';
  const b = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : 'Safari';
  return `${d} · ${b}${isStandalone() ? ' (app)' : ''}`;
}

/** Must be called from a tap (browsers require a user gesture). */
export async function enable(outletId, userId) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed. Allow them in the phone settings for this app, then try again.');
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert({
    outlet_id: outletId, user_id: userId, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
    device: deviceName(), last_seen_at: new Date().toISOString(),
  }, { onConflict: 'outlet_id,endpoint' });
  if (error) throw error;
  await sb.from('activity_log').insert({ outlet_id: outletId, user_id: userId, action: 'device_registered', device: deviceName() }).select().maybeSingle().catch(() => {});
}

export async function disable() {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

export async function sendTest(outletId) {
  const session = (await sb.auth.getSession()).data.session;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session?.access_token || ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'test', outlet_id: outletId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Test failed (${res.status})`);
  if (!data.sent) throw new Error(data.errors?.[0] || 'The push service did not accept the test.');
  return data;
}
