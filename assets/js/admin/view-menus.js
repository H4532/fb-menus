// FB Menus admin — Menus: menus, serving hours, buffet prices and sections.
import { esc } from '../core/i18n.js';
import * as api from './api.js';
import {
  $, $$, toast, errorToast, openDialog, langFields, readLang, field, toggle,
  daysPicker, parseMoney, money, nameBlock, slugify,
} from './ui.js';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TYPES = { a_la_carte: 'À la carte', buffet: 'Buffet', set: 'Set menu' };

function daysText(days) {
  if (!days || days.length === 7) return 'Daily';
  return [...days].sort().map((d) => DAY[d]).join(', ');
}

function hoursText(data, menuId) {
  const s = data.menu_schedules.filter((x) => x.menu_id === menuId);
  if (!s.length) return 'All day';
  return s.map((w) => `${w.days.length === 7 ? '' : `${daysText(w.days)} `}${w.start_time.slice(0, 5)}–${w.end_time.slice(0, 5)}`).join(' · ');
}

export function renderMenus(ctx) {
  const { data, langs } = ctx;
  const root = $('#view');
  root.innerHTML = `
    <div class="view-head">
      <h1>Menus</h1>
      <button type="button" class="btn btn-primary" data-new-menu>+ Add menu</button>
    </div>
    <p class="hint">A menu with no serving hours shows all day. When hours are set, the guest page opens on the menu being served now.</p>
    <ul class="menu-cards sortable" role="list" data-menus>
      ${data.menus.map((m) => menuCard(ctx, m)).join('') || '<li class="empty"><p>No menus yet.</p></li>'}
    </ul>`;

  $('[data-new-menu]', root).addEventListener('click', () => editMenu(ctx, null));
  $$('[data-edit-menu]', root).forEach((b) => b.addEventListener('click', () => editMenu(ctx, b.dataset.editMenu)));
  $$('[data-new-cat]', root).forEach((b) => b.addEventListener('click', () => editCategory(ctx, null, b.dataset.newCat)));
  $$('[data-edit-cat]', root).forEach((b) => b.addEventListener('click', () => editCategory(ctx, b.dataset.editCat)));

  const list = $('[data-menus]', root);
  if (data.menus.length > 1) {
    window.Sortable.create(list, {
      handle: '.drag-menu', animation: 150,
      onEnd: () => saveOrder(ctx, 'menus', $$(':scope > [data-menu-id]', list).map((li) => li.dataset.menuId)),
    });
  }
  $$('ul[data-cats]', root).forEach((ul) => {
    if (ul.children.length < 2) return;
    window.Sortable.create(ul, {
      handle: '.drag', animation: 150,
      onEnd: () => saveOrder(ctx, 'categories', $$('[data-cat-id]', ul).map((li) => li.dataset.catId)),
    });
  });
}

async function saveOrder(ctx, table, ids) {
  try {
    await api.reorder(table, ids);
    toast('Order saved');
    ctx.reload({ quiet: true });
  } catch (err) {
    errorToast(err);
    ctx.reload();
  }
}

function menuCard(ctx, m) {
  const { data, langs } = ctx;
  const cats = data.categories.filter((c) => c.menu_id === m.id);
  const count = (cid) => data.category_items.filter((ci) => ci.category_id === cid).length;
  return `
    <li class="menu-card${m.is_active ? '' : ' is-hidden'}" data-menu-id="${m.id}">
      <div class="menu-card-head">
        ${data.menus.length > 1 ? '<span class="drag drag-menu" title="Drag to reorder" aria-hidden="true">⋮⋮</span>' : ''}
        <div class="menu-card-title">
          ${nameBlock(m.name, langs)}
          <span class="menu-card-meta">
            <span class="tag">${esc(TYPES[m.menu_type])}</span>
            <span class="tag">${esc(hoursText(data, m.id))}</span>
            ${m.is_active ? '' : '<span class="tag tag-muted">Hidden</span>'}
          </span>
        </div>
        <button type="button" class="btn btn-small btn-quiet" data-edit-menu="${m.id}">Edit menu</button>
      </div>
      <ul class="rows compact" role="list" data-cats="${m.id}">
        ${cats.map((c) => `
          <li class="row${c.is_active ? '' : ' is-hidden'}" data-cat-id="${c.id}">
            ${cats.length > 1 ? '<span class="drag" aria-hidden="true">⋮⋮</span>' : ''}
            <button type="button" class="row-name" data-edit-cat="${c.id}">
              ${nameBlock(c.name, langs)}
              <span class="row-flags"><span class="tag">${count(c.id)} dishes</span>${c.is_active ? '' : '<span class="tag tag-muted">Hidden</span>'}</span>
            </button>
          </li>`).join('') || '<li class="row-empty">No sections yet.</li>'}
      </ul>
      <button type="button" class="btn btn-small btn-quiet add-inline" data-new-cat="${m.id}">+ Add section</button>
    </li>`;
}

