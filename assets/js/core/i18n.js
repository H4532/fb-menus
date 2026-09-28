// FB Menus — language selection and translation helpers.
import { STRINGS, RTL_LANGS, ALLERGENS, DIETARY, BADGES } from './strings.js';

const STORE_KEY = 'fbm:lang';

let current = 'en';
let fallback = 'en';
let extraBadges = {};

/**
 * Pick the language for this visit.
 * Order: ?lang= in URL → last choice on this device → phone language → outlet default.
 */
export function chooseLanguage(available, defaultLang) {
  const ok = (l) => l && available.includes(l);
  const url = new URLSearchParams(location.search).get('lang');
  if (ok(url)) return url;

  let saved = null;
  try { saved = localStorage.getItem(STORE_KEY); } catch { /* private mode */ }
  if (ok(saved)) return saved;

  for (const l of navigator.languages || [navigator.language || '']) {
    const base = String(l).slice(0, 2).toLowerCase();
    if (ok(base)) return base;
  }
  return ok(defaultLang) ? defaultLang : available[0];
}

export function setLanguage(lang, { remember = true, fallbackLang } = {}) {
  current = lang;
  if (fallbackLang) fallback = fallbackLang;
  const html = document.documentElement;
  html.lang = lang;
  html.dir = RTL_LANGS.includes(lang) ? 'rtl' : 'ltr';
  if (remember) {
    try { localStorage.setItem(STORE_KEY, lang); } catch { /* ignore */ }
  }
}

export const lang = () => current;
export const isRtl = () => RTL_LANGS.includes(current);

export function setExtraBadges(map) { extraBadges = map || {}; }

/** Interface string, with {placeholders}. */
export function t(key, vars = {}) {
  const table = STRINGS[current] || STRINGS.en;
  let s = table[key] ?? STRINGS.en[key] ?? key;
  if (typeof s === 'string') {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  }
  return s;
}

/** Translate a jsonb text field {"en": "...", "ar": "..."} with sensible fallback. */
export function tr(field) {
  if (!field || typeof field !== 'object') return typeof field === 'string' ? field : '';
  return field[current] || field[fallback] || field.en || Object.values(field).find(Boolean) || '';
}

export const allergenLabel = (code) => tr(ALLERGENS[code]) || code;
export const dietaryLabel  = (code) => tr(DIETARY[code]) || code;
export const badgeLabel    = (code) => tr(extraBadges[code] || BADGES[code]) || code.replaceAll('_', ' ');

/** Escape text for safe insertion into HTML templates. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
