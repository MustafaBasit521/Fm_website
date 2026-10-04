# Crochet Shop — Business Rules

This document is the **authoritative source for business behavior**.

---

## 1. Product Rules

Each product has:

* name
* category
* description
* price
* availability type
* stock quantity
* maximum active units (made-to-order capacity)
* shop visibility
* homepage featured status
* product images

### Availability Types

Products can be:

* `READY_TO_SHIP`
* `MADE_TO_ORDER`

### Ready-to-Ship

For ready-to-ship products:

* stock quantity is tracked
* quantity cannot be negative
* when stock reaches zero, the product is unavailable
* customers cannot purchase more units than available stock

### Made-to-Order

Made-to-order products have a maximum active capacity (`max_active_units`).

Capacity is measured in **units**, not number of orders.

Active statuses consuming capacity:

* Pending
* Confirmed
* Processing

Statuses that no longer consume capacity:

* Shipped
* Delivered
* Cancelled

When active units reach the configured maximum, the product becomes unavailable for new purchases.

The availability type of a product cannot be changed while orders containing it are Pending, Confirmed or Processing (stock and capacity are reserved and released according to the type, so changing it mid-order would misplace them). Other edits are always allowed.

---

# 2. Product Visibility

Admin can:

* show product in shop
* hide product from shop
* feature product on homepage
* remove homepage feature

A hidden product should not be purchasable through the normal storefront.

New products are created hidden; the admin publishes them. The public catalog never returns a hidden product, and a hidden product looks exactly like a product that does not exist.

---

# 3. Product Deletion

Admin may permanently delete a product.

Historical orders must remain understandable after deletion.

Therefore:

* order items retain product name snapshot
* order items retain purchase price snapshot
* product foreign key on order items is nullable
* deleting a product must not destroy historical order information
* reviews of the product are kept; they retain a product name snapshot
* product image metadata is deleted, and the corresponding files in Supabase Storage must also be deleted

---

# 4. Categories

Initial categories:

1. Flowers
2. Amigurumi
3. House/Home Decor
4. Key Chains
5. Accessories
6. Custom

Category names are unique.

A category cannot be deleted while products are assigned to it.

Products must first be reassigned before deleting the category.

---

# 5. Money

All monetary values are stored as integer minor units/paisa.

Example:

Rs 1250.50 = `125050`

Never use floating-point values for money.

---

# 6. Customer Accounts

Guest checkout is allowed.

Registered customers have:

* name
* email
* phone
* saved addresses
* order history
* wishlist

Authentication is handled by Supabase Auth.

The application does not store passwords.

The customer's application ID corresponds to the Supabase Auth user ID.

The customer record is created automatically the first time an authenticated user calls the API. Its name and email come from the verified login token, and the customer is subscribed to updates (§7).

---

# 7. Account Creation

Creating a customer account automatically subscribes the customer to shop updates.

Customers remain subscribed unless they later unsubscribe.

Customers should be able to unsubscribe through a future notification preference mechanism.

---

# 8. Customer Account Deletion

Customers may request/delete their account.

Account deletion must not accidentally destroy historical business records such as completed orders.

When a customer account is deleted:

* the customer's orders are kept; their link to the customer is removed, and the order snapshots keep them meaningful
* the customer's custom-order records are kept; their link to the customer is removed
* the customer's reviews are kept; their link to the customer is removed
* saved addresses, wishlist items and in-app notifications (non-historical data) are deleted

The exact anonymization/retention strategy should be implemented deliberately rather than deleting historical order data blindly.

---

# 9. Addresses

Customers can maintain multiple saved addresses.

Address fields:

* label
* house number
* street number
* city
* province
* postal code
* country

Required:

* house number
* city
* postal code
* country

Optional:

* street number
* province
* label

Example labels:

* Home
* Office

Saved addresses may be in any city; the Lahore-only rule (§10) is enforced when an address is used for an order. A customer may keep at most 20 saved addresses (a technical abuse guard, not a business rule).

---

# 10. Lahore Delivery Restriction

The MVP supports delivery only within Lahore.

Checkout uses a controlled/canonical city value of `Lahore` rather than allowing arbitrary city values.

The restriction must be enforced server-side. The backend must independently validate Lahore, because frontend validation is not a security boundary.

Checkout must reject addresses outside Lahore.

Do not introduce a complex geographic delivery-zone system for the MVP.

