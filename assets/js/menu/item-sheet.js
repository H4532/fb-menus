// FB Menus — item detail sheet and price/calorie range calculation.
import { t, tr, esc, allergenLabel, dietaryLabel, badgeLabel } from '../core/i18n.js';
import { price, priceDelta, kcal, kcalRange } from '../core/format.js';
import { photoUrl } from '../platform.js';

const sum = (arr) => arr.reduce((a, b) => a + b, 0);

/**
 * Headline price and calorie range for an item, taking option groups into account:
 *  - 'replace' groups (sizes, protein choice) set the price/calories;
 *  - required 'add' groups add their cheapest/lightest picks to the minimum;
 *  - all 'add' groups add their most expensive/heaviest picks to the maximum.
 */
export function itemSummary(data, item) {
  const groups = item.option_groups.map((id) => data.option_groups[id]).filter(Boolean);
  const replace = groups.find((g) => g.pricing === 'replace' && g.options.some((o) => o.available));

  let minPrice = Number(item.price);
  let maxPrice = minPrice;
  let minKcal = item.calories;
  let maxKcal = item.calories;

  if (replace) {
    const opts = replace.options.filter((o) => o.available);
    const prices = opts.map((o) => Number(o.price));
    minPrice = Math.min(...prices);
    maxPrice = Math.max(...prices);
    const cals = opts.map((o) => o.calories).filter((c) => c != null);
    if (cals.length) { minKcal = Math.min(...cals); maxKcal = Math.max(...cals); }
  }

  for (const g of groups.filter((x) => x.pricing === 'add')) {
    const opts = g.options.filter((o) => o.available);
    if (!opts.length) continue;
    const picksMax = g.max == null ? opts.length : Math.min(g.max, opts.length);
    const byPrice = opts.map((o) => Number(o.price)).sort((a, b) => a - b);
    const byCal = opts.map((o) => o.calories ?? 0).sort((a, b) => a - b);
    if (g.min > 0) {
      minPrice += sum(byPrice.slice(0, g.min));
      if (minKcal != null) minKcal += sum(byCal.slice(0, g.min));
    }
    maxPrice += sum(byPrice.slice(-picksMax));
    if (maxKcal != null) maxKcal += sum(byCal.slice(-picksMax));
  }

  return {
    minPrice, maxPrice, minKcal, maxKcal,
    fromPrice: maxPrice > minPrice && Boolean(replace),
  };
}

function groupRule(g) {
  if (g.selection === 'single') return g.min > 0 ? `${t('choose_one')} · ${t('required')}` : `${t('choose_one')} · ${t('optional')}`;
  const rule = g.max == null ? t('choose_any') : t('choose_up_to', { n: g.max });
  return g.min > 0 ? `${rule} · ${t('required')}` : `${rule} · ${t('optional')}`;
}

function renderGroup(g) {
  return `
    <section class="sheet-group">
      <h3>${esc(tr(g.name))} <span class="rule">${esc(groupRule(g))}</span></h3>
      <ul role="list">
        ${g.options.map((o) => `
          <li class="${o.available ? '' : 'is-soldout'}">
            <span class="opt-name">${esc(tr(o.name))}${o.available ? '' : ` <small>(${esc(t('sold_out'))})</small>`}</span>
            <span class="opt-meta">
              ${o.calories != null ? `<span class="opt-kcal">${esc(kcal(o.calories))}</span>` : ''}
              <span class="opt-price">${g.pricing === 'replace' ? price(o.price) : (Number(o.price) > 0 ? priceDelta(o.price) : esc(t('included')))}</span>
            </span>
          </li>`).join('')}
      </ul>
    </section>`;
}

export function openItemSheet(data, itemId, config) {
  const item = data.items[itemId];
  if (!item) return;
  const dialog = document.getElementById('sheet');
  const s = itemSummary(data, item);
  const groups = item.option_groups.map((id) => data.option_groups[id]).filter(Boolean);
  const photo = config.showPhotos !== false && item.photo
    ? `<img class="sheet-photo" src="${photoUrl(item.photo, 'large')}" alt="" decoding="async">`
    : '';
  const desc = tr(item.description);

  dialog.innerHTML = `
    <div class="sheet" role="document">
      <button type="button" class="sheet-close" data-close aria-label="${esc(t('close'))}">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
      ${photo}
      <div class="sheet-body">
        ${item.badges.length ? `<p class="sheet-badges">${item.badges.map((b) => `<span class="badge">${esc(badgeLabel(b))}</span>`).join('')}</p>` : ''}
        <h2 class="sheet-title" id="sheet-title">${esc(tr(item.name))}</h2>
        <p class="sheet-price">
          ${s.fromPrice ? `<span class="from">${esc(t('from'))}</span> ` : ''}${price(s.minPrice)}
          ${s.minKcal != null && config.showCalories !== false ? `<span class="sheet-kcal">${esc(kcalRange(s.minKcal, s.maxKcal))}</span>` : ''}
        </p>
        ${item.available ? '' : `<p class="soldout-label">${esc(t('sold_out'))}</p>`}
        ${desc ? `<p class="sheet-desc">${esc(desc)}</p>` : ''}
        ${groups.map(renderGroup).join('')}
        <section class="sheet-facts">
          <h3>${esc(t('allergens'))}</h3>
          ${item.allergens.length
            ? `<p>${esc(t('contains'))}: <strong>${item.allergens.map((a) => esc(allergenLabel(a))).join(lang_sep())}</strong></p>`
            : `<p class="muted">${esc(t('no_allergen_info'))}</p>`}
          ${item.dietary.length ? `<p>${esc(t('dietary'))}: ${item.dietary.map((d) => esc(dietaryLabel(d))).join(lang_sep())}</p>` : ''}
          ${item.spice > 0 ? `<p>${esc(t('spice'))}: ${esc(t('spice_levels')[item.spice])}</p>` : ''}
          ${item.caffeine_mg != null ? `<p>${esc(t('caffeine'))}: <bdi>${item.caffeine_mg} mg</bdi></p>` : ''}
        </section>
        <p class="sheet-allergy muted">${esc(t('allergy_notice'))}</p>
      </div>
    </div>`;
  dialog.setAttribute('aria-labelledby', 'sheet-title');

  const close = () => dialog.close();
  dialog.querySelector('[data-close]').addEventListener('click', close);
  dialog.onclick = (e) => { if (e.target === dialog) close(); };   // tap on backdrop
  dialog.showModal();
  dialog.querySelector('.sheet').scrollTop = 0;
}

function lang_sep() {
  return document.documentElement.lang === 'ar' ? '، ' : ', ';
}
