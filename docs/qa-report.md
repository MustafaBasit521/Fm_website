# Quality assurance report

Date: 19 October 2026. Scope: the whole shop (customer site, admin site, API) before the first deployment.

## How it was tested

1. **Automated suites** (run on every change): 530 backend tests (real PostgreSQL built with the real migrations), 411 frontend tests (including axe accessibility checks on every page and guards for phone layouts and colour contrast), linting, formatting, type checks and both production builds.
2. **Live end-to-end run in a real browser** (Chrome, driven by a script) against the **whole running system**: the real backend on a throw-away local database (never the real Supabase data), both websites, test-signed logins (a customer, a second customer and an admin with and without the second factor), and a real browser at desktop and phone widths. About 140 checks covering what a customer and the owner do, the business rules through the real HTTP stack, security probes, accessibility in a real browser, and the scheduled expiry job.

## What was exercised

- **Visitor:** home, shop listing (filters, search, sort, "available only", empty results), product page (sold-out item cannot be added), bag drawer (quantity), live search sheet, cart page, guest checkout with Cash on Delivery and with bank/wallet transfer (instructions, empty proof refused, proof sent, clock stopped), Lahore-only refusal, stock reduced and totals correct in the database, newsletter (join, unsubscribe, reused link), contact form, custom-order request, gallery empty state, 404 pages, redirect to login, no sideways scrolling on 9 pages at 390 and 360 px.
- **Customer:** profile and pop-ups, addresses (any city can be saved, Lahore-only at order time), wishlist (heart, count, panel), checkout with a saved address, order list and detail, cancel (stock returned), notifications, custom order with discussion, proposal, counter-offer and the shop accepting it.
- **Admin:** access gates (visitor, customer account, admin without the second factor, API refusal), dashboard, full order lifecycle (confirm, prepare, ship, deliver, cash received), transfer proof (confirm), cancel, products (create, edit, switch, delete with pop-up), categories (add, open, rename, delete), settings (including switching the transfer method off and on), messages, custom orders (guest request recorded and accepted), customers, activity log, and 12 pages at phone width.
- **Rules and security through HTTP:** another customer cannot read or cancel my order; customer token on admin routes (403); no token (401); price tampering, over-stock, zero and negative quantities, hidden product, made-to-order capacity, disabled online payment all refused; stock never negative; review rules (only after delivery, one per purchase, buyers only, rating range); SQL-looking and `%` searches; a script in a product name shown as plain text; security headers; CORS for unknown origins; clean errors for malformed ids; rate limits (orders 10 per hour, newsletter 5 per hour); new-product announcement; the scheduled expiry route (secret required, expiry, one customer email, no repeat).
- **Accessibility in real Chrome (axe, WCAG 2.1 AA):** 10 shop pages and 12 admin pages.

## Problems found and fixed

| # | Found | Fix |
|---|---|---|
| 1 | Pages promised "secure online payment" although the shop offers Cash on Delivery and transfer | The cart and checkout line is built from the payment methods the backend really offers; the home and product pages no longer promise online payment |
| 2 | The wishlist button on the product page kept its own list: the header heart count and the wishlist panel did not agree with it | One shared list for every heart and button (with a regression test) |
| 3 | Admin pages had no main landmark and no skip link | Added |
| 4 | The footer logo's accent colour failed contrast (2.65:1, found by axe in a real browser, not by the jsdom tests) | A lighter accent for the dark footer plus contrast tests |
| 5 | The admin order page showed an empty "Actions" card for a delivered and paid order | Says "No actions left." |
| 6 | The admin menu on a phone was a scrolling bar (owner's feedback) | A slide-in menu with the same links and badges |

Problems in the test rig itself (wrong selectors, duplicate test data, per-hour limits reached by the test) were not product bugs and are not listed.

## Behaviour that looked odd but is by design

- Saved addresses accept any city; the Lahore-only rule is applied when the address is used for an order (business-rules §9, §10).
- Order creation is limited to 10 per hour per visitor address, so several customers behind one shared connection could be slowed down; set `TRUST_PROXY_HEADERS=true` behind a proxy so addresses are seen correctly.
- Anyone who buys something delivered earlier can review a later purchase of the same product only once per purchase.

## Not covered here (must be checked by hand on the real services)

1. **Real Supabase sign-up, login and authenticator-code enrolment** (the run used test-signed tokens).
2. **Real file uploads** to Supabase Storage (product, gallery, custom-order photo, payment screenshot) including the bucket limits.
3. **Real email delivery** (Gmail SMTP or Resend) to an address that is not yours, and the Supabase sign-up emails.
4. **A real phone** (touch, keyboard, camera upload) and a slow mobile connection.
5. **The first deployment**: the content security policy against the live pages, CORS between the real addresses, the scheduled expiry call (`CRON_SECRET`), and `TRUST_PROXY_HEADERS`.

## Recommendations (not blocking)

- **Page weight:** the shop script is 614 kB (169 kB compressed) and the admin 580 kB, each in one file. Splitting by page would make the first visit lighter; worth doing after launch.
- Keep the shop on a backend plan that does not go to sleep, so the first order of the day is not slow.
- Set up a database backup and look at Supabase's own usage and error dashboards weekly in the first month.
- Revisit the order-creation limit once real traffic shows how many customers share addresses.
