-- =====================================================================
-- FB Menus — seed/roshan.sql
-- Roshan Restaurant, Holiday Inn Jeddah Corniche.
-- Source: "Holiday Inn – Restaurant – menu.pdf" (A La Carte page).
--
-- Safe to re-run: skips if the "roshan" outlet already exists.
--
-- ⚠ BEFORE GO-LIVE
--   * allergens / dietary tags below are PROVISIONAL (not in the PDF) —
--     the chef must verify every item in the admin panel.
--   * Arabic name of "Steak Sandwich" in the PDF reads "برجر كبير لحم أو دجاج"
--     (big beef or chicken burger) — confirm which is correct.
--   * No serving hours set → the A La Carte menu shows as available all day.
-- =====================================================================

do $$
declare
  v_outlet uuid;
  v_menu   uuid;
  v_grp    uuid;
begin
  if exists (select 1 from public.outlets where slug = 'roshan') then
    raise notice 'Outlet "roshan" already exists — seed skipped.';
    return;
  end if;

  -- -------------------------------------------------------------------
  -- Outlet
  -- -------------------------------------------------------------------
  insert into public.outlets (
    slug, name, tagline, timezone, languages, default_language,
    currency, vat_rate, prices_include_vat, service_charge_pct,
    price_note, calorie_note, opening_hours, contact, unavailable_display
  ) values (
    'roshan',
    '{"en": "Roshan Restaurant", "ar": "مطعم روشن"}',
    '{"en": "Holiday Inn Jeddah Corniche", "ar": "هوليداي إن كورنيش جدة"}',
    'Asia/Riyadh',
    '{ar,en}',
    'ar',
    'SAR', 15, true, 0,
    '{"en": "All prices are in Saudi Riyals and include 15% VAT.",
      "ar": "جميع الأسعار بالريال السعودي وتشمل ضريبة القيمة المضافة 15٪."}',
    '{"en": "Adults need an average of 2,000 calories a day. Individual needs may vary.",
      "ar": "يحتاج البالغون إلى 2000 سعرة حرارية في المتوسط يومياً، وقد تختلف الاحتياجات الفردية."}',
    '[]',
    '{}',
    'grey'
  )
  returning id into v_outlet;

  -- -------------------------------------------------------------------
  -- Menu
  -- -------------------------------------------------------------------
  insert into public.menus (outlet_id, slug, name, description, menu_type, sort_order)
  values (
    v_outlet,
    'a-la-carte',
    '{"en": "A La Carte", "ar": "قائمة الطعام"}',
    '{"en": "Keep you going all day!", "ar": "لنبقيك نشيطاً طوال اليوم!"}',
    'a_la_carte',
    10
  )
  returning id into v_menu;

  -- -------------------------------------------------------------------
  -- Categories (order as printed)
  -- -------------------------------------------------------------------
  insert into public.categories (outlet_id, menu_id, name, sort_order) values
    (v_outlet, v_menu, '{"en": "Midnight Meals", "ar": "قائمة منتصف الليل"}', 10),
    (v_outlet, v_menu, '{"en": "Italian Corner", "ar": "الركن الإيطالي"}',    20),
    (v_outlet, v_menu, '{"en": "Sandwiches",     "ar": "السندوتشات"}',        30),
    (v_outlet, v_menu, '{"en": "Main Dishes",    "ar": "الأطباق الرئيسية"}',  40),
    (v_outlet, v_menu, '{"en": "Desserts",       "ar": "الحلويات"}',          50);

  -- -------------------------------------------------------------------
  -- Items (names, prices, calories as printed; tags provisional)
  -- -------------------------------------------------------------------
  insert into public.items
    (outlet_id, code, name, price, calories, spice_level, allergens, dietary)
  values
    (v_outlet, 'caesar-salad',
     '{"en": "Caesar Salad", "ar": "سلطة السيزر"}',
     45.00, 510, 0, '{gluten,dairy,egg,fish}', '{}'),

    (v_outlet, 'greek-salad',
     '{"en": "Greek Salad", "ar": "سلطة يونانية"}',
     40.00, 350, 0, '{dairy}', '{vegetarian,gluten_free}'),

    (v_outlet, 'spaghetti-napolitano',
     '{"en": "Spaghetti Napolitano Pasta", "ar": "مكرونه سباجتي نابوليتانو"}',
     45.00, 380, 0, '{gluten}', '{vegetarian}'),

    (v_outlet, 'spaghetti-bolognaise',
     '{"en": "Spaghetti Bolognaise Pasta", "ar": "مكرونه سباجتي بولونيز"}',
     50.00, 560, 0, '{gluten,celery}', '{}'),

    (v_outlet, 'pizza-vegetarian',
     '{"en": "Pizza Vegetarian", "ar": "بيتزا الخضار"}',
     50.00, 1610, 0, '{gluten,dairy}', '{vegetarian}'),

    (v_outlet, 'club-sandwich',
     '{"en": "Holiday Inn Club Sandwich", "ar": "هوليداي ان كلوب ساندويتش"}',
     60.00, 1130, 0, '{gluten,egg,dairy,mustard}', '{}'),

    (v_outlet, 'cheese-sandwich',
     '{"en": "Cheese Sandwich", "ar": "ساندويش الجبنة"}',
     50.00, 760, 0, '{gluten,dairy}', '{vegetarian}'),

    -- Calories come from the protein choice (Beef 1240 / Chicken 800)
    (v_outlet, 'steak-sandwich',
     '{"en": "Steak Sandwich", "ar": "برجر كبير لحم أو دجاج"}',
     60.00, null, 0, '{gluten,dairy}', '{}'),

    (v_outlet, 'mix-grill-platter',
     '{"en": "Mix Grill Platter", "ar": "مشاوي مشكلة"}',
     125.00, 810, 0, '{}', '{}'),

    (v_outlet, 'grilled-chicken',
     '{"en": "Grilled Chicken", "ar": "دجاج مشوي"}',
     80.00, 880, 0, '{}', '{}'),

    (v_outlet, 'butter-chicken',
     '{"en": "Butter Chicken", "ar": "دجاج بالزبدة"}',
     80.00, 2100, 1, '{dairy,nuts}', '{}'),

    (v_outlet, 'grilled-salmon',
     '{"en": "Grilled Salmon", "ar": "سلمون مشوي"}',
     110.00, 390, 0, '{fish}', '{}'),

    (v_outlet, 'chocolate-cake',
     '{"en": "Chocolate Cake", "ar": "كيكة الشوكولاتة"}',
     35.00, 540, 0, '{gluten,dairy,egg}', '{vegetarian}'),

    (v_outlet, 'cheesecake-blackberry',
     '{"en": "Cheesecake with Blackberry Sauce", "ar": "كيكة الجبن مع صلصة التوت الأسود"}',
     35.00, 720, 0, '{gluten,dairy,egg}', '{vegetarian}'),

    (v_outlet, 'seasonal-fruit-slices',
     '{"en": "Seasonal Fruits Slices", "ar": "شرائح الفواكه الموسمية"}',
     35.00, 190, 0, '{}', '{vegetarian,vegan,gluten_free,dairy_free}');

  -- -------------------------------------------------------------------
  -- Place items in categories
  -- -------------------------------------------------------------------
  insert into public.category_items (outlet_id, category_id, item_id, sort_order)
  select v_outlet, c.id, i.id, x.ord
  from (values
    ('Midnight Meals', 'caesar-salad',           10),
    ('Midnight Meals', 'greek-salad',            20),
    ('Italian Corner', 'spaghetti-napolitano',   10),
    ('Italian Corner', 'spaghetti-bolognaise',   20),
    ('Italian Corner', 'pizza-vegetarian',       30),
    ('Sandwiches',     'club-sandwich',          10),
    ('Sandwiches',     'cheese-sandwich',        20),
    ('Sandwiches',     'steak-sandwich',         30),
    ('Main Dishes',    'mix-grill-platter',      10),
    ('Main Dishes',    'grilled-chicken',        20),
    ('Main Dishes',    'butter-chicken',         30),
    ('Main Dishes',    'grilled-salmon',         40),
    ('Desserts',       'chocolate-cake',         10),
    ('Desserts',       'cheesecake-blackberry',  20),
    ('Desserts',       'seasonal-fruit-slices',  30)
  ) as x(cat, code, ord)
  join public.categories c on c.outlet_id = v_outlet and c.name->>'en' = x.cat
  join public.items      i on i.outlet_id = v_outlet and i.code = x.code;

  -- -------------------------------------------------------------------
  -- Option group: protein choice for the Steak Sandwich
  -- ('replace' → the option's price and calories are shown/used)
  -- -------------------------------------------------------------------
  insert into public.option_groups
    (outlet_id, internal_name, name, selection, min_select, max_select, pricing, sort_order)
  values
    (v_outlet, 'Steak sandwich – protein',
     '{"en": "Choice of protein", "ar": "اختر نوع اللحم"}',
     'single', 1, 1, 'replace', 10)
  returning id into v_grp;

  insert into public.options (outlet_id, group_id, name, price, calories, is_default, sort_order) values
    (v_outlet, v_grp, '{"en": "Beef",    "ar": "لحم"}',  60.00, 1240, true,  10),
    (v_outlet, v_grp, '{"en": "Chicken", "ar": "دجاج"}', 60.00,  800, false, 20);

  insert into public.item_option_groups (outlet_id, item_id, group_id, sort_order)
  select v_outlet, i.id, v_grp, 10
  from public.items i
  where i.outlet_id = v_outlet and i.code = 'steak-sandwich';

  raise notice 'Roshan seeded: outlet %', v_outlet;
end;
$$;

-- =====================================================================
-- Link the admin user (run AFTER creating the user in
-- Supabase Dashboard → Authentication → Users → Add user).
-- Replace the e-mail, then run this statement on its own.
-- =====================================================================
-- insert into public.outlet_admins (outlet_id, user_id, role)
-- select o.id, u.id, 'owner'
-- from public.outlets o, auth.users u
-- where o.slug = 'roshan'
--   and u.email = 'manager@example.com'
-- on conflict (outlet_id, user_id) do update set role = excluded.role;