// ---------------------------------------------------------------------------
// Menu editor (name, type, hours, buffet prices)
// ---------------------------------------------------------------------------
function scheduleRow(w = { days: [0, 1, 2, 3, 4, 5, 6], start_time: '07:00', end_time: '11:00' }) {
  return `
    <div class="sched-row" data-sched>
      ${daysPicker('sched-days', w.days)}
      <div class="row-fields">
        ${field('From', `<input type="time" name="sched-start" value="${w.start_time.slice(0, 5)}" required>`)}
        ${field('Until', `<input type="time" name="sched-end" value="${w.end_time.slice(0, 5)}" required>`, 'Earlier than “From” = past midnight')}
        <button type="button" class="btn btn-small btn-quiet" data-remove-row>Remove</button>
      </div>
    </div>`;
}

function buffetRow(ctx, b = { label: {}, price: 0, days: [0, 1, 2, 3, 4, 5, 6], start_time: null, end_time: null, note: {} }) {
  const { langs } = ctx;
  return `
    <div class="sched-row" data-buffet ${b.id ? `data-buffet-id="${b.id}"` : ''}>
      ${langFields('bl', 'Price label (e.g. Adult, Child 6–12)', b.label, langs, { required: [ctx.outlet.default_language] })}
      <div class="row-fields">
        ${field(`Price (${ctx.outlet.currency})`, `<input name="bp" inputmode="decimal" value="${money(b.price)}" required>`)}
        ${field('From (optional)', `<input type="time" name="bs" value="${b.start_time ? b.start_time.slice(0, 5) : ''}">`)}
        ${field('Until (optional)', `<input type="time" name="be" value="${b.end_time ? b.end_time.slice(0, 5) : ''}">`)}
      </div>
      ${daysPicker('bd', b.days)}
      <button type="button" class="btn btn-small btn-quiet" data-remove-row>Remove price</button>
    </div>`;
}

async function editMenu(ctx, menuId) {
  const { data, langs, outlet } = ctx;
  const menu = menuId ? data.menus.find((m) => m.id === menuId) : null;
  const isNew = !menu;
  const v = menu || { name: {}, description: {}, menu_type: 'a_la_carte', is_active: true };
  const schedules = menu ? data.menu_schedules.filter((s) => s.menu_id === menu.id) : [];
  const buffets = menu ? data.buffet_prices.filter((b) => b.menu_id === menu.id) : [];

  const body = `
    <div class="form-grid">
      ${langFields('name', 'Menu name', v.name, langs, { required: [outlet.default_language] })}
      ${langFields('description', 'Headline shown at the top (optional)', v.description, langs)}
      <div class="row-fields">
        ${field('Type', `<select name="menu_type">${Object.entries(TYPES).map(([k, l]) => `<option value="${k}" ${v.menu_type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      </div>
      ${toggle('is_active', 'Show this menu to guests', v.is_active)}

      <fieldset class="field-group">
        <legend>Serving hours</legend>
        <p class="hint">Leave empty to serve all day. Add one line per time window.</p>
        <div data-sched-list>${schedules.map(scheduleRow).join('')}</div>
        <button type="button" class="btn btn-small btn-quiet" data-add-sched>+ Add time window</button>
      </fieldset>

      <fieldset class="field-group" data-buffet-group ${v.menu_type === 'buffet' ? '' : 'hidden'}>
        <legend>Buffet prices</legend>
        <div data-buffet-list>${buffets.map((b) => buffetRow(ctx, b)).join('')}</div>
        <button type="button" class="btn btn-small btn-quiet" data-add-buffet>+ Add price</button>
      </fieldset>
    </div>`;

  const onOpen = (dlg) => {
    const schedList = $('[data-sched-list]', dlg);
    const buffetList = $('[data-buffet-list]', dlg);
    $('[data-add-sched]', dlg).addEventListener('click', () => schedList.insertAdjacentHTML('beforeend', scheduleRow()));
    $('[data-add-buffet]', dlg).addEventListener('click', () => buffetList.insertAdjacentHTML('beforeend', buffetRow(ctx)));
    dlg.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove-row]');
      if (rm) rm.closest('[data-sched], [data-buffet]').remove();
    });
    dlg.querySelector('[name=menu_type]').addEventListener('change', (e) => {
      $('[data-buffet-group]', dlg).hidden = e.target.value !== 'buffet';
    });
  };

  const onSubmit = async (form) => {
    const row = {
      name: readLang(form, 'name', langs),
      description: readLang(form, 'description', langs),
      menu_type: form.elements.menu_type.value,
      is_active: form.elements.is_active.checked,
    };

    // Validate hours & buffet rows before writing anything.
    const scheds = $$('[data-sched]', form).map((el) => ({
      days: $$('input[name="sched-days"]:checked', el).map((i) => Number(i.value)),
      start_time: $('[name="sched-start"]', el).value,
      end_time: $('[name="sched-end"]', el).value,
    }));
    for (const s of scheds) {
      if (!s.days.length) throw new Error('Each time window needs at least one day.');
      if (!s.start_time || !s.end_time || s.start_time === s.end_time) throw new Error('Each time window needs different start and end times.');
    }
    const buffetRows = row.menu_type === 'buffet' ? $$('[data-buffet]', form).map((el, i) => {
      const label = {};
      for (const l of langs) {
        const val = $(`[name="bl.${l}"]`, el).value.trim();
        if (val) label[l] = val;
      }
      const s = $('[name=bs]', el).value;
      const e = $('[name=be]', el).value;
      const price = parseMoney($('[name=bp]', el).value);
      const days = $$('input[name="bd"]:checked', el).map((x) => Number(x.value));
      if (!Number.isFinite(price)) throw new Error('Enter a valid buffet price.');
      if (!days.length) throw new Error('Each buffet price needs at least one day.');
      if (Boolean(s) !== Boolean(e)) throw new Error('Buffet times: fill both “From” and “Until”, or neither.');
      return { label, price, days, start_time: s || null, end_time: e || null, sort_order: (i + 1) * 10 };
    }) : [];

    let saved;
    if (isNew) {
      const base = slugify(row.name.en || row.name[outlet.default_language]);
      const taken = new Set(data.menus.map((m) => m.slug));
      let slug = base;
      for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
      const last = Math.max(0, ...data.menus.map((m) => m.sort_order));
      saved = await api.insert('menus', { ...row, slug, outlet_id: outlet.id, sort_order: last + 10 });
    } else {
      saved = await api.update('menus', menu.id, row);
    }

    // Replace schedules and buffet prices (small lists; simplest correct approach).
    for (const s of schedules) await api.remove('menu_schedules', s.id);
    await api.insertMany('menu_schedules', scheds.map((s) => ({ ...s, menu_id: saved.id, outlet_id: outlet.id })));
    for (const b of buffets) await api.remove('buffet_prices', b.id);
    await api.insertMany('buffet_prices', buffetRows.map((b) => ({ ...b, menu_id: saved.id, outlet_id: outlet.id })));
  };

  const result = await openDialog({
    title: isNew ? 'Add menu' : 'Edit menu',
    body,
    wide: true,
    submitLabel: isNew ? 'Add menu' : 'Save menu',
    onOpen,
    onSubmit,
    danger: isNew ? null : {
      label: 'Delete menu',
      confirm: 'Delete this menu and its sections? The dishes stay saved and can be placed in another menu.',
      action: async () => {
        await api.remove('menus', menu.id);
        toast('Menu deleted');
        ctx.reload();
      },
    },
  });
  if (result) {
    toast(isNew ? 'Menu added' : 'Menu saved');
    ctx.reload();
  }
}

