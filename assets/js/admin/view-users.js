// FB Menus admin — Users: staff accounts and their rights on this outlet.
import { esc } from '../core/i18n.js';
import * as api from './api.js';
import { $, $$, toast, errorToast, openDialog, confirmDialog, field } from './ui.js';

export const RIGHTS = [
  ['orders',   'Orders',            'See and handle guest orders, estimated times'],
  ['dishes',   'Dishes',            'Prices, sold out, photos, allergens, preparation time'],
  ['menus',    'Menus & choices',   'Menus, sections, serving hours, buffet prices, sizes and add-ons'],
  ['settings', 'Settings',          'Restaurant details, ordering on/off, notification e-mails'],
  ['users',    'Users',             'Add and manage staff accounts'],
];
export const ROLES = {
  owner:   { label: 'Owner',       perms: ['orders', 'dishes', 'menus', 'settings', 'users'], hint: 'Everything, including other owners' },
  manager: { label: 'Manager',     perms: ['orders', 'dishes', 'menus', 'settings'],          hint: 'Everything except user management' },
  editor:  { label: 'Menu editor', perms: ['dishes', 'menus'],                                hint: 'Dishes, menus and choices' },
  staff:   { label: 'Order staff', perms: ['orders'],                                         hint: 'Waiters and kitchen: orders only' },
  custom:  { label: 'Custom',      perms: null,                                               hint: 'Pick the rights below' },
};

let data = { users: [], i_am_owner: false };

