// FB Menus — manage-users Edge Function (staff accounts and rights per outlet).
// Caller must be an owner, or have the "users" right, on that outlet.
// Only owners can create/modify owners or grant the "users" right.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (message: string, status = 400) => json({ error: message }, status);

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PERMS = ['orders', 'dishes', 'menus', 'settings', 'users'];
const ROLES = ['owner', 'manager', 'editor', 'staff', 'custom'];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function log(outletId: string, actorId: string, actorEmail: string, action: string, detail: Record<string, unknown> = {}) {
  await admin.from('activity_log').insert({ outlet_id: outletId, user_id: actorId, actor_email: actorEmail, action, detail });
}

function normalise(role: string, permissions: unknown) {
  if (!ROLES.includes(role)) throw new Error('Unknown role.');
  if (role === 'owner') return PERMS;
  const list = Array.isArray(permissions) ? permissions.filter((p) => PERMS.includes(String(p))) : [];
  if (!list.length) throw new Error('Give this user at least one right.');
  return [...new Set(list as string[])];
}

async function findUserByEmail(email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email || '').toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('Method not allowed', 405);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: who } = await admin.auth.getUser(token);
  const me = who?.user;
  if (!me) return fail('Please sign in again.', 401);

  let b: any;
  try { b = await req.json(); } catch { return fail('Bad request'); }
  const outletId = String(b.outlet_id || '');

  const { data: mine } = await admin.from('outlet_admins').select('role, permissions')
    .eq('outlet_id', outletId).eq('user_id', me.id).maybeSingle();
  if (!mine) return fail('You don’t have access to this restaurant.', 403);
  const iAmOwner = mine.role === 'owner';
  if (!iAmOwner && !(mine.permissions || []).includes('users')) return fail('You don’t have the Users right.', 403);

  const team = async () => (await admin.from('outlet_admins').select('*').eq('outlet_id', outletId)).data || [];
  const ownersCount = async () => (await team()).filter((r: any) => r.role === 'owner').length;

  try {
    // ------------------------------------------------------------------ list
    if (b.action === 'list') {
      const rows = await team();
      const users = await Promise.all(rows.map(async (r: any) => {
        const { data } = await admin.auth.admin.getUserById(r.user_id);
        return {
          user_id: r.user_id, role: r.role, permissions: r.role === 'owner' ? PERMS : r.permissions,
          display_name: r.display_name, added_at: r.created_at,
          email: data?.user?.email || '(deleted account)', last_sign_in_at: data?.user?.last_sign_in_at || null,
          is_me: r.user_id === me.id,
        };
      }));
      users.sort((a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || a.email.localeCompare(b.email));
      return json({ users, i_am_owner: iAmOwner });
    }

    // ---------------------------------------------------------------- create
    if (b.action === 'create') {
      const email = String(b.email || '').trim().toLowerCase();
      if (!EMAIL.test(email)) return fail('Enter a valid e-mail address.');
      const role = String(b.role || 'staff');
      const permissions = normalise(role, b.permissions);
      if (!iAmOwner && (role === 'owner' || permissions.includes('users'))) return fail('Only an owner can give owner or Users rights.', 403);
      const name = String(b.display_name || '').trim().slice(0, 60) || null;

      let user = await findUserByEmail(email);
      let created = false;
      if (!user) {
        const password = String(b.password || '');
        if (password.length < 10) return fail('The temporary password must have at least 10 characters.');
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } });
        if (error) return fail(error.message);
        user = data.user;
        created = true;
      }
      const { error } = await admin.from('outlet_admins').insert({ outlet_id: outletId, user_id: user!.id, role, permissions, display_name: name });
      if (error) return fail(/duplicate/i.test(error.message) ? 'This person already has access.' : error.message);
      await log(outletId, me.id, me.email || '', 'user_created', { email, role, permissions, created_account: created });
      return json({ ok: true, created, note: created ? null : 'This e-mail already had an account, so it keeps its existing password.' });
    }

    // ---------------------------------------------------------------- devices
    if (b.action === 'devices') {
      const { data: rows } = await admin.from('push_subscriptions').select('*').eq('outlet_id', outletId).order('last_seen_at', { ascending: false });
      const users = Object.fromEntries((await team()).map((r: any) => [r.user_id, r]));
      const withEmail = await Promise.all((rows || []).map(async (d: any) => {
        const { data } = await admin.auth.admin.getUserById(d.user_id);
        return {
          id: d.id, device: d.device || 'Unknown device', user_id: d.user_id,
          email: data?.user?.email || '(deleted account)',
          display_name: users[d.user_id]?.display_name || null,
          created_at: d.created_at, last_ok_at: d.last_ok_at, last_seen_at: d.last_seen_at,
        };
      }));
      return json({ devices: withEmail });
    }
    if (b.action === 'remove_device') {
      const { data: dev } = await admin.from('push_subscriptions').select('user_id, device').eq('id', String(b.device_id || '')).eq('outlet_id', outletId).maybeSingle();
      if (!dev) return fail('Device not found.', 404);
      if (dev.user_id !== me.id && !iAmOwner && !(mine.permissions || []).includes('users')) return fail('You can only remove your own devices.', 403);
      await admin.from('push_subscriptions').delete().eq('id', String(b.device_id || ''));
      const { data: du } = await admin.auth.admin.getUserById(dev.user_id);
      await log(outletId, me.id, me.email || '', 'device_removed', { email: du?.user?.email, device: dev.device });
      return json({ ok: true });
    }

    // ------------------------------------------------------------------- log
    if (b.action === 'log') {
      const { data: rows, error } = await admin.from('activity_log').select('*').eq('outlet_id', outletId)
        .order('created_at', { ascending: false }).limit(Math.min(200, Number(b.limit) || 100));
      if (error) return fail(error.message);
      return json({ entries: rows || [] });
    }

    // Everything below targets an existing member.
    const targetId = String(b.user_id || '');
    const { data: target } = await admin.from('outlet_admins').select('*').eq('outlet_id', outletId).eq('user_id', targetId).maybeSingle();
    if (!target) return fail('User not found.', 404);
    if (target.role === 'owner' && !iAmOwner) return fail('Only an owner can change another owner.', 403);

    // ---------------------------------------------------------------- update
    if (b.action === 'update') {
      const role = String(b.role || target.role);
      const permissions = normalise(role, b.permissions);
      if (!iAmOwner && (role === 'owner' || permissions.includes('users'))) return fail('Only an owner can give owner or Users rights.', 403);
      if (target.role === 'owner' && role !== 'owner' && (await ownersCount()) <= 1) return fail('Keep at least one owner.');
      const name = b.display_name === undefined ? target.display_name : (String(b.display_name).trim().slice(0, 60) || null);
      const { error } = await admin.from('outlet_admins').update({ role, permissions, display_name: name })
        .eq('outlet_id', outletId).eq('user_id', targetId);
      if (error) return fail(error.message);
      const { data: targetUser } = await admin.auth.admin.getUserById(targetId);
      await log(outletId, me.id, me.email || '', 'user_rights_changed', { email: targetUser?.user?.email, from_role: target.role, to_role: role, permissions });
      return json({ ok: true });
    }

    // -------------------------------------------------------------- password
    if (b.action === 'password') {
      const password = String(b.password || '');
      if (password.length < 10) return fail('The password must have at least 10 characters.');
      const { error } = await admin.auth.admin.updateUserById(targetId, { password });
      if (error) return fail(error.message);
      const { data: targetUser } = await admin.auth.admin.getUserById(targetId);
      await log(outletId, me.id, me.email || '', 'password_reset', { email: targetUser?.user?.email });
      return json({ ok: true });
    }

    // ---------------------------------------------------------------- remove
    if (b.action === 'remove') {
      if (targetId === me.id) return fail('You can’t remove yourself.');
      if (target.role === 'owner' && (await ownersCount()) <= 1) return fail('Keep at least one owner.');
      await admin.from('outlet_admins').delete().eq('outlet_id', outletId).eq('user_id', targetId);
      await admin.from('push_subscriptions').delete().eq('outlet_id', outletId).eq('user_id', targetId);
      const { data: targetUser } = await admin.auth.admin.getUserById(targetId);
      await log(outletId, me.id, me.email || '', 'user_removed', { email: targetUser?.user?.email });
      // Delete the login entirely if it has no access to any other outlet.
      const { count } = await admin.from('outlet_admins').select('*', { count: 'exact', head: true }).eq('user_id', targetId);
      if (!count) await admin.auth.admin.deleteUser(targetId);
      return json({ ok: true, account_deleted: !count });
    }

    return fail('Unknown action.');
  } catch (e) {
    return fail(String((e as Error)?.message || e));
  }
});
