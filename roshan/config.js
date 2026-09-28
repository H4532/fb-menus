// FB Menus — outlet config: Roshan Restaurant, Holiday Inn Jeddah Corniche.
//
// This file holds only what the page needs BEFORE the menu data arrives
// (branding and display choices). Everything the manager edits — dishes,
// prices, hours, languages, VAT/service notes — lives in the database and is
// changed from the admin panel.

export default {
  // Must match outlets.slug in the database.
  slug: 'roshan',

  brand: {
    // Header wordmark. Leave as is, or set `logo` to an image in this folder
    // (e.g. 'logo.svg', white version for the green bar) to replace the text.
    name: { en: 'Roshan', ar: 'روشن', fr: 'Roshan' },
    logo: null,

    // Holiday Inn palette, taken from the printed A La Carte menu.
    colors: {
      primary: '#145A3C',      // deep green: bar, rules, prices
      primaryDeep: '#0E4029',  // headings on light backgrounds
      accent: '#A9CBBF',       // sage band
      accentSoft: '#E4F0EB',   // light tints
      ink: '#15241C',
      muted: '#5C6E64',
      paper: '#FFFFFF',
    },

    // Optional: override the typeface (must be loaded by the page).
    fontFamily: null,
  },

  format: {
    priceDecimals: 2,              // "45.00" as on the printed menu
    numerals: { ar: 'arab' },      // Arabic uses ٠١٢٣…; set 'latn' for 0123…
    currencyDisplay: 'symbol',     // 'symbol' = new riyal sign, 'code' = SAR, 'local' = ر.س
    currencyPosition: 'before',    // riyal sign to the left of the amount
  },

  showCalories: true,
  showPhotos: true,

  // Extra badges for this outlet (code → labels). Codes: lowercase, a–z 0–9 _
  badges: {
    // late_night: { en: 'Late night', ar: 'بعد منتصف الليل' },
  },
};
