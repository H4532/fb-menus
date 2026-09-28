// FB Menus admin — small UI toolkit: toasts, dialogs, form fields.
import { esc } from '../core/i18n.js';
import { LANG_NAMES, RTL_LANGS } from '../core/strings.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
export function toast(message, kind = 'ok') {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  host.append(el);
  setTimeout(() => el.classList.add('is-leaving'), kind === 'error' ? 6000 : 2600);
  setTimeout(() => el.remove(), kind === 'error' ? 6400 : 3000);
}

export function errorToast(err, fallback = 'Something went wrong.') {
  console.error(err);
  const msg = err?.message || fallback;
  toast(humanError(msg), 'error');
}

function humanError(msg) {
  if (/row-level security|permission denied/i.test(msg)) return 'You don’t have permission to change this.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'No connection. Check the Wi-Fi and try again.';
  if (/duplicate key/i.test(msg)) return 'That name or code is already used. Choose another.';
  if (/Invalid login credentials/i.test(msg)) return 'Email or password is incorrect.';
  return msg;
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------
/**
 * Opens a modal with `html` inside a <form>. Resolves with the form element
 * when the primary button is pressed and `onSubmit` returns without throwing,
 * or null when cancelled.
 */
export function openDialog({ title, body, submitLabel = 'Save', danger = null, wide = false, onSubmit, onOpen }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = `dlg${wide ? ' dlg-wide' : ''}`;
    dlg.innerHTML = `
      <form method="dialog" class="dlg-form" novalidate>
        <header class="dlg-head">
          <h2>${esc(title)}</h2>
          <button type="button" class="icon-btn" data-cancel aria-label="Close">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </header>
        <div class="dlg-body">${body}</div>
        <footer class="dlg-foot">
          ${danger ? `<button type="button" class="btn btn-danger-quiet" data-danger>${esc(danger.label)}</button>` : '<span></span>'}
          <div class="dlg-actions">
            <button type="button" class="btn btn-quiet" data-cancel>Cancel</button>
            <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
          </div>
        </footer>
      </form>`;
    document.body.append(dlg);
    const form = $('form', dlg);
    let done = false;

    const finish = (value) => {
      if (done) return;
      done = true;
      dlg.close();
      dlg.remove();
      resolve(value);
    };

    $$('[data-cancel]', dlg).forEach((b) => b.addEventListener('click', () => finish(null)));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const firstInvalid = $$('[required]', form).find((el) => !String(el.value).trim());
      if (firstInvalid) {
        firstInvalid.focus();
        firstInvalid.classList.add('is-invalid');
        toast('Fill in the highlighted field.', 'error');
        return;
      }
      const submit = $('button[type=submit]', form);
      submit.disabled = true;
      submit.classList.add('is-busy');
      try {
        if (onSubmit) await onSubmit(form);
        finish(form);
      } catch (err) {
        errorToast(err);
      } finally {
        submit.disabled = false;
        submit.classList.remove('is-busy');
      }
    });

    if (danger) {
      $('[data-danger]', dlg).addEventListener('click', async () => {
        if (!(await confirmDialog(danger.confirm, danger.label))) return;
        try {
          await danger.action();
          finish(null);
        } catch (err) {
          errorToast(err);
        }
      });
    }

    dlg.showModal();
    onOpen?.(dlg);
    const first = $('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select', dlg);
    first?.focus();
  });
}

export function confirmDialog(message, confirmLabel = 'Delete') {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg dlg-confirm';
    dlg.innerHTML = `
      <div class="dlg-body"><p>${esc(message)}</p></div>
      <footer class="dlg-foot">
        <span></span>
        <div class="dlg-actions">
          <button type="button" class="btn btn-quiet" data-no>Cancel</button>
          <button type="button" class="btn btn-danger" data-yes>${esc(confirmLabel)}</button>
        </div>
      </footer>`;
    document.body.append(dlg);
    const end = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    $('[data-no]', dlg).addEventListener('click', () => end(false));
    $('[data-yes]', dlg).addEventListener('click', () => end(true));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); end(false); });
    dlg.showModal();
    $('[data-no]', dlg).focus();
  });
}

