// FB Menus admin — Choices: sizes, milk, sides, add-ons, combo steps.
// One group can be attached to many dishes (e.g. "Coffee sizes" on every coffee).
import { esc } from '../core/i18n.js';
import * as api from './api.js';
import {
  $, $$, toast, errorToast, openDialog, langFields, readLang, field,
  parseMoney, parseIntOrNull, money, nameBlock,
} from './ui.js';

const RULES = {
  one_required: { label: 'Guest picks exactly one', selection: 'single', min: 1, max: 1 },
  one_optional: { label: 'Guest may pick one', selection: 'single', min: 0, max: 1 },
  any:          { label: 'Guest may pick any number', selection: 'multi', min: 0, max: null },
  up_to:        { label: 'Guest may pick up to…', selection: 'multi', min: 0, max: 2 },
};

function ruleOf(g) {
  if (g.selection === 'single') return g.min_select > 0 ? 'one_required' : 'one_optional';
  return g.max_select == null ? 'any' : 'up_to';
}

function describe(g) {
  const r = ruleOf(g);
  const base = r === 'up_to' ? `Pick up to ${g.max_select}` : RULES[r].label.replace('Guest ', '').replace(/^./, (c) => c.toUpperCase());
  return `${base} · ${g.pricing === 'replace' ? 'price replaces dish price' : 'price is added'}`;
}

export function renderOptions(ctx) {
  const { data, langs } = ctx;
  const root = $('#view');
  const usage = (gid) => data.item_option_groups.filter((x) => x.group_id === gid).length;

  root.innerHTML = `
    <div class="view-head">
      <h1>Choices</h1>
      <button type="button" class="btn btn-primary" data-new-group>+ Add choice group</button>
    </div>
    <p class="hint">Sizes, milk, sides and add-ons. Create a group once, then tick it on each dish that offers it.</p>
    <ul class="rows sortable" role="list" data-groups>
      ${data.option_groups.map((g) => {
        const opts = data.options.filter((o) => o.group_id === g.id);
        return `
          <li class="row" data-group-id="${g.id}">
            ${data.option_groups.length > 1 ? '<span class="drag" aria-hidden="true">⋮⋮</span>' : ''}
            <button type="button" class="row-name" data-edit-group="${g.id}">
              <span class="nm">${esc(g.internal_name)}</span>
              <span class="nm-sub">${esc(describe(g))}</span>
              <span class="row-flags">
                ${opts.map((o) => `<span class="tag${o.is_available ? '' : ' tag-muted'}">${esc(o.name.en || Object.values(o.name)[0] || '')}</span>`).join('')}
                <span class="tag tag-info">on ${usage(g.id)} dish${usage(g.id) === 1 ? '' : 'es'}</span>
              </span>
            </button>
          </li>`;
      }).join('') || '<li class="empty"><p>No choice groups yet.</p></li>'}
    </ul>`;

  $('[data-new-group]', root).addEventListener('click', () => editGroup(ctx, null));
  $$('[data-edit-group]', root).forEach((b) => b.addEventListener('click', () => editGroup(ctx, b.dataset.editGroup)));
  const list = $('[data-groups]', root);
  if (data.option_groups.length > 1) {
    window.Sortable.create(list, {
      handle: '.drag', animation: 150,
      onEnd: async () => {
        try {
          await api.reorder('option_groups', $$('[data-group-id]', list).map((li) => li.dataset.groupId));
          toast('Order saved');
        } catch (err) { errorToast(err); ctx.reload(); }
      },
    });
  }
}

function optionRow(ctx, o = { name: {}, price: 0, calories: null, is_default: false, is_available: true }) {
  const { langs, outlet } = ctx;
  return `
    <div class="opt-row" data-opt ${o.id ? `data-opt-id="${o.id}"` : ''}>
      <span class="drag" aria-hidden="true">⋮⋮</span>
      <div class="opt-fields">
        ${langFields('on', 'Option name', o.name, langs, { required: [outlet.default_language] })}
        <div class="row-fields">
          ${field(`Price (${outlet.currency})`, `<input name="op" inputmode="decimal" value="${money(o.price)}">`)}
          ${field('Calories', `<input name="oc" inputmode="numeric" value="${o.calories ?? ''}">`)}
          <label class="check"><input type="checkbox" name="od" ${o.is_default ? 'checked' : ''}> Pre-selected</label>
          <label class="check"><input type="checkbox" name="oa" ${o.is_available ? 'checked' : ''}> Available</label>
        </div>
      </div>
      <button type="button" class="btn btn-small btn-quiet" data-remove-opt>Remove</button>
    </div>`;
}

