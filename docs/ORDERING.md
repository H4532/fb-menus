# Guest ordering

Guests who scan a **table** (`?t=12`) or **room** (`?r=1204`) QR code can add dishes to an order and send it. Staff see new orders in the admin **Orders** tab, which beeps for new orders, and by e-mail.
Guests pay when the order is served; nothing is charged online.

## How it works

1. The phone sends the cart to the `place-order` Edge Function (`supabase/functions/place-order`).
2. `public.place_order()` (in `supabase/07_ordering.sql`) checks that:
   - ordering is on;
   - the order has a table or room number;
   - every dish is on an active menu and available;
   - every choice belongs to its dish and meets the choice rules.
3. It then **recalculates all prices** itself; prices sent from the phone are ignored.
4. Anti-spam: at most 5 orders per table or room per 10 minutes, and 60 per outlet per 10 minutes.
5. The guest gets an order number immediately. The e-mail is sent in the background through **Resend**. The result appears on the order card as “E-mailed” or “E-mail not sent” (hover to see the reason).

## Turn it on

1. **E-mail provider (one time):**
   1. Create a free account at <https://resend.com>, then open **API Keys → Create API key** (“Sending access” is enough).
   2. Store the key in the database from the Supabase SQL Editor:
      ```sql
      insert into private.app_settings (key, value) values ('resend_api_key', 're_…')
      on conflict (key) do update set value = excluded.value;
      ```
   3. Until you verify a domain in Resend, mail is sent from `onboarding@resend.dev` and **only to the e-mail address of your Resend account**.
   4. After verifying a domain (e.g. `hijeddah.com`), set a sender:
      ```sql
      insert into private.app_settings (key, value) values ('mail_from', 'Roshan Orders <orders@hijeddah.com>')
      on conflict (key) do update set value = excluded.value;
      ```
2. **Admin → Settings → Guest ordering:** switch on “Take orders…” and enter the e-mail address(es), up to 5.

## Notes

- Anyone can type a different table number into the address, so staff should check the table when serving. For room orders, confirm by phone before charging to the room.
- Ordering is only possible while the viewed menu is being served (its serving hours).
- Sold-out dishes can't be ordered. If a dish sells out while it's in a guest's cart, the guest is told before sending.
- Order numbers count up per outlet (#1, #2, …).
