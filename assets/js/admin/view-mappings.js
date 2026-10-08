// FB Menus admin — Simphony item mapping + catalogue maintenance.
import { esc } from '../core/i18n.js';
import * as api from './api.js';
import { $, $$, money, openDialog, field, toast, confirmDialog } from './ui.js';

let filterText = '';
let catalogFilter = '';

const en = (o) => o?.en || o?.ar || Object.values(o || {})[0] || '';

function expectedGuestPrice(ctx, catalog) {
  const base = Number(catalog.price || 0);
  return ctx.outlet.prices_include_vat
    ? base * (1 + Number(ctx.outlet.vat_rate || 0) / 100)
    : base;
}

function catalogLabel(x) {
  return `${x.rvc_number} · ${x.object_number} · ${x.name} · POS ${money(x.price)}`;
}

export function renderMappings(ctx) {
  const root = $('#view');
  const catalog = ctx.data.simphony_catalog_items.slice().sort((a, b) =>
    (a.rvc_number - b.rvc_number) || a.name.localeCompare(b.name));
  const catalogById = Object.fromEntries(catalog.map((c) => [c.id, c]));
  const mappingByItem = Object.fromEntries(ctx.data.simphony_item_mappings.map((m) => [m.item_id, m]));
  const rows = ctx.data.items
    .slice()
    .sort((a, b) => en(a.name).localeCompare(en(b.name)))
    .map((item) => {
      const map = mappingByItem[item.id];
      const cat = map ? catalogById[map.catalog_item_id] : null;
      const expected = cat ? expectedGuestPrice(ctx, cat) : null;
      const diff = cat ? Math.abs(Number(item.price) - expected) : null;
      return { item, map, cat, expected, priceOk: cat ? diff <= 0.03 : false };
    });

  const mapped = rows.filter((r) => r.cat).length;
  const unmatchedPrice = rows.filter((r) => r.cat && !r.priceOk).length;

  root.innerHTML = `
    <div class="view-head">
      <div>
        <h1>Simphony Mapping</h1>
        <p class="hint">Manage web-dish mappings and the MICROS catalogue used for POS posting.</p>
      </div>
      <button type="button" class="btn btn-primary" data-add-catalog>+ Add MICROS item</button>
    </div>

    <div class="toolbar">
      <span class="tag tag-info">Mapped ${mapped}/${rows.length}</span>
      <span class="tag ${unmatchedPrice ? 'tag-warn' : 'tag-info'}">Price checks ${unmatchedPrice ? unmatchedPrice + ' to review' : 'OK'}</span>
      <input type="search" class="search" data-map-search placeholder="Search dish, MICROS item or object #" value="${esc(filterText)}">
    </div>

    <section class="block">
      <h2>Dish mappings</h2>
      <div class="table-wrap">
        <table class="order-table mapping-table">
          <thead>
            <tr>
              <th>Web dish</th><th class="num">Web price</th><th>Status</th>
              <th>RVC</th><th>MICROS item</th><th>Object #</th><th class="num">POS base</th>
              <th class="num">Expected incl. VAT</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(({ item, cat, expected, priceOk }) => {
              const search = [en(item.name), cat?.name, cat?.object_number, cat?.rvc_number].filter(Boolean).join(' ').toLowerCase();
              return `
                <tr data-map-row data-search="${esc(search)}">
                  <td><strong>${esc(en(item.name))}</strong></td>
                  <td class="num">${money(item.price)}</td>
                  <td>${cat
                    ? `<span class="tag tag-info">Mapped ✓</span>${priceOk ? '' : ' <span class="tag tag-warn">Price review</span>'}`
                    : '<span class="tag tag-warn">Unmapped</span>'}</td>
                  <td>${cat ? esc(String(cat.rvc_number)) : '—'}</td>
                  <td>${cat ? esc(cat.name) : '—'}</td>
                  <td>${cat ? esc(String(cat.object_number)) : '—'}</td>
                  <td class="num">${cat ? money(cat.price) : '—'}</td>
                  <td class="num">${cat ? money(expected) : '—'}</td>
                  <td><button type="button" class="btn btn-small btn-quiet" data-map-item="${item.id}">${cat ? 'Edit' : 'Map'}</button></td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="block">
      <div class="view-head">
        <div>
          <h2>MICROS catalogue</h2>
          <p class="hint">Add, edit or delete the Simphony items available for mapping. Deleting a mapped MICROS item also removes its mapping.</p>
        </div>
        <input type="search" class="search" data-catalog-search placeholder="Search MICROS catalogue" value="${esc(catalogFilter)}">
      </div>
      <div class="table-wrap">
        <table class="order-table">
          <thead><tr><th>RVC</th><th>Object #</th><th>Definition</th><th>Price Seq</th><th>Name</th><th class="num">POS base</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${catalog.map((c) => {
              const mappedCount = ctx.data.simphony_item_mappings.filter((m) => m.catalog_item_id === c.id).length;
              const search = [c.rvc_number,c.object_number,c.name,c.major_group,c.family_group].filter(Boolean).join(' ').toLowerCase();
              return `
                <tr data-catalog-row data-search="${esc(search)}">
                  <td>${c.rvc_number}</td><td>${c.object_number}</td><td>${c.definition_sequence}</td><td>${c.price_sequence}</td>
                  <td><strong>${esc(c.name)}</strong>${mappedCount ? ` <span class="tag tag-info">${mappedCount} mapped</span>` : ''}</td>
                  <td class="num">${money(c.price)}</td>
                  <td>${c.is_active ? '<span class="tag tag-info">Active</span>' : '<span class="tag tag-muted">Inactive</span>'}</td>
                  <td><button type="button" class="btn btn-small btn-quiet" data-edit-catalog="${c.id}">Edit</button></td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </section>`;

  $('[data-map-search]', root).addEventListener('input', (e) => {
    filterText = e.target.value;
    const q = filterText.trim().toLowerCase();
    $$('[data-map-row]', root).forEach((row) => { row.hidden = q && !row.dataset.search.includes(q); });
  });
  $('[data-catalog-search]', root).addEventListener('input', (e) => {
    catalogFilter = e.target.value;
    const q = catalogFilter.trim().toLowerCase();
    $$('[data-catalog-row]', root).forEach((row) => { row.hidden = q && !row.dataset.search.includes(q); });
  });

  $('[data-add-catalog]', root).addEventListener('click', () => editCatalog(ctx, null));
  $$('[data-edit-catalog]', root).forEach((b) => b.addEventListener('click', () => editCatalog(ctx, b.dataset.editCatalog)));
  $$('[data-map-item]', root).forEach((b) => b.addEventListener('click', () => editMapping(ctx, b.dataset.mapItem)));
}

