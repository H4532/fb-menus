// FB Menus admin — Simphony item mapping overview.
import { esc } from '../core/i18n.js';
import { $, $$, money } from './ui.js';

let filterText = '';

const en = (o) => o?.en || o?.ar || Object.values(o || {})[0] || '';

function expectedGuestPrice(ctx, catalog) {
  const base = Number(catalog.price || 0);
  return ctx.outlet.prices_include_vat
    ? base * (1 + Number(ctx.outlet.vat_rate || 0) / 100)
    : base;
}

export function renderMappings(ctx) {
  const root = $('#view');
  const catalogById = Object.fromEntries(ctx.data.simphony_catalog_items.map((c) => [c.id, c]));
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
      <h1>Simphony Mapping</h1>
    </div>
    <p class="hint">Links each web-menu dish to the existing Simphony menu item used when posting to POS. Simphony base prices are compared to the guest price after VAT.</p>
    <div class="toolbar">
      <span class="tag tag-info">Mapped ${mapped}/${rows.length}</span>
      <span class="tag ${unmatchedPrice ? 'tag-warn' : 'tag-info'}">Price checks ${unmatchedPrice ? unmatchedPrice + ' to review' : 'OK'}</span>
      <input type="search" class="search" placeholder="Search dish, MICROS item or object #" value="${esc(filterText)}" aria-label="Search mappings">
    </div>
    <section class="block">
      <div class="table-wrap">
        <table class="order-table mapping-table">
          <thead>
            <tr>
              <th>Web dish</th><th class="num">Web price</th><th>Status</th>
              <th>RVC</th><th>MICROS item</th><th>Object #</th><th class="num">POS base</th><th class="num">Expected incl. VAT</th>
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
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </section>
    <p class="hint">To change a mapping, open the dish under <strong>Dishes</strong> and use the “MICROS Simphony Mapping” section.</p>`;

  $('.search', root).addEventListener('input', (e) => {
    filterText = e.target.value;
    const q = filterText.trim().toLowerCase();
    $$('[data-map-row]', root).forEach((row) => {
      row.hidden = q && !row.dataset.search.includes(q);
    });
  });
}