// ---------------------------------------------------------------------------
// Section editor
// ---------------------------------------------------------------------------
async function editCategory(ctx, catId, menuId) {
  const { data, langs, outlet } = ctx;
  const cat = catId ? data.categories.find((c) => c.id === catId) : null;
  const isNew = !cat;
  const v = cat || { name: {}, description: {}, is_active: true, menu_id: menuId };

  const body = `
    <div class="form-grid">
      ${langFields('name', 'Section name', v.name, langs, { required: [outlet.default_language] })}
      ${langFields('description', 'Short note under the title (optional)', v.description, langs)}
      ${field('Menu', `<select name="menu_id">${data.menus.map((m) => `<option value="${m.id}" ${m.id === v.menu_id ? 'selected' : ''}>${esc(m.name.en || Object.values(m.name)[0])}</option>`).join('')}</select>`)}
      ${toggle('is_active', 'Show this section to guests', v.is_active)}
    </div>`;

  const result = await openDialog({
    title: isNew ? 'Add section' : 'Edit section',
    body,
    submitLabel: isNew ? 'Add section' : 'Save section',
    onSubmit: async (form) => {
      const row = {
        name: readLang(form, 'name', langs),
        description: readLang(form, 'description', langs),
        menu_id: form.elements.menu_id.value,
        is_active: form.elements.is_active.checked,
      };
      if (isNew) {
        const last = Math.max(0, ...data.categories.filter((c) => c.menu_id === row.menu_id).map((c) => c.sort_order));
        await api.insert('categories', { ...row, outlet_id: outlet.id, sort_order: last + 10 });
      } else {
        await api.update('categories', cat.id, row);
      }
    },
    danger: isNew ? null : {
      label: 'Delete section',
      confirm: 'Delete this section? Its dishes stay saved (find them under “Not on any menu” if they aren’t in another section).',
      action: async () => {
        await api.remove('categories', cat.id);
        toast('Section deleted');
        ctx.reload();
      },
    },
  });
  if (result) {
    toast(isNew ? 'Section added' : 'Section saved');
    ctx.reload();
  }
}