async function editMapping(ctx, itemId) {
  const item = ctx.data.items.find((x) => x.id === itemId);
  const current = ctx.data.simphony_item_mappings.find((m) => m.item_id === itemId);
  const catalog = ctx.data.simphony_catalog_items.filter((x) => x.is_active).slice().sort((a,b) =>
    (a.rvc_number - b.rvc_number) || a.name.localeCompare(b.name));
  const byLabel = new Map(catalog.map((x) => [catalogLabel(x), x]));
  const currentCatalog = current ? catalog.find((x) => x.id === current.catalog_item_id) : null;

  await openDialog({
    title: `Map: ${en(item.name)}`,
    submitLabel: 'Save mapping',
    danger: current ? {
      label: 'Remove mapping',
      confirm: `Remove the MICROS mapping from “${en(item.name)}”?`,
      action: async () => {
        await api.setSimphonyMapping(ctx.outlet.id, item.id, null);
        toast('Mapping removed');
        await ctx.reload();
      },
    } : null,
    body: `
      <p class="hint">Choose the exact existing Simphony item. Search by item name or object number.</p>
      ${field('MICROS item', `
        <input name="catalog" list="mapping-catalog-list" required
          value="${esc(currentCatalog ? catalogLabel(currentCatalog) : '')}"
          placeholder="Type name or object #">
        <datalist id="mapping-catalog-list">
          ${catalog.map((x) => `<option value="${esc(catalogLabel(x))}"></option>`).join('')}
        </datalist>`)}
      ${currentCatalog ? `<p class="hint">Current: RVC ${currentCatalog.rvc_number}, Object #${currentCatalog.object_number}, Definition ${currentCatalog.definition_sequence}, Price Seq ${currentCatalog.price_sequence}</p>` : ''}`,
    onSubmit: async (form) => {
      const selected = byLabel.get(form.elements.catalog.value.trim());
      if (!selected) throw new Error('Choose a MICROS item from the list.');
      await api.setSimphonyMapping(ctx.outlet.id, item.id, selected);
      toast('Mapping saved');
      await ctx.reload();
    },
  });
}