The rule is applied at checkout and whenever an order's delivery address is changed (by the customer or the admin), for both typed-in and saved addresses. The city is compared ignoring case and extra spaces and is stored as `Lahore`.

---

# 11. Cart

The MVP uses a client-side/browser cart, for guests and authenticated users.

There are no `carts` or `cart_items` database tables in the MVP.

At checkout, the backend must revalidate:

* product existence
* product visibility/purchasability
* current price
* requested quantity
* ready-to-ship stock
* made-to-order capacity
* Lahore delivery eligibility
* delivery fee
* final order total

Frontend-calculated totals are never authoritative.

A server-side cart may be introduced later only if a concrete requirement appears, such as cross-device persistence or abandoned-cart functionality.

The browser cart holds only product ids and quantities (at most 99 units per line and 50 lines). `POST /api/checkout/quote` returns the authoritative lines, availability problems, delivery fee and total for it. An order request may include the total the customer saw; if the real total differs, the order is not created and the customer reviews the new total.

---

# 12. Delivery Fee

Delivery fee is configurable through business settings.

Final calculation:

`subtotal + delivery_fee = total`

The backend determines the authoritative total.

The delivery fee is stored in the single business-settings record, which is seeded with Rs 200 (20000 paisa). Until the admin UI exists, it is changed with SQL.

---

# 13. Inventory Reservation and the Online Payment Window

## Reservation

Ready-to-ship stock and made-to-order capacity are reserved when the order is successfully created.

Purpose:

* prevent overselling
* safely handle concurrent orders

Inventory must never become negative.

Backend/database transaction handling must prevent race conditions during reservation and release.

## Online orders

Online orders have a temporary **30-minute payment window**.

When an online order is created:

* Order status = Pending
* Payment status = Pending
* ready-to-ship stock or made-to-order capacity is reserved
* `payment_deadline_at` is set to 30 minutes after order creation

During the 30-minute window, the customer can retry online payment.

If payment succeeds (verified by the backend):

* Payment = Paid
* Order = Confirmed

An online order **must not** become Confirmed unless its payment has been successfully verified as Paid.

If the 30-minute window expires without a successful payment:

* Order = Cancelled
* the reservation is released
* ready-to-ship stock is returned
* made-to-order active capacity is released

Expired unpaid online orders must be cleaned up automatically.

Expiry mechanism (decided): the database function `expire_unpaid_online_orders()` cancels expired unpaid online orders and returns their stock; it is scheduled every minute with Supabase pg_cron. The API also runs the same function just before reserving stock for a new order, so correctness does not depend on the schedule. Online payment stays disabled (`ONLINE_PAYMENTS_ENABLED=false`) until a payment gateway is integrated, so no customer places an order they cannot pay for.

Late payment (decided): if a verified payment arrives after the window has closed — whether the expiry job has already cancelled the order or has not run yet — the order stays Cancelled and is never reopened. The payment is recorded as Paid and the full amount is refundable (no cancellation charge).

## COD orders

COD orders do **not** use the 30-minute online payment window.

COD orders keep their reservation while the order is active.

---

# 14. Orders

Order statuses:

* Pending
* Confirmed
* Processing
* Shipped
* Delivered
* Cancelled

Normal lifecycle:

`Pending → Confirmed → Processing → Shipped → Delivered`

Cancellation is a terminal state:

`Cancelled`

Cancelled orders cannot return to an active order status.

Who changes order status:

* The admin manages status changes during normal order management.
* The system automatically sets an online order to Confirmed when its payment is verified as Paid (§13).
* The system automatically sets an online order to Cancelled when its payment window expires without payment (§13).
* A registered customer may cancel within the rules in §15.

Status changes by the admin move strictly one step forward (Pending → Confirmed → Processing → Shipped → Delivered). An online order cannot be Confirmed until its payment is Paid. Cancelling uses the separate cancel action, never a status change.

---

# 15. Customer Cancellation

## Registered customers

A registered customer can cancel their own order through the website only while it is:

* Pending
* Confirmed

From Processing onwards, the customer cannot cancel through the website. A cancellation during Processing is performed by the admin and is subject to the cancellation charge in §18.

Decided: there is no "request cancellation" button. The customer contacts the shop (WhatsApp/contact channel) and the admin cancels the order.

Once Shipped or Delivered, the order cannot be cancelled.

## Guest customers

Guest customers do **not** cancel orders through the website.

They must contact the business through the available WhatsApp/contact channel.

The admin can process an eligible request after verification, applying the same status rules.

---

