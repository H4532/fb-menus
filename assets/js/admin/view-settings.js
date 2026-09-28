// FB Menus admin — Outlet settings (owners only; editors see a read-only note).
import { esc } from '../core/i18n.js';
import { LANG_NAMES } from '../core/strings.js';
import * as api from './api.js';
import {
  $, $$, toast, errorToast, langFields, readLang, field, toggle, daysPicker,
  chips, checkedValues,
} from './ui.js';

const ALL_LANGS = Object.keys(LANG_NAMES);

function hoursRow(h = { days: [0, 1, 2, 3, 4, 5, 6], open: '06:30', close: '23:00' }) {
  return `
    <div class="sched-row" data-hours>
      ${daysPicker('h-days', h.days)}
      <div class="row-fields">
        ${field('Opens', `<input type="time" name="h-open" value="${esc(h.open)}" required>`)}
        ${field('Closes', `<input type="time" name="h-close" value="${esc(h.close)}" required>`, 'Earlier than “Opens” = past midnight')}
        <button type="button" class="btn btn-small btn-quiet" data-remove-row>Remove</button>
      </div>
    </div>`;
}

export function renderSettings(ctx) {
  const { outlet, role } = ctx;
  const root = $('#view');
  const langs = outlet.languages;
  const canEdit = role === 'owner';
  const c = outlet.contact || {};

  root.innerHTML = `
    <div class="view-head"><h1>Settings</h1></div>
    ${canEdit ? '' : '<p class="notice">Only the outlet owner can change these settings.</p>'}
    <form class="settings-form" novalidate ${canEdit ? '' : 'inert'}>
      <section class="block">
        <h2 class="block-title">Restaurant</h2>
        ${langFields('name', 'Restaurant name', outlet.name, langs, { required: [outlet.default_language] })}
        ${langFields('tagline', 'Line under the name (e.g. hotel name)', outlet.tagline, langs)}
      </section>

      <section class="block">
        <h2 class="block-title">Languages</h2>
        <p class="hint">Languages guests can switch between. Fill in dish names for each language you turn on.</p>
        ${chips('languages', ALL_LANGS.map((l) => [l, LANG_NAMES[l]]), langs)}
        ${field('Default language', `
          <select name="default_language">
            ${ALL_LANGS.map((l) => `<option value="${l}" ${outlet.default_language === l ? 'selected' : ''}>${LANG_NAMES[l]}</option>`).join('')}
          </select>`, 'Used when the guest’s phone language isn’t offered.')}
      </section>

      <section class="block">
        <h2 class="block-title">Prices and notes</h2>
        <div class="row-fields">
          ${field('VAT rate (%)', `<input name="vat_rate" inputmode="decimal" value="${outlet.vat_rate}">`)}
          ${field('Service charge (%)', `<input name="service_charge_pct" inputmode="decimal" value="${outlet.service_charge_pct}">`, '0 = none. Above 0 adds a line to the menu footer.')}
        </div>
        ${toggle('prices_include_vat', 'Prices include VAT', outlet.prices_include_vat)}
        ${langFields('price_note', 'Price note in the footer', outlet.price_note, langs, { textarea: true })}
        ${langFields('calorie_note', 'Calorie note in the footer', outlet.calorie_note, langs, { textarea: true })}
        ${field('Sold-out dishes', `
          <select name="unavailable_display">
            <option value="grey" ${outlet.unavailable_display === 'grey' ? 'selected' : ''}>Show greyed out with “Sold out today”</option>
            <option value="hide" ${outlet.unavailable_display === 'hide' ? 'selected' : ''}>Hide them</option>
          </select>`)}
      </section>

      <section class="block">
        <h2 class="block-title">Contact</h2>
        <div class="row-fields">
          ${field('Phone', `<input name="phone" type="tel" value="${esc(c.phone || '')}" placeholder="+966 12 …">`)}
          ${field('Room service extension', `<input name="room_service_ext" value="${esc(c.room_service_ext || '')}">`, 'Shown to guests who scan the in-room QR code.')}
        </div>
      </section>

      <section class="block">
        <h2 class="block-title">Opening hours</h2>
        <p class="hint">Shown in the footer. Menu serving hours are set per menu in the Menus tab.</p>
        <div data-hours-list>${(outlet.opening_hours || []).map(hoursRow).join('')}</div>
        <button type="button" class="btn btn-small btn-quiet" data-add-hours>+ Add hours</button>
      </section>

      ${canEdit ? '<div class="sticky-save"><button type="submit" class="btn btn-primary">Save settings</button></div>' : ''}
    </form>`;

  const form = $('.settings-form', root);
  $('[data-add-hours]', root).addEventListener('click', () => $('[data-hours-list]', root).insertAdjacentHTML('beforeend', hoursRow()));
  root.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove-row]');
    if (rm) rm.closest('[data-hours]').remove();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!canEdit) return;
    const btn = $('button[type=submit]', form);
    try {
      const languages = checkedValues(form, 'languages');
      const def = form.elements.default_language.value;
      if (!languages.length) throw new Error('Keep at least one language on.');
      if (!languages.includes(def)) throw new Error('The default language must be one of the languages that are on.');
      const vat = Number(form.elements.vat_rate.value);
      const svc = Number(form.elements.service_charge_pct.value || 0);
      if (!(vat >= 0 && vat <= 100) || !(svc >= 0 && svc <= 100)) throw new Error('VAT and service charge must be between 0 and 100.');

      const hours = $$('[data-hours]', form).map((el) => ({
        days: $$('input[name="h-days"]:checked', el).map((i) => Number(i.value)),
        open: $('[name="h-open"]', el).value,
        close: $('[name="h-close"]', el).value,
      }));
      if (hours.some((h) => !h.days.length || !h.open || !h.close)) throw new Error('Each opening-hours line needs days and both times.');

      const name = readLang(form, 'name', langs);
      if (!name[outlet.default_language] && !name[def]) throw new Error('Enter the restaurant name.');

      btn.disabled = true;
      const patch = {
        name,
        tagline: readLang(form, 'tagline', langs),
        languages,
        default_language: def,
        vat_rate: vat,
        service_charge_pct: svc,
        prices_include_vat: form.elements.prices_include_vat.checked,
        price_note: readLang(form, 'price_note', langs),
        calorie_note: readLang(form, 'calorie_note', langs),
        unavailable_display: form.elements.unavailable_display.value,
        contact: {
          ...c,
          phone: form.elements.phone.value.trim() || undefined,
          room_service_ext: form.elements.room_service_ext.value.trim() || undefined,
        },
        opening_hours: hours,
      };
      await api.updateOutlet(outlet.id, patch);
      toast('Settings saved');
      ctx.reload();
    } catch (err) {
      errorToast(err);
    } finally {
      btn.disabled = false;
    }
  });
}