async function editCatalog(ctx, catalogId) {
  const current = catalogId ? ctx.data.simphony_catalog_items.find((x) => x.id === catalogId) : null;
  const v = current || {
    rvc_number: 101, object_number: '', definition_sequence: 1, price_sequence: 1,
    name: '', price: '', major_group: '', family_group: '', is_active: true,
  };

  await openDialog({
    title: current ? 'Edit MICROS item' : 'Add MICROS item',
    submitLabel: current ? 'Save item' : 'Add item',
    danger: current ? {
      label: 'Delete MICROS item',
      confirm: `Delete “${current.name}” from the mapping catalogue? Any web-dish mapping using it will also be removed.`,
      action: async () => {
        await api.deleteSimphonyCatalogItem(current.id);
        toast('MICROS item deleted');
        await ctx.reload();
      },
    } : null,
    body: `
      <div class="form-grid">
        <div class="row-fields">
          ${field('RVC', `<input name="rvc_number" type="number" min="1" step="1" required value="${esc(String(v.rvc_number))}">`)}
          ${field('Object #', `<input name="object_number" inputmode="numeric" required value="${esc(String(v.object_number))}">`)}
          ${field('Definition sequence', `<input name="definition_sequence" type="number" min="1" step="1" required value="${esc(String(v.definition_sequence))}">`)}
          ${field('Price sequence', `<input name="price_sequence" type="number" min="1" step="1" required value="${esc(String(v.price_sequence))}">`)}
        </div>
        ${field('MICROS item name', `<input name="name" required value="${esc(v.name)}">`)}
        <div class="row-fields">
          ${field('POS base price', `<input name="price" inputmode="decimal" required value="${esc(String(v.price))}">`, 'Before VAT for Roshan')}
          ${field('Major group', `<input name="major_group" value="${esc(v.major_group || '')}">`)}
          ${field('Family group', `<input name="family_group" value="${esc(v.family_group || '')}">`)}
        </div>
        <label class="switch-row">
          <span><span class="field-label">Active</span><span class="hint">Inactive items stay in history but cannot be newly mapped.</span></span>
          <input type="checkbox" class="switch" name="is_active" ${v.is_active ? 'checked' : ''}>
        </label>
      </div>`,
    onSubmit: async (form) => {
      const rvc = Number(form.elements.rvc_number.value);
      const obj = Number(form.elements.object_number.value);
      const def = Number(form.elements.definition_sequence.value);
      const pseq = Number(form.elements.price_sequence.value);
      const price = Number(String(form.elements.price.value).replace(',', '.'));
      if (![rvc,obj,def,pseq].every((n) => Number.isInteger(n) && n > 0)) throw new Error('RVC, Object #, Definition and Price Sequence must be positive whole numbers.');
      if (!Number.isFinite(price) || price < 0) throw new Error('Enter a valid POS base price.');

      const row = {
        outlet_id: ctx.outlet.id,
        rvc_number: rvc,
        object_number: obj,
        definition_sequence: def,
        price_sequence: pseq,
        name: form.elements.name.value.trim(),
        price,
        major_group: form.elements.major_group.value.trim() || null,
        family_group: form.elements.family_group.value.trim() || null,
        is_active: form.elements.is_active.checked,
        source: current?.source || 'admin',
        source_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (current) await api.update('simphony_catalog_items', current.id, row);
      else await api.insert('simphony_catalog_items', row);
      toast(current ? 'MICROS item updated' : 'MICROS item added');
      await ctx.reload();
    },
  });
}
