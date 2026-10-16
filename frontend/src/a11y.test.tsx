import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AdminApp from './admin/App'
import { fakeSession, makeAuth } from './test/auth'
import { expectNoA11yViolations } from './test/a11y'
import ShopApp from './shop/App'
import { saveCart } from './lib/cart'
import { saveLastOrder } from './lib/lastOrder'

vi.mock('./lib/supabase', () => ({
  supabase: { auth: { mfa: {} }, storage: { from: () => ({}) } },
}))

// ---- one realistic fake backend ------------------------------------------------------------
const img = { image_id: 'i1', url: 'https://img/1.jpg', alt_text: 'A sunflower', sort_order: 0 }
const summary = {
  product_id: 'p1',
  name: 'Sunflower',
  price_paisa: 125050,
  category: { category_id: 'c1', name: 'Flowers' },
  availability_type: 'READY_TO_SHIP',
  is_available: true,
  is_featured: false,
  image: img,
}
const order = {
  order_id: 'o1',
  status: 'PENDING',
  payment_method: 'COD',
  payment_status: 'PENDING',
  payment_deadline_at: null,
  customer_name: 'Ayesha Khan',
  customer_email: 'a@example.com',
  customer_phone: null,
  delivery_name: 'Ayesha Khan',
  delivery_house_no: '12-B',
  delivery_street_number: null,
  delivery_city: 'Lahore',
  delivery_province: null,
  delivery_postal_code: '54000',
  delivery_country: 'Pakistan',
  items: [
    {
      product_id: 'p1',
      product_name_snapshot: 'Sunflower',
      quantity: 2,
      unit_price_at_purchase_paisa: 125050,
    },
  ],
  subtotal_paisa: 250100,
  delivery_fee_paisa: 20000,
  total_amount_paisa: 270100,
  created_at: '2026-03-05T10:00:00Z',
  cancelled_at: null,
  cancellation_charge_paisa: 0,
  charge_waived: false,
  refund_due_paisa: 0,
  customer_id: 'c9',
  updated_at: '2026-03-05T10:00:00Z',
  payments: [
    {
      payment_id: 'pay1',
      method: 'COD',
      status: 'PENDING',
      amount_paisa: 270100,
      refunded_amount_paisa: 0,
      provider_reference: null,
      created_at: '',
    },
  ],
}
const orderSummary = { ...order, item_count: 2 }
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, page_size: 20 })
const address = {
  address_id: 'a1',
  label: 'Home',
  house_no: '12-B',
  street_number: null,
  city: 'Lahore',
  province: null,
  postal_code: '54000',
  country: 'Pakistan',
  created_at: '2026-01-01T00:00:00Z',
}
const adminProduct = {
  ...summary,
  description: 'Bright',
  images: [img],
  category_id: 'c1',
  stock_quantity: 5,
  max_active_units: 0,
  is_visible: true,
  created_at: '',
  updated_at: '',
}

