# Add a new outlet — checklist (example: Moood)

A new outlet needs **no code changes**: one SQL run, one copied folder, one line on the landing page.

## 1. Database (5 min)

1. Copy `supabase/seed/new-outlet-moood.sql` and change the values marked `◀`:
   - the slug (folder and URL name: lowercase, letters, numbers and dashes);
   - the outlet name, menu and sections;
   - the coffee size prices.
2. Run it in **Supabase → SQL Editor**. It creates the outlet, a first menu with sections, and ready-made **Size / Milk / Extras** choice groups.
3. Give the manager access (see `SETUP.md` step 4). If the user already exists, only the `insert into outlet_admins` is needed, with `o.slug = 'moood'`.

## 2. Guest page folder (5 min)

1. Duplicate the `roshan/` folder and rename it to the slug, e.g. `moood/`.
2. In `moood/config.js`:
   - `slug: 'moood'`
   - `brand.name`: header wordmark in each language
   - `brand.colors`: the outlet's palette (primary = bars, rules and prices; accent = the band behind the headline)
   - `brand.logo`: optional white logo file placed in the folder, e.g. `'logo.svg'`
   - `badges`: optional extra badges, e.g. `{ barista_pick: { en: 'Barista’s pick', ar: 'اختيار الباريستا' } }`
3. In `moood/index.html`, update the `<title>`, the description, `theme-color` and the fallback name in the header. Everything else stays the same.
4. In `moood/manifest.webmanifest`, update the name, short name and colors. Replace the three icon PNGs.
5. In the root `index.html`, add a link to the outlet (a commented example is already there).
6. In `sw.js`, bump `BUILD`. Then commit and push.

## 3. Menu content (manager, in the admin)

1. Sign in at `/admin/`. With access to several outlets, a selector appears in the top bar.
2. **Choices**: check the size prices. For drinks with different price tiers, create one size group per tier, e.g. “Sizes – espresso drinks” and “Sizes – specialty drinks”.
3. **Dishes → + Add dish** for each drink:
   - name in Arabic and English, price, **calories**, **caffeine (mg)**;
   - tick its section;
   - tick **Size**, **Milk** and **Extras** as they apply.
   - For drinks with a Size group, the dish price is only a fallback; guests see “from” the smallest size price.
4. **Menus**: set serving hours if the café has separate menus, e.g. Breakfast until 11:00.
5. **Settings**: opening hours, phone, service charge.

## 4. QR codes

Open `tools/qr.html` and set the outlet folder to `moood`, the card names, and the table or room numbers. Test the link on a phone, then print.

## 5. Before launch

- [ ] Every item has calories (and caffeine for drinks) and verified allergens.
- [ ] Arabic and English names checked by a native speaker.
- [ ] Menu opened on hotel Wi-Fi on an iPhone and an Android phone.