# 16. Address Changes

## Registered customers

A registered customer may change the delivery address only while the order is:

* Pending
* Confirmed

Once Processing starts, the customer cannot change the delivery address.

No address changes are allowed once the order is:

* Shipped
* Delivered
* Cancelled

## Guest customers

Guest customers do **not** modify addresses through the website.

They must contact the business through the available WhatsApp/contact channel. The admin can process an eligible request after verification, applying the same status rules.

The admin changes a guest's address with the same status rules (Pending/Confirmed only) and the same Lahore-only validation. When no new recipient name is given, the existing one is kept.

## Snapshot

The order stores a snapshot of the delivery address so historical orders remain accurate even if the customer later changes their saved address.

---

# 17. Product/Quantity Changes After Ordering

After an order is placed:

* customer cannot change products
* customer cannot change quantities

The customer must cancel/reorder according to the applicable cancellation rules.

---

# 18. Processing Cancellation Charge

If an order is cancelled during Processing:

* default cancellation charge = **50% of the original total order amount**
* the original total includes the delivery fee, so the charge is based on `subtotal + delivery_fee`

The admin may waive the charge.

Rounding (decided): the charge is the total multiplied by one half, rounded down to a whole paisa (e.g. 20101 → 10050). The charge and whether it was waived are recorded on the order. The amount still owed back to the customer (paid − charge − already refunded) is shown on the order; actually refunding it belongs to the payments phase.

## Online payment

`refund = amount already paid − applicable cancellation charge`

If the admin waives the charge, the full applicable paid amount is refunded.

The refund amount must never become negative.

## COD

If a COD order is cancelled during Processing before payment has been collected:

* the cancellation charge is waived
* there is no refund, because no payment was collected

---

# 19. Inventory and Capacity Release on Cancellation

When an order is cancelled — including automatic cancellation after an expired online-payment window:

* ready-to-ship reserved quantity is released back to stock
* made-to-order reserved units are released from active capacity

Stock release is implemented once, by the database function `release_order_stock()`, which both cancellation and automatic expiry use. Made-to-order capacity is derived from active orders, so cancelling an order frees it automatically.

---

# 20. Payments

Payment methods:

* COD
* ONLINE

Payment status:

* Pending
* Paid
* Partially Refunded
* Refunded
* Failed (an online attempt that did not succeed; see below)

Order status and payment status are separate concepts.

## COD payment

* Payment remains Pending during the order lifecycle.
* When the order is Delivered and the admin confirms the COD payment was received, Payment becomes Paid.

## Online payment

* Payment is Pending until the backend verifies a successful payment with the provider.
* A failed payment attempt does not cancel the order; the customer may retry within the 30-minute window (§13).
* On verified success: Payment = Paid, Order = Confirmed.

Each online attempt is its own payment record, so failed tries stay in the history. A new attempt can start only when the previous one has failed; if an earlier attempt may still be open, the backend first asks the provider about it, and the customer must finish it or wait. If that earlier attempt turns out to be paid, the order is confirmed instead of charging twice. A failed attempt never cancels the order; an order whose attempts all failed still expires when its window ends.

Paying is possible for guests as well as registered customers: the unguessable order id identifies the order, and only the provider's verified answer ever changes anything.

COD: when the order is Delivered, the admin confirms the cash was received and the COD payment becomes Paid. This is not possible before delivery.

---

# 21. Payment Verification

The frontend is never authoritative for payment success.

The backend must verify payment through the payment provider.

Payment callbacks/webhooks must be:

* authenticated/validated where supported
* safely processed
* idempotent where appropriate

Do not mark an order as Paid merely because the frontend reports success.

Implementation: a webhook is authenticated by its signature, but its body is only used to find which attempt it concerns. The backend then asks the provider for the real status and amount (`verify`) and changes state only from that answer. A payment whose amount differs from the order's payment is never accepted. Repeated or simultaneous notifications are harmless (processing is idempotent and serialized by the order lock). If the provider cannot be reached, the webhook fails with a retryable error so the provider tries again. When the customer returns from the gateway, the page asks the backend to verify; it never trusts the browser.

---

# 22. Payment Refunds

For online payments:

If a Processing cancellation has a charge:

`refund = amount paid − cancellation charge`

If admin waives the charge:

`refund = amount paid`

The refunded amount is recorded on the payment and can never exceed the original payment amount.