const since = (iso) => {
  if (!iso) return 'Never signed in';
  const d = new Date(iso);
  return `Last sign-in ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

function makePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `${[...bytes].map((b) => chars[b % chars.length]).join('')}!7`;
}

export async function renderUsers(ctx) {
  const root = $('#view');
  root.innerHTML = `
    <div class="view-head">
      <h1>Users</h1>
      <button type="button" class="btn btn-primary" data-add-user>+ Add user</button>
    </div>
    <p class="hint">Each person signs in with their own e-mail and password. Rights decide which tabs they see and what they can change.</p>
    <div id="users-list"><div class="loading"><span class="spinner"></span></div></div>

    <div class="view-head" style="margin-top:1.5rem"><h2 class="block-title2">Devices</h2></div>
    <p class="hint">Phones and computers registered for order notifications. A device disappears here automatically once it fails to receive a few notifications in a row (e.g. the app was removed).</p>
    <div id="devices-list"><div class="loading"><span class="spinner"></span></div></div>

    <div class="view-head" style="margin-top:1.5rem"><h2 class="block-title2">Activity log</h2></div>
    <p class="hint">Sign-ins, account changes and device registrations for this restaurant.</p>
    <div id="log-list"><div class="loading"><span class="spinner"></span></div></div>

    <section class="block rights-help">
      <h2 class="block-title">Rights</h2>
      <ul class="rights-list">${RIGHTS.map(([k, l, h]) => `<li><strong>${l}</strong> — ${h}</li>`).join('')}</ul>
    </section>`;
  $('[data-add-user]', root).addEventListener('click', () => editUser(ctx, null));
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-u-act]');
    if (!b) return;
    const u = data.users.find((x) => x.user_id === b.dataset.uid);
    if (b.dataset.uAct === 'edit') editUser(ctx, u);
    if (b.dataset.uAct === 'password') resetPassword(ctx, u);
    if (b.dataset.uAct === 'remove') removeUser(ctx, u);
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dev-remove]');
    if (b) removeDevice(ctx, b.dataset.devRemove);
  });
  await load(ctx);
  await loadDevices(ctx);
  await loadLog(ctx);
}

async function load(ctx) {
  try {
    data = await api.manageUsers('list', ctx.outlet.id);
  } catch (err) {
    errorToast(err);
    $('#users-list').innerHTML = `<div class="empty"><p>${esc(err.message)}</p></div>`;
    return;
  }
  $('#users-list').innerHTML = `<div class="user-grid">${data.users.map((u) => card(u)).join('')}</div>`;
}

function card(u) {
  const role = ROLES[u.role] || ROLES.custom;
  const canTouch = data.i_am_owner || u.role !== 'owner';
  return `
    <article class="user-card role-${u.role}">
      <header>
        <div class="user-avatar" aria-hidden="true">${esc((u.display_name || u.email).slice(0, 1).toUpperCase())}</div>
        <div class="user-id">
          <strong>${esc(u.display_name || u.email.split('@')[0])}${u.is_me ? ' <span class="tag">You</span>' : ''}</strong>
          <span class="nm-sub">${esc(u.email)}</span>
        </div>
        <span class="role-badge">${esc(role.label)}</span>
      </header>
      <div class="user-rights">
        ${RIGHTS.map(([k, l]) => `<span class="right ${u.permissions.includes(k) ? 'on' : 'off'}">${u.permissions.includes(k) ? '✓' : '✕'} ${l}</span>`).join('')}
      </div>
      <p class="hint">${esc(since(u.last_sign_in_at))}</p>
      ${canTouch ? `
        <footer class="user-actions">
          <button type="button" class="btn btn-small btn-quiet" data-u-act="edit" data-uid="${u.user_id}">Edit rights</button>
          <button type="button" class="btn btn-small btn-quiet" data-u-act="password" data-uid="${u.user_id}">Set password</button>
          ${u.is_me ? '' : `<button type="button" class="btn btn-small btn-danger-quiet" data-u-act="remove" data-uid="${u.user_id}">Remove</button>`}
        </footer>` : '<p class="hint">Only an owner can change an owner.</p>'}
    </article>`;
}

function rightsForm(u, isNew) {
  const role = u?.role || 'staff';
  const perms = u?.permissions || ROLES.staff.perms;
  const ownerOnly = !data.i_am_owner;
  return `
    <div class="form-grid">
      ${isNew ? field('E-mail', '<input type="email" name="email" required autocomplete="off" placeholder="name@hotel.com">') : `<p><strong>${esc(u.email)}</strong></p>`}
      ${field('Name (optional)', `<input name="display_name" maxlength="60" value="${esc(u?.display_name || '')}" placeholder="e.g. Ahmed – Head waiter">`)}
      ${isNew ? field('Temporary password', `<div class="pw-row"><input name="password" value="${makePassword()}" minlength="10" autocomplete="off"><button type="button" class="btn btn-small btn-quiet" data-gen>New</button></div>`, 'Give it to the person; they change it after signing in (account icon → Change password). Ignored if the e-mail already has an account.') : ''}
      <fieldset class="field-group">
        <legend>Role</legend>
        <div class="role-pick">
          ${Object.entries(ROLES).map(([k, r]) => `
            <label class="role-opt">
              <input type="radio" name="role" value="${k}" ${k === role ? 'checked' : ''} ${ownerOnly && k === 'owner' ? 'disabled' : ''}>
              <span><strong>${r.label}</strong><small>${r.hint}</small></span>
            </label>`).join('')}
        </div>
      </fieldset>
      <fieldset class="field-group">
        <legend>Rights</legend>
        <div class="rights-pick">
          ${RIGHTS.map(([k, l, h]) => `
            <label class="switch-row">
              <span><span class="field-label">${l}</span><span class="hint">${h}</span></span>
              <input type="checkbox" class="switch" name="perm" value="${k}" ${perms.includes(k) ? 'checked' : ''} ${ownerOnly && k === 'users' ? 'disabled' : ''}>
            </label>`).join('')}
        </div>
      </fieldset>
    </div>`;
}

function wireRights(dlg) {
  const radios = $$('input[name=role]', dlg);
  const boxes = $$('input[name=perm]', dlg);
  const syncFromRole = () => {
    const role = radios.find((r) => r.checked)?.value;
    const preset = ROLES[role]?.perms;
    if (preset) boxes.forEach((b) => { b.checked = preset.includes(b.value); });
    boxes.forEach((b) => { b.disabled = role === 'owner' || (!data.i_am_owner && b.value === 'users'); });
  };
  radios.forEach((r) => r.addEventListener('change', syncFromRole));
  boxes.forEach((b) => b.addEventListener('change', () => {
    const chosen = boxes.filter((x) => x.checked).map((x) => x.value).sort().join(',');
    const match = Object.entries(ROLES).find(([k, r]) => k !== 'owner' && r.perms && [...r.perms].sort().join(',') === chosen);
    const target = match ? match[0] : 'custom';
    radios.forEach((r) => { r.checked = r.value === target; });
  }));
  $('[data-gen]', dlg)?.addEventListener('click', () => { $('[name=password]', dlg).value = makePassword(); });
  syncFromRole();
}

const readRights = (form) => ({
  role: $$('input[name=role]', form).find((r) => r.checked)?.value || 'custom',
  permissions: $$('input[name=perm]', form).filter((b) => b.checked).map((b) => b.value),
  display_name: form.elements.display_name.value.trim(),
});

async function editUser(ctx, u) {
  const isNew = !u;
  let tempPassword = '';
  const done = await openDialog({
    title: isNew ? 'Add user' : 'Edit rights',
    body: rightsForm(u, isNew),
    submitLabel: isNew ? 'Add user' : 'Save rights',
    onOpen: wireRights,
    onSubmit: async (form) => {
      const r = readRights(form);
      if (r.role !== 'owner' && !r.permissions.length) throw new Error('Tick at least one right.');
      if (isNew) {
        tempPassword = form.elements.password.value;
        const res = await api.manageUsers('create', ctx.outlet.id, { ...r, email: form.elements.email.value.trim(), password: tempPassword });
        if (!res.created) { tempPassword = ''; if (res.note) toast(res.note); }
      } else {
        await api.manageUsers('update', ctx.outlet.id, { ...r, user_id: u.user_id });
      }
    },
  });
  if (!done) return;
  toast(isNew ? 'User added' : 'Rights saved');
  if (isNew && tempPassword) showCredentials(done.elements?.email?.value || '', tempPassword);
  load(ctx);
}

function showCredentials(email, password) {
  const url = new URL('./', location.href).href;
  openDialog({
    title: 'Share these sign-in details',
    submitLabel: 'Done',
    body: `
      <p>Send these to the new user. They should change the password after signing in.</p>
      <pre class="cred">Admin: ${esc(url)}\nE-mail: ${esc(email)}\nPassword: ${esc(password)}</pre>
      <button type="button" class="btn btn-small btn-quiet" data-copy>Copy</button>`,
    onOpen: (dlg) => $('[data-copy]', dlg).addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('.cred', dlg).textContent); toast('Copied'); } catch { toast('Select the text and copy it.', 'error'); }
    }),
  });
}

async function resetPassword(ctx, u) {
  let pw = makePassword();
  const done = await openDialog({
    title: `Set password — ${u.display_name || u.email}`,
    submitLabel: 'Set password',
    body: field('New password', `<div class="pw-row"><input name="password" value="${pw}" minlength="10" autocomplete="off" required><button type="button" class="btn btn-small btn-quiet" data-gen>New</button></div>`, 'At least 10 characters. Share it with the user.'),
    onOpen: (dlg) => $('[data-gen]', dlg).addEventListener('click', () => { $('[name=password]', dlg).value = makePassword(); }),
    onSubmit: async (form) => {
      pw = form.elements.password.value;
      await api.manageUsers('password', ctx.outlet.id, { user_id: u.user_id, password: pw });
    },
  });
  if (done) { toast('Password set'); showCredentials(u.email, pw); }
}

async function removeUser(ctx, u) {
  if (!(await confirmDialog(`Remove ${u.display_name || u.email}? They will no longer be able to sign in to this restaurant.`, 'Remove'))) return;
  try {
    await api.manageUsers('remove', ctx.outlet.id, { user_id: u.user_id });
    data.users = data.users.filter((x) => x.user_id !== u.user_id);
    document.querySelector(`[data-u-act="remove"][data-uid="${u.user_id}"]`)?.closest('.user-card')?.remove();
    toast('User removed');
    load(ctx);
  } catch (err) { errorToast(err); }
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------
const sinceText = (iso) => {
  if (!iso) return 'Never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
};

async function loadDevices(ctx) {
  const host = $('#devices-list');
  if (!host) return;
  let devices = [];
  try {
    ({ devices } = await api.manageUsers('devices', ctx.outlet.id));
  } catch (err) {
    host.innerHTML = `<div class="empty"><p>${esc(err.message)}</p></div>`;
    return;
  }
  host.innerHTML = devices.length ? `
    <ul class="rows" role="list">
      ${devices.map((d) => `
        <li class="row">
          <button type="button" class="row-name" disabled style="cursor:default">
            <span class="nm">${esc(d.device)}</span>
            <span class="nm-sub">${esc(d.display_name || d.email)}</span>
            <span class="row-flags">
              <span class="tag ${d.last_ok_at ? '' : 'tag-warn'}">${d.last_ok_at ? `Notified ${esc(sinceText(d.last_ok_at))}` : 'Not notified yet'}</span>
              <span class="tag">Registered ${esc(sinceText(d.created_at))}</span>
            </span>
          </button>
          <button type="button" class="btn btn-small btn-danger-quiet" data-dev-remove="${d.id}">Remove</button>
        </li>`).join('')}
    </ul>` : '<div class="empty"><p>No devices registered yet. Each person turns notifications on from the Orders tab.</p></div>';
}

async function removeDevice(ctx, id) {
  if (!(await confirmDialog('Remove this device? It will stop receiving order notifications.', 'Remove'))) return;
  try {
    await api.manageUsers('remove_device', ctx.outlet.id, { device_id: id });
    toast('Device removed');
    loadDevices(ctx);
    loadLog(ctx);
  } catch (err) { errorToast(err); }
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------
const LOG_LABEL = {
  sign_in: (e) => `signed in`,
  user_created: (e) => `added <strong>${esc(e.detail.email || '')}</strong> as ${esc(e.detail.role || '')}${e.detail.created_account === false ? ' (existing account)' : ''}`,
  user_rights_changed: (e) => `changed <strong>${esc(e.detail.email || '')}</strong> from ${esc(e.detail.from_role)} to ${esc(e.detail.to_role)}`,
  user_removed: (e) => `removed <strong>${esc(e.detail.email || '')}</strong>`,
  password_reset: (e) => `set a new password for <strong>${esc(e.detail.email || '')}</strong>`,
  device_registered: (e) => `turned on notifications on ${esc(e.device || 'a device')}`,
  device_removed: (e) => `removed the device “${esc(e.detail.device || '')}” for <strong>${esc(e.detail.email || '')}</strong>`,
};

async function loadLog(ctx) {
  const host = $('#log-list');
  if (!host) return;
  let entries = [];
  try {
    ({ entries } = await api.manageUsers('log', ctx.outlet.id, { limit: 100 }));
  } catch (err) {
    host.innerHTML = `<div class="empty"><p>${esc(err.message)}</p></div>`;
    return;
  }
  host.innerHTML = entries.length ? `
    <ul class="log-list" role="list">
      ${entries.map((e) => `
        <li class="log-row">
          <span class="log-time">${esc(new Date(e.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span>
          <span class="log-text"><strong>${esc(e.actor_email || 'Someone')}</strong> ${LOG_LABEL[e.action] ? LOG_LABEL[e.action](e) : esc(e.action)}</span>
        </li>`).join('')}
    </ul>` : '<div class="empty"><p>No activity yet.</p></div>';
}