const ROUTES: [RegExp, unknown][] = [
  [/^\/api\/categories$/, [{ category_id: 'c1', name: 'Flowers' }]],
  [/^\/api\/products\/p1\/reviews\/me$/, { eligible: true, review: null }],
  [
    /^\/api\/products\/p1\/reviews$/,
    {
      items: [
        {
          review_id: 'r1',
          product_id: 'p1',
          rating: 4,
          comment: 'Lovely',
          author: 'Ayesha',
          created_at: '2026-03-05T10:00:00Z',
        },
      ],
      total: 1,
      page: 1,
      page_size: 10,
      average_rating: 4,
      rating_count: 1,
    },
  ],
  [/^\/api\/products\/p1$/, { ...summary, description: 'Bright', images: [img] }],
  [/^\/api\/products$/, page([summary])],
  [
    /^\/api\/gallery$/,
    page([
      {
        gallery_image_id: 'g1',
        url: 'https://img/g.jpg',
        title: 'Studio',
        description: null,
        image_type: 'SHOP',
      },
    ]),
  ],
  [
    /^\/api\/settings$/,
    {
      business_name: 'Bundle of Loops',
      email: null,
      phone: '042 111',
      whatsapp: '+92 300 1234567',
      address: null,
      delivery_information: null,
      delivery_fee_paisa: 20000,
      social_links: { instagram: 'https://instagram.com/x' },
    },
  ],
  [
    /^\/api\/checkout\/quote$/,
    {
      lines: [
        {
          product_id: 'p1',
          quantity: 2,
          name: 'Sunflower',
          unit_price_paisa: 125050,
          line_total_paisa: 250100,
          image: img,
          issue: null,
          max_quantity: null,
        },
      ],
      subtotal_paisa: 250100,
      delivery_fee_paisa: 20000,
      total_paisa: 270100,
      payment_methods: ['COD'],
      can_checkout: true,
    },
  ],
  [
    /^\/api\/customers\/me$/,
    {
      customer_id: 'c9',
      name: 'Ayesha Khan',
      email: 'a@example.com',
      phone: null,
      subscribed_to_updates: true,
      created_at: '2026-01-01T00:00:00Z',
    },
  ],
  [/^\/api\/customers\/me\/addresses$/, [address]],
  [/^\/api\/customers\/me\/wishlist$/, page([summary])],
  [/^\/api\/customers\/me\/wishlist\/ids$/, ['p1']],
  [
    /^\/api\/customers\/me\/notifications$/,
    page([
      {
        notification_id: 'n1',
        type: 'ORDER_PLACED',
        title: 'Order placed',
        message: 'We got it',
        status: 'UNREAD',
        created_at: '2026-03-05T10:00:00Z',
      },
    ]),
  ],
  [/^\/api\/customers\/me\/notifications\/unread-count$/, { unread: 1 }],
  [/^\/api\/custom-orders$/, page([])],
  [
    /^\/api\/custom-orders\/c1$/,
    {
      custom_order_id: 'c1',
      name: 'Sara',
      whatsapp_number: '0300',
      description: 'A jersey',
      budget_paisa: 250000,
      agreed_price_paisa: null,
      required_date: null,
      status: 'IN_DISCUSSION',
      has_reference_image: false,
      created_at: '2026-03-05T10:00:00Z',
      updated_at: '',
    },
  ],
  [
    /^\/api\/custom-orders\/c1\/messages$/,
    [
      {
        message_id: 'm1',
        sender: 'ADMIN',
        body: 'What colour?',
        created_at: '2026-03-06T10:00:00Z',
      },
    ],
  ],
  [/^\/api\/orders\/o1$/, order],
  [/^\/api\/orders$/, page([orderSummary])],
  // admin
  [/^\/api\/admin\/me$/, { id: 'u1', role: 'admin', mfa_required: true, mfa_verified: true }],
  [
    /^\/api\/admin\/dashboard$/,
    {
      orders_by_status: {
        PENDING: 1,
        CONFIRMED: 0,
        PROCESSING: 0,
        SHIPPED: 0,
        DELIVERED: 0,
        CANCELLED: 0,
      },
      orders_needing_action: 1,
      new_messages: 1,
      new_custom_orders: 0,
      low_stock_threshold: 3,
      low_stock_products: [{ product_id: 'p1', name: 'Sunflower', stock_quantity: 1 }],
      recent_orders: [orderSummary],
    },
  ],
  [/^\/api\/admin\/orders\/o1$/, order],
  [/^\/api\/admin\/orders$/, page([orderSummary])],
  [/^\/api\/admin\/products\/p1$/, adminProduct],
  [/^\/api\/admin\/products$/, page([adminProduct])],
  [/^\/api\/admin\/categories$/, [{ category_id: 'c1', name: 'Flowers', product_count: 1 }]],
  [
    /^\/api\/admin\/customers$/,
    page([
      {
        customer_id: 'c9',
        name: 'Ayesha Khan',
        email: 'a@example.com',
        phone: null,
        subscribed_to_updates: true,
        created_at: '2026-01-01T00:00:00Z',
        order_count: 1,
      },
    ]),
  ],
  [
    /^\/api\/admin\/gallery$/,
    page([
      {
        gallery_image_id: 'g1',
        url: 'https://img/g.jpg',
        title: 'Studio',
        description: null,
        image_type: 'SHOP',
        is_visible: true,
        created_at: '',
      },
    ]),
  ],
  [
    /^\/api\/admin\/custom-orders\/c1$/,
    {
      custom_order_id: 'c1',
      name: 'Sara',
      whatsapp_number: '0300',
      description: 'A jersey',
      budget_paisa: 250000,
      agreed_price_paisa: null,
      required_date: null,
      status: 'IN_DISCUSSION',
      has_reference_image: false,
      created_at: '2026-03-05T10:00:00Z',
      updated_at: '',
      customer_id: 'c9',
      reference_image_url: null,
    },
  ],
  [
    /^\/api\/admin\/custom-orders\/c1\/messages$/,
    [{ message_id: 'm1', sender: 'CUSTOMER', body: 'Blush?', created_at: '2026-03-06T10:00:00Z' }],
  ],
  [
    /^\/api\/admin\/custom-orders$/,
    page([
      {
        custom_order_id: 'c1',
        name: 'Sara',
        whatsapp_number: '0300',
        description: 'A jersey',
        budget_paisa: 250000,
        required_date: null,
        status: 'NEW',
        has_reference_image: false,
        created_at: '2026-03-05T10:00:00Z',
        updated_at: '',
        customer_id: null,
        reference_image_url: null,
      },
    ]),
  ],
  [
    /^\/api\/admin\/messages$/,
    page([
      {
        message_id: 'm1',
        name: 'Sara',
        email: 'sara@example.com',
        phone: null,
        whatsapp_number: '0300 1234567',
        message: 'Hello',
        status: 'NEW',
        created_at: '2026-03-05T10:00:00Z',
      },
    ]),
  ],
  [
    /^\/api\/admin\/reviews$/,
    page([
      {
        review_id: 'r1',
        product_id: 'p1',
        rating: 2,
        comment: 'Meh',
        author: 'Ayesha',
        created_at: '2026-03-05T10:00:00Z',
        customer_id: 'c9',
        customer_name: 'Ayesha Khan',
        order_id: 'o1',
        product_name_snapshot: 'Sunflower',
      },
    ]),
  ],
  [
    /^\/api\/admin\/audit-log$/,
    page([
      {
        audit_id: 'a1',
        user_id: '12345678-aaaa-bbbb-cccc-1234567890ab',
        action: 'POST /api/admin/orders/{id}/cancel',
        path: '/x',
        status_code: 200,
        ip: '1.2.3.4',
        created_at: '2026-03-05T10:00:00Z',
      },
    ]),
  ],
  [
    /^\/api\/admin\/settings$/,
    {
      business_name: 'Bundle of Loops',
      email: null,
      phone: null,
      whatsapp: null,
      address: null,
      delivery_information: null,
      delivery_fee_paisa: 20000,
      social_links: {},
      updated_at: 'x',
    },
  ],
]

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), 'http://x').pathname
      const hit = ROUTES.find(([re]) => re.test(path))
      return hit
        ? new Response(JSON.stringify(hit[1]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response('{"detail":"nope"}', { status: 404 })
    }),
  )
  saveCart([{ product_id: 'p1', quantity: 2 }])
  saveLastOrder({ ...order, items: order.items } as never)
})
afterEach(() => vi.unstubAllGlobals())