Refunds are started by the admin, only for cancelled orders, and never exceed what is still owed (paid − cancellation charge − already refunded). The admin may refund in several steps (partial refunds). The payment becomes Refunded when the whole payment has been returned; if a cancellation charge is kept it stays Partially Refunded. The provider is called with an idempotency key, so a repeated request cannot refund twice, and if the provider fails nothing is changed and the refund can be retried.

Payment state may become:

* Partially Refunded
* Refunded

depending on the amount returned.

---

# 23. Order Historical Integrity

Order history must remain understandable even when:

* a product is deleted
* a customer changes their address
* a customer changes profile information
* a customer deletes their account

Orders therefore retain necessary snapshots such as:

* customer name
* customer email
* customer phone
* delivery address
* product name
* purchase price

---

# 24. Guest Orders

Guest orders have:

* `customer_id = NULL`

The order still stores:

* customer name
* email
* phone
* delivery information

Guest checkout does not require account creation.

Guests cannot cancel or modify orders through the website; see §15 and §16.

Guests have no website order lookup. The confirmation shown right after checkout is kept only in that browser tab; later requests go through the shop and the admin.

---

# 25. Wishlist

Only registered customers may use the wishlist.

A customer may have multiple wishlist items but cannot add the same product twice.

A wishlist item can be moved to the cart.

Adding a product that is already on the wishlist returns a conflict. Hidden products cannot be added and are not shown in the wishlist (their rows are kept, so they reappear if the admin shows the product again). Moving an item to the cart adds the product to the browser cart.

The wishlist uses a simple customer/product relationship.

---

# 26. Reviews

A customer can review a product only if:

* they purchased that product
* the relevant order reached **Delivered** status

Only one review per customer per product is allowed.

Rating must be from 1 to 5.

A review contains:

* customer
* product
* order
* rating
* comment
* creation timestamp

The backend must enforce review eligibility. Frontend checks alone are insufficient.

Decided: a customer may edit and delete their own review (deleting lets them review again), and the admin may remove any review. Eligibility is a Delivered order of that customer containing the product (guest orders never qualify); the most recent such order is recorded on the review. The product must be visible to be reviewed. Publicly a review shows the rating, comment, date and the customer's first name only ("Former customer" after account deletion), plus the product's average rating and count. Reviews are kept when a product or customer is deleted; the product name is snapshotted.

---

# 27. Search

Product search supports:

* product name
* category

Filters:

* category
* price
* availability

Sorting:

* price low to high
* price high to low

Large result sets should use pagination.

Implemented: case-insensitive matching on product name and description; filters for category, type (ready-to-ship / made-to-order), available-only, featured and price range; sorting by newest, price low to high, price high to low, and name; pagination (at most 50 per page publicly).

---

# 28. Gallery

Admin can upload gallery images.

Gallery image types include:

* available in shop
* designs only
* making/behind the scenes
* customer photos
* other

Gallery images are stored in Supabase Storage.

Database records store image metadata/reference paths.

Uploads use a signed URL (CLAUDE.md §10) into the public `gallery-images` bucket; the server generates the file path. New images start hidden until the admin publishes them. The public gallery shows only visible images and can be filtered by type; the admin can edit, hide/show and delete (the file is removed too).

---

# 29. Custom Orders

Custom orders are separate from normal product orders.

Customer submits:

* name
* WhatsApp number
* description
* budget
* required date
* reference image
* relevant quantity/details inside description

`customer_id` may be null for guest submissions.

Guest reference-image uploads are protected by rate limiting/abuse protection.

Custom-order workflow is separate from the normal order lifecycle.

Communication may occur through:

* WhatsApp
* email

The exact custom-order statuses will be finalized when this feature is implemented.

Statuses (decided): NEW → IN_DISCUSSION → ACCEPTED → IN_PROGRESS → COMPLETED, plus DECLINED (the shop cannot do it) and CANCELLED. The admin moves a request only along these steps: NEW to IN_DISCUSSION, DECLINED or CANCELLED; IN_DISCUSSION to ACCEPTED, DECLINED or CANCELLED; ACCEPTED to IN_PROGRESS or CANCELLED; IN_PROGRESS to COMPLETED or CANCELLED. COMPLETED, DECLINED and CANCELLED are final. A registered customer may cancel their own request only while it is NEW or IN_DISCUSSION; later they contact the shop.

A guest needs no account. The reference image goes into the **private** `custom-order-references` bucket by signed URL and is shown to the admin only through a short-lived signed link. Submissions and image uploads are rate limited per client (5 requests and 10 uploads per hour). The required date cannot be in the past and the budget is optional. Custom orders store no email address: guests are reached on WhatsApp, and registered customers are also notified in the app and by email at their account address.

