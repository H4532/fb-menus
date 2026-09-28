-- =====================================================================
-- FB Menus — new outlet template, filled in for Moood (coffee).
-- Copy this file for any new outlet and change the values marked ◀.
-- Creates the outlet, one menu with sections, and the coffee choice
-- groups (size / milk / extras). Dishes are then added in the admin panel.
-- Safe to re-run: skips if the slug already exists.
-- =====================================================================

do $$
declare
  v_slug   text := 'moood';                                            -- ◀ folder name & URL
  v_outlet uuid;
  v_menu   uuid;
  v_size   uuid;
  v_milk   uuid;
  v_extra  uuid;
begin
  if exists (select 1 from public.outlets where slug = v_slug) then
    raise notice 'Outlet "%" already exists — skipped.', v_slug;
    return;
  end if;

  insert into public.outlets (
    slug, name, tagline, timezone, languages, default_language,
    currency, vat_rate, prices_include_vat, service_charge_pct,
    price_note, calorie_note, unavailable_display
  ) values (
    v_slug,
    '{"en": "Moood", "ar": "موود"}',                                   -- ◀
    '{"en": "Holiday Inn Jeddah Corniche", "ar": "هوليداي إن كورنيش جدة"}',
    'Asia/Riyadh', '{ar,en}', 'ar', 'SAR', 15, true, 0,
    '{"en": "All prices are in Saudi Riyals and include 15% VAT.",
      "ar": "جميع الأسعار بالريال السعودي وتشمل ضريبة القيمة المضافة 15٪."}',
    '{"en": "Adults need an average of 2,000 calories a day. Individual needs may vary.",
      "ar": "يحتاج البالغون إلى 2000 سعرة حرارية في المتوسط يومياً، وقد تختلف الاحتياجات الفردية."}',
    'grey'
  ) returning id into v_outlet;

  insert into public.menus (outlet_id, slug, name, menu_type, sort_order)
  values (v_outlet, 'coffee-bar', '{"en": "Coffee & Treats", "ar": "القهوة والحلويات"}', 'a_la_carte', 10)  -- ◀
  returning id into v_menu;

  insert into public.categories (outlet_id, menu_id, name, sort_order) values          -- ◀
    (v_outlet, v_menu, '{"en": "Hot coffee",    "ar": "القهوة الساخنة"}', 10),
    (v_outlet, v_menu, '{"en": "Iced coffee",   "ar": "القهوة المثلجة"}', 20),
    (v_outlet, v_menu, '{"en": "Tea & more",    "ar": "الشاي والمشروبات"}', 30),
    (v_outlet, v_menu, '{"en": "Pastries",      "ar": "المعجنات"}',       40),
    (v_outlet, v_menu, '{"en": "Desserts",      "ar": "الحلويات"}',       50);

  -- Sizes: each option's price REPLACES the drink price (enter full prices per drink
  -- by creating one size group per price tier, e.g. "Sizes – espresso drinks").
  insert into public.option_groups (outlet_id, internal_name, name, selection, min_select, max_select, pricing, sort_order)
  values (v_outlet, 'Sizes – hot espresso drinks', '{"en": "Size", "ar": "الحجم"}', 'single', 1, 1, 'replace', 10)
  returning id into v_size;
  insert into public.options (outlet_id, group_id, name, price, is_default, sort_order) values   -- ◀ prices
    (v_outlet, v_size, '{"en": "Small",  "ar": "صغير"}',  14.00, false, 10),
    (v_outlet, v_size, '{"en": "Medium", "ar": "وسط"}',   17.00, true,  20),
    (v_outlet, v_size, '{"en": "Large",  "ar": "كبير"}',  20.00, false, 30);

  -- Milk: price is ADDED (0 = included).
  insert into public.option_groups (outlet_id, internal_name, name, selection, min_select, max_select, pricing, sort_order)
  values (v_outlet, 'Milk choice', '{"en": "Milk", "ar": "نوع الحليب"}', 'single', 0, 1, 'add', 20)
  returning id into v_milk;
  insert into public.options (outlet_id, group_id, name, price, is_default, sort_order) values
    (v_outlet, v_milk, '{"en": "Full-fat",  "ar": "كامل الدسم"}',  0.00, true,  10),
    (v_outlet, v_milk, '{"en": "Low-fat",   "ar": "قليل الدسم"}',  0.00, false, 20),
    (v_outlet, v_milk, '{"en": "Oat",       "ar": "حليب الشوفان"}', 3.00, false, 30),
    (v_outlet, v_milk, '{"en": "Almond",    "ar": "حليب اللوز"}',  3.00, false, 40),
    (v_outlet, v_milk, '{"en": "Lactose-free", "ar": "خالٍ من اللاكتوز"}', 2.00, false, 50);

  -- Extras: guest may pick several, each ADDED.
  insert into public.option_groups (outlet_id, internal_name, name, selection, min_select, max_select, pricing, sort_order)
  values (v_outlet, 'Coffee extras', '{"en": "Extras", "ar": "إضافات"}', 'multi', 0, null, 'add', 30)
  returning id into v_extra;
  insert into public.options (outlet_id, group_id, name, price, sort_order) values
    (v_outlet, v_extra, '{"en": "Extra shot",      "ar": "جرعة إسبريسو إضافية"}', 4.00, 10),
    (v_outlet, v_extra, '{"en": "Vanilla syrup",   "ar": "شراب الفانيلا"}',       3.00, 20),
    (v_outlet, v_extra, '{"en": "Caramel syrup",   "ar": "شراب الكراميل"}',       3.00, 30),
    (v_outlet, v_extra, '{"en": "Hazelnut syrup",  "ar": "شراب البندق"}',         3.00, 40);

  raise notice 'Outlet "%" created: %', v_slug, v_outlet;
end;
$$;