async function editGroup(ctx, groupId) {
  const { data, langs, outlet } = ctx;
  const g = groupId ? data.option_groups.find((x) => x.id === groupId) : null;
  const isNew = !g;
  const v = g || { internal_name: '', name: {}, selection: 'single', min_select: 1, max_select: 1, pricing: 'add' };
  const opts = g ? data.options.filter((o) => o.group_id === g.id).sort((a, b) => a.sort_order - b.sort_order) : [];
  const rule = ruleOf(v);

  const body = `
    <div class="form-grid">
      ${field('Name for staff', `<input name="internal_name" value="${esc(v.internal_name)}" required placeholder="e.g. Coffee sizes (hot)">`, 'Only you see this; it helps tell similar groups apart.')}
      ${langFields('name', 'Question guests see', v.name, langs, { required: [outlet.default_language], hint: 'e.g. “Choose your size”, “Choice of side”' })}
      <div class="row-fields">
        ${field('How many can the guest pick?', `
          <select name="rule">
            ${Object.entries(RULES).map(([k, r]) => `<option value="${k}" ${rule === k ? 'selected' : ''}>${r.label}</option>`).join('')}
          </select>`)}
        ${field('Up to', `<input name="max" inputmode="numeric" value="${v.max_select ?? 2}">`)}
        ${field('Pricing', `
          <select name="pricing">
            <option value="replace" ${v.pricing === 'replace' ? 'selected' : ''}>Option price replaces dish price (sizes)</option>
            <option value="add" ${v.pricing === 'add' ? 'selected' : ''}>Option price is added (extras)</option>
          </select>`)}
      </div>
      <fieldset class="field-group">
        <legend>Options</legend>
        <p class="hint">For “replaces”: enter each size’s full price. For “added”: enter the extra charge, or 0 if free.</p>
        <div data-opt-list>${opts.map((o) => optionRow(ctx, o)).join('')}</div>
        <button type="button" class="btn btn-small btn-quiet" data-add-opt>+ Add option</button>
      </fieldset>
    </div>`;

  const onOpen = (dlg) => {
    const list = $('[data-opt-list]', dlg);
    const ruleSel = dlg.querySelector('[name=rule]');
    const pricingSel = dlg.querySelector('[name=pricing]');
    const maxField = dlg.querySelector('[name=max]').closest('.field');
    const sync = () => {
      const r = RULES[ruleSel.value];
      maxField.hidden = ruleSel.value !== 'up_to';
      // "replaces" only makes sense when exactly one option is chosen
      pricingSel.querySelector('[value=replace]').disabled = r.selection !== 'single';
      if (r.selection !== 'single') pricingSel.value = 'add';
    };
    ruleSel.addEventListener('change', sync);
    sync();
    $('[data-add-opt]', dlg).addEventListener('click', () => list.insertAdjacentHTML('beforeend', optionRow(ctx)));
    dlg.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove-opt]');
      if (rm) rm.closest('[data-opt]').remove();
    });
    window.Sortable.create(list, { handle: '.drag', animation: 150 });
  };

  const onSubmit = async (form) => {
    const r = RULES[form.elements.rule.value];
    const max = r.selection === 'single' ? 1 : (form.elements.rule.value === 'up_to' ? Math.max(1, parseIntOrNull(form.elements.max.value) || 1) : null);
    const row = {
      internal_name: form.elements.internal_name.value.trim(),
      name: readLang(form, 'name', langs),
      selection: r.selection,
      min_select: r.min,
      max_select: max,
      pricing: r.selection === 'single' ? form.elements.pricing.value : 'add',
    };
    const optionEls = $$('[data-opt]', form);
    if (!optionEls.length) throw new Error('Add at least one option.');
    const optRows = optionEls.map((el, i) => {
      const name = {};
      for (const l of langs) {
        const val = $(`[name="on.${l}"]`, el).value.trim();
        if (val) name[l] = val;
      }
      const price = parseMoney($('[name=op]', el).value || 0);
      if (!Number.isFinite(price)) throw new Error('Enter valid option prices (numbers only).');
      return {
        id: el.dataset.optId || null,
        name,
        price,
        calories: parseIntOrNull($('[name=oc]', el).value),
        is_default: $('[name=od]', el).checked,
        is_available: $('[name=oa]', el).checked,
        sort_order: (i + 1) * 10,
      };
    });
    if (row.selection === 'single' && optRows.filter((o) => o.is_default).length > 1) {
      throw new Error('Only one option can be pre-selected when the guest picks one.');
    }

    const saved = isNew
      ? await api.insert('option_groups', { ...row, outlet_id: outlet.id, sort_order: (Math.max(0, ...data.option_groups.map((x) => x.sort_order)) + 10) })
      : await api.update('option_groups', g.id, row);

    const keep = new Set(optRows.filter((o) => o.id).map((o) => o.id));
    for (const o of opts) if (!keep.has(o.id)) await api.remove('options', o.id);
    for (const o of optRows) {
      const { id, ...fields } = o;
      if (id) await api.update('options', id, fields);
      else await api.insert('options', { ...fields, group_id: saved.id, outlet_id: outlet.id });
    }
  };

  const result = await openDialog({
    title: isNew ? 'Add choice group' : 'Edit choice group',
    body,
    wide: true,
    submitLabel: isNew ? 'Add group' : 'Save group',
    onOpen,
    onSubmit,
    danger: isNew ? null : {
      label: 'Delete group',
      confirm: 'Delete this choice group? It will be removed from every dish that uses it.',
      action: async () => {
        await api.remove('option_groups', g.id);
        toast('Choice group deleted');
        ctx.reload();
      },
    },
  });
  if (result) {
    toast(isNew ? 'Choice group added' : 'Choice group saved');
    ctx.reload();
  }
}