---

# 30. Contact Messages

Contact messages contain:

* name
* email
* phone
* WhatsApp number
* message

Statuses:

* New
* Read
* Replied
* Archived

Admin manages these messages.

A message must include at least one way to reply (email, phone or WhatsApp number). The form is rate limited per client (5 per hour). The admin can list, search and filter messages and set any status; opening a message does not change its status. The shop is alerted by email at the business-settings email address, when one is set.

---

# 31. Notifications

The application supports in-app notification records.

Possible notification events:

* order placed
* order confirmed
* order status changed
* order shipped
* order delivered
* payment success
* payment failure
* new product
* custom-order update

Email delivery is handled separately by an external email service.

Notifications are not email delivery logs.

Decided: a notification is UNREAD until the customer opens it (one at a time or all at once). In-app notifications exist for registered customers only; guests are reached by email at the address they gave. Implemented events: order placed, order confirmed, status changed (processing, cancelled), shipped, delivered, payment success, payment failure and custom-order updates; each notification is saved in the same transaction as the change that caused it. An order cancelled by the automatic payment-window expiry does not yet send a notification.

NEW_PRODUCT (implemented in Phase 9): when the admin publishes a product (it is created visible, or changed from hidden to visible), every customer subscribed to shop updates gets an in-app notification ("New in the shop"). Customers who unsubscribed get nothing. It is in-app only: a mass email needs the unchosen email provider and an unsubscribe flow. Hiding or editing a product announces nothing; showing it again announces it again.

Email: the service provider is still to be chosen, so emails are built behind a provider interface (default: send nothing; a development option logs them). Emails are queued while a change is built and sent only after the database commit succeeds, in the background; a mail problem never breaks an order. Customers get emails for the order and payment events above (guests too); the shop gets an alert for each new order, custom order and contact message.

---

# 32. Admin

The initial system has one admin.

Admin can manage:

* dashboard
* products
* categories
* orders
* customers
* gallery
* custom orders
* messages
* business settings
* refunds/cancellations

Multiple admin roles are intentionally out of MVP scope.

Implementation: the admin screens live at `/admin` in the web app and are shown only to the account whose server-controlled `app_metadata` role is `admin`; every admin request is authorized by the backend, so the screens are a convenience, not the security boundary. Contents:

* **Dashboard:** orders needing action (Pending cash-on-delivery orders to confirm, and Confirmed orders to start preparing), orders by status, new messages, new custom-order requests, products running low (ready-to-ship, 3 or fewer left) and the five most recent orders. No sales analytics (out of scope).
* **Products and categories:** create, edit, show/hide, feature, delete, pictures; categories with product counts (a category with products cannot be deleted).
* **Orders and refunds/cancellations:** list with filters; the order page moves the order one step at a time, cancels (with the Processing charge and the option to waive it), confirms cash received for delivered COD orders, refunds in full or in part, and changes the address of Pending/Confirmed orders.
* **Customers:** view only: profile, subscription, order and custom-request counts, recent orders. The admin cannot edit or delete customers (the account-deletion strategy is still an open decision).
* **Gallery, custom orders, messages, reviews:** as described in §26 and §28–30.

---

# 33. Business Settings

Admin can configure business information such as:

* business name
* email
* phone
* WhatsApp
* address
* delivery information
* delivery fee
* social links

Decided: the settings screen offers exactly these fields and nothing else (the mockup's holiday mode and payment-method switches are not part of the MVP rules). The delivery fee is entered in rupees and stored in paisa (0 to Rs 100,000) and applies to new quotes and orders only; existing orders keep the fee they were placed with. Social links are `https://` addresses only (at most ten), because they become links on the storefront. The shop details (name, email, phone, WhatsApp, address, delivery information, fee, social links) are readable by everyone through `GET /api/settings` and shown on the contact page; the business email is also where the shop's alert emails go.

---

# 34. Future Scope

Not part of current MVP:

* AI chatbot
* recommendation engine
* WhatsApp automation
* loyalty system
* coupons
* gift cards
* analytics platform
* abandoned carts
* server-side cart
* multilingual support
* multi-currency
* outside-Lahore delivery
* multiple admin roles
* microservices
* Kubernetes
* Redis
* message brokers

These should only be introduced after a concrete business/technical requirement exists.