const SIGNED_OUT = [
  '/',
  '/shop',
  '/shop/p1',
  '/cart',
  '/gallery',
  '/custom-order',
  '/contact',
  '/login',
  '/register',
  '/unsubscribe?token=abcdefghijklmnop',
  '/order-confirmation',
  '/nonexistent',
]
const SIGNED_IN = [
  '/account',
  '/account/addresses',
  '/wishlist',
  '/orders',
  '/orders/o1',
  '/notifications',
  '/custom-orders',
  '/custom-orders/c1',
  '/checkout',
]
const ADMIN = [
  '/',
  '/orders',
  '/orders/o1',
  '/products',
  '/products/new',
  '/products/p1',
  '/categories',
  '/customers',
  '/gallery',
  '/custom-orders',
  '/custom-orders/c1',
  '/messages',
  '/reviews',
  '/activity',
  '/settings',
]

async function checkPage(App: () => React.ReactElement, path: string, signedIn: boolean) {
  const { wrap } = makeAuth(signedIn ? { session: fakeSession } : {})
  const { container, unmount } = render(wrap(<App />, path))
  // wait until the page has finished loading its data
  await waitFor(
    () =>
      expect(
        screen.queryByText(/^(Loading…|Checking access…|Checking your payment…)$/),
      ).not.toBeInTheDocument(),
    { timeout: 3000 },
  )
  await expectNoA11yViolations(container)
  unmount()
}

it.each(SIGNED_OUT)('shop %s (signed out) has no accessibility violations', async (path) => {
  await checkPage(ShopApp, path, false)
})
it.each(SIGNED_IN)('shop %s (signed in) has no accessibility violations', async (path) => {
  await checkPage(ShopApp, path, true)
})
it.each(ADMIN)('admin %s has no accessibility violations', async (path) => {
  await checkPage(AdminApp, path, true)
})
it('the admin login page has no accessibility violations', async () => {
  await checkPage(AdminApp, '/login', false)
})

// The sliding panels are dialogs on top of the page: check them open, for both kinds of shopper.
it.each([
  ['Bag, 2 items', 'Your bag'],
  ['Wishlist', 'Wishlist'],
  ['Search', 'Search'],
])('the %s panel has no accessibility violations when open', async (button, title) => {
  const { wrap } = makeAuth({ session: fakeSession })
  const { container, unmount } = render(wrap(<ShopApp />, '/'))
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${button}`) }))
  const dialog = await screen.findByRole('dialog', { name: title })
  await waitFor(() => expect(screen.queryByText(/^(Loading…|Searching…)$/)).not.toBeInTheDocument())
  await expectNoA11yViolations(container)
  expect(dialog).toBeInTheDocument()
  unmount()
})
