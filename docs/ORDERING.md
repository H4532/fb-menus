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

## On the guest's phone

- The unsent cart is kept on the phone for 4 hours.
- Every order sent is saved under **My orders** (last 20, for 30 days). The list is reachable from the button at the top of the menu, even without scanning a QR code again.
- Each saved order shows its live status as staff move it through the admin: Received → Being prepared → Ready → Served, or Cancelled. Status is looked up with `guest_order_status()` (`supabase/08_guest_order_status.sql`), which only answers for the order's secret id stored on that phone.
- **Save receipt** creates a PNG receipt. On phones it opens the share sheet (save to Photos, WhatsApp, …); on computers it downloads the file.
- **Order again** re-adds a previous order's dishes to the cart. It is only offered when the guest opened the menu from a table or room QR code.

## Order status

| Status | Colour | Set by | Guest sees |
|---|---|---|---|
| 🟡 New | amber | automatic when sent | Received |
| 🔵 Accepted | blue | staff: **Accept** | Being prepared |
| 🟢 Ready | green | staff: **Mark ready** | Ready (pop-up + vibration) |
| ⚪ Served | grey | staff: **Mark served** | Served |
| 🔴 Cancelled | red | staff: **Cancel** | Cancelled |

- The same colours are used in the admin Orders tab, on the guest's phone and in the e-mails.
- Every change is stored with its time in `orders.status_history` (`09_order_status_history.sql`). It shows as a timeline on each order card and in the e-mails.
- Each status change is e-mailed by the `order-status` Edge Function to the order address(es). The subject starts with the status colour, e.g. `🔵 ACCEPTED · Order #8 · Table 5 · Roshan Restaurant`. The function only acts for signed-in staff of that outlet.
- The guest's phone checks its open orders every 20 seconds while the menu is open and updates the coloured banner at the top.

## E-mail notifications

Order e-mails go to the address(es) in **Admin → Settings → Guest ordering**. There are two ways to send them; the function uses Resend when a key is stored, otherwise FormSubmit.

### A. FormSubmit (active now; no account needed)

- The first send to a new address makes FormSubmit e-mail an **“Activate Form”** link to that address. Click it once.
- Every order is then e-mailed as a simple table: order, table/room, time, items with choices and notes, total, and a link to the Orders tab.
- Until the link is clicked, order cards in the admin show *“E-mail not sent — Waiting for activation”*. Orders still appear in the Orders tab.
- Each new address added in Settings needs its own one-time activation.
- Check the spam/junk folder for the activation e-mail. Corporate filters may hold it; if so, ask IT to allow `formsubmit.co`.
- FormSubmit is a free third-party relay: order details (dishes, table, guest first name if given) pass through it. No payment data is involved.

### B. Resend (branded HTML e-mail, your own sender address)

1. Create a free account at <https://resend.com>, then open **API Keys → Create API key**.
2. Store the key in the database:
   ```sql
   insert into private.app_settings (key, value) values ('resend_api_key', 're_…')
   on conflict (key) do update set value = excluded.value;
   ```
3. Until a domain is verified in Resend, mail can only go to the Resend account's own address. After verifying a domain, set a sender:
   ```sql
   insert into private.app_settings (key, value) values ('mail_from', 'Roshan Orders <orders@your-domain.com>')
   on conflict (key) do update set value = excluded.value;
   ```

As soon as a Resend key exists, it is used instead of FormSubmit.

## Notes

- Anyone can type a different table number into the address, so staff should check the table when serving. For room orders, confirm by phone before charging to the room.
- Ordering is only possible while the viewed menu is being served (its serving hours).
- Sold-out dishes can't be ordered. If a dish sells out while it's in a guest's cart, the guest is told before sending.
- Order numbers count up per outlet (#1, #2, …).