// ---------------------------------------------------------------------------
// Form field builders
// ---------------------------------------------------------------------------
let uid = 0;
const nextId = (p = 'f') => `${p}-${++uid}`;

/** One input per outlet language for a jsonb text field. */
export function langFields(name, label, value = {}, langs, { textarea = false, required = [], hint = '' } = {}) {
  return `
    <fieldset class="field-group">
      <legend>${esc(label)}</legend>
      ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}
      <div class="lang-fields">
        ${langs.map((l) => {
          const id = nextId(name);
          const dir = RTL_LANGS.includes(l) ? 'rtl' : 'ltr';
          const req = required.includes(l) ? 'required' : '';
          const v = esc(value?.[l] ?? '');
          return `
            <label class="field" for="${id}">
              <span class="field-label">${esc(LANG_NAMES[l] || l)}${req ? ' <em>required</em>' : ''}</span>
              ${textarea
                ? `<textarea id="${id}" name="${name}.${l}" dir="${dir}" lang="${l}" rows="3" ${req}>${v}</textarea>`
                : `<input id="${id}" name="${name}.${l}" dir="${dir}" lang="${l}" value="${v}" ${req} autocomplete="off">`}
            </label>`;
        }).join('')}
      </div>
    </fieldset>`;
}

export function readLang(form, name, langs) {
  const out = {};
  for (const l of langs) {
    const v = form.elements[`${name}.${l}`]?.value.trim();
    if (v) out[l] = v;
  }
  return out;
}

export function field(label, inputHtml, hint = '') {
  return `
    <label class="field">
      <span class="field-label">${esc(label)}</span>
      ${inputHtml}
      ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
    </label>`;
}

export function toggle(name, label, checked, hint = '') {
  return `
    <label class="switch-row">
      <span><span class="field-label">${esc(label)}</span>${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</span>
      <input type="checkbox" class="switch" name="${name}" ${checked ? 'checked' : ''}>
    </label>`;
}

/** Tappable chips backed by checkboxes. options: [[value, label], …] */
export function chips(name, options, selected = []) {
  return `
    <div class="chips">
      ${options.map(([value, label]) => `
        <label class="chip">
          <input type="checkbox" name="${name}" value="${esc(value)}" ${selected.includes(value) ? 'checked' : ''}>
          <span>${esc(label)}</span>
        </label>`).join('')}
    </div>`;
}

export const checkedValues = (form, name) =>
  $$(`input[name="${name}"]:checked`, form).map((i) => i.value);

/** Days-of-week picker, 0 = Sunday. */
export function daysPicker(name, selected = [0, 1, 2, 3, 4, 5, 6]) {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `
    <div class="chips chips-days">
      ${names.map((n, i) => `
        <label class="chip chip-day">
          <input type="checkbox" name="${name}" value="${i}" ${selected.includes(i) ? 'checked' : ''}>
          <span>${n}</span>
        </label>`).join('')}
    </div>`;
}

export function parseMoney(v) {
  const n = Number(String(v).replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export function parseIntOrNull(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const money = (n) => Number(n).toFixed(2);

/** Primary display name for admin lists: first outlet language, with the other underneath. */
export function nameBlock(obj, langs) {
  const [a, b] = langs;
  const main = obj?.[a] || obj?.[b] || Object.values(obj || {})[0] || '(no name)';
  const sub = b && obj?.[b] && obj?.[a] ? obj[b] : '';
  return `<span class="nm" dir="auto">${esc(main)}</span>${sub ? `<span class="nm-sub" dir="auto">${esc(sub)}</span>` : ''}`;
}

export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || `menu-${Date.now().toString(36)}`;
}
