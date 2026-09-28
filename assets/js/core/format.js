// FB Menus — prices, calories and number formatting.
import { lang, t } from './i18n.js';

let settings = {
  currency: 'SAR',
  decimals: 2,
  numerals: { ar: 'arab' },        // per-language numbering system: 'arab' (٤٥) or 'latn' (45)
  currencyDisplay: 'symbol',       // SAR only: 'symbol' (new riyal sign), 'code' (SAR) or 'local' (ر.س)
  currencyPosition: 'before',      // 'before' | 'after' (visual, left/right of the number)
};

export function configureFormat(outlet, cfg = {}) {
  settings = {
    ...settings,
    currency: outlet?.currency || settings.currency,
    decimals: cfg.priceDecimals ?? settings.decimals,
    numerals: { ...settings.numerals, ...(cfg.numerals || {}) },
    currencyDisplay: cfg.currencyDisplay || settings.currencyDisplay,
    currencyPosition: cfg.currencyPosition || settings.currencyPosition,
  };
}

function locale() {
  const l = lang();
  const ns = settings.numerals[l] || 'latn';
  return `${l === 'ar' ? 'ar-SA' : l}-u-nu-${ns}`;
}

export function number(n, decimals = 0) {
  return new Intl.NumberFormat(locale(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

function currencyMark() {
  if (settings.currency !== 'SAR') return null;
  if (settings.currencyDisplay === 'symbol') return '<span class="riyal" aria-hidden="true">\u20C1</span>';
  if (settings.currencyDisplay === 'local') return lang() === 'ar' ? 'ر.س' : 'SAR';
  return 'SAR';
}

/** Price as HTML. Screen readers get "45.00 Saudi riyals". */
export function price(amount) {
  const mark = currencyMark();
  const value = number(Number(amount) || 0, settings.decimals);
  if (!mark) {
    const txt = new Intl.NumberFormat(locale(), {
      style: 'currency', currency: settings.currency,
      minimumFractionDigits: settings.decimals, maximumFractionDigits: settings.decimals,
    }).format(Number(amount) || 0);
    return `<span class="price"><bdi>${txt}</bdi></span>`;
  }
  const sr = lang() === 'ar' ? 'ريال سعودي' : lang() === 'fr' ? 'riyals saoudiens' : 'Saudi riyals';
  // Separate flex items so bidi reordering can't swap the sign and the amount.
  const amt = `<span class="amt">${value}</span>`;
  const sign = `<span class="cur">${mark}</span>`;
  const parts = settings.currencyPosition === 'after' ? amt + sign : sign + amt;
  return `<span class="price"><span class="money" dir="ltr">${parts}</span><span class="sr-only"> ${sr}</span></span>`;
}

/** Signed price difference for add-on options: "+ ⃁ 4.00". */
export function priceDelta(amount) {
  return Number(amount) > 0 ? `<span class="delta">+</span>${price(amount)}` : '';
}

export function kcal(value) {
  if (value == null) return '';
  return `${number(value)} ${t('kcal')}`;
}

export function kcalRange(min, max) {
  if (min == null) return '';
  if (max == null || max === min) return kcal(min);
  return `${number(min)}–${number(max)} ${t('kcal')}`;
}

/** "HH:MM" (24 h, outlet local) → localized short time. */
export function time(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(Date.UTC(2000, 0, 1, h, m));
  return new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(d);
}

/** Localized weekday names, Sunday first (0 = Sunday, like the database). */
export function weekdayNames(style = 'short') {
  const fmt = new Intl.DateTimeFormat(locale(), { weekday: style, timeZone: 'UTC' });
  // 2000-01-02 was a Sunday
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2000, 0, 2 + i))));
}

/** [0,1,2,3,4] → "Sun–Thu"; all days → "Daily". */
export function dayList(days) {
  if (!days || days.length === 7) return t('days_all');
  const names = weekdayNames('short');
  const sorted = [...days].sort((a, b) => a - b);
  const runs = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last && d === last[1] + 1) last[1] = d; else runs.push([d, d]);
  }
  const sep = lang() === 'ar' ? '، ' : ', ';
  return runs.map(([a, b]) => (a === b ? names[a] : `${names[a]}–${names[b]}`)).join(sep);
}
