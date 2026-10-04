// Single place for talking to the FastAPI backend.
import { supabase } from './supabase'

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  readonly status: number
  /** The server's `detail` (a string, or an object such as { code, message, ... }). */
  readonly detail: unknown
  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }

  /** Machine-readable error code from structured errors, e.g. CHECKOUT_INVALID. */
  get code(): string | undefined {
    const d = this.detail
    return typeof d === 'object' && d !== null && 'code' in d
      ? String((d as { code: unknown }).code)
      : undefined
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const { data } = await supabase.auth.getSession()
  if (data.session) headers.set('Authorization', `Bearer ${data.session.access_token}`)
  if (init.body) headers.set('Content-Type', 'application/json')

  const res = await fetch(`${BASE_URL}/api${path}`, { ...init, headers })
  if (!res.ok) {
    let detail: unknown
    try {
      detail = ((await res.json()) as { detail?: unknown }).detail
    } catch {
      detail = undefined
    }
    throw new ApiError(res.status, `Request failed (${res.status})`, detail)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const apiGet = <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal })

export const apiPost = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const apiDelete = (path: string) => request<void>(path, { method: 'DELETE' })

export const apiPatch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })

export interface HealthResponse {
  status: string
}

export const getHealth = (signal?: AbortSignal) => apiGet<HealthResponse>('/health', signal)

export interface Customer {
  customer_id: string
  name: string
  email: string
  phone: string | null
  subscribed_to_updates: boolean
  created_at: string
}

export type CustomerUpdate = Partial<Pick<Customer, 'name' | 'phone' | 'subscribed_to_updates'>>

export const getMe = (signal?: AbortSignal) => apiGet<Customer>('/customers/me', signal)
export const updateMe = (data: CustomerUpdate) => apiPatch<Customer>('/customers/me', data)

// ---- catalog ------------------------------------------------------------------------------

export type Availability = 'READY_TO_SHIP' | 'MADE_TO_ORDER'
export type SortKey = 'newest' | 'price_asc' | 'price_desc' | 'name'

export interface Category {
  category_id: string
  name: string
}

export interface ProductImage {
  image_id: string
  url: string
  alt_text: string | null
  sort_order: number
}

export interface ProductSummary {
  product_id: string
  name: string
  price_paisa: number
  category: Category
  availability_type: Availability
  is_available: boolean
  is_featured: boolean
  image: ProductImage | null
}

export interface ProductDetail extends ProductSummary {
  description: string | null
  images: ProductImage[]
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export const getCategories = (signal?: AbortSignal) => apiGet<Category[]>('/categories', signal)

export const getProducts = (query: URLSearchParams, signal?: AbortSignal) =>
  apiGet<Page<ProductSummary>>(`/products?${query.toString()}`, signal)

export const getProduct = (id: string, signal?: AbortSignal) =>
  apiGet<ProductDetail>(`/products/${encodeURIComponent(id)}`, signal)

// ---- addresses ----------------------------------------------------------------------------

export interface Address {
  address_id: string
  label: string | null
  house_no: string
  street_number: string | null
  city: string
  province: string | null
  postal_code: string
  country: string
  created_at: string
}

export type AddressInput = Omit<Address, 'address_id' | 'created_at'>

export const getAddresses = (signal?: AbortSignal) =>
  apiGet<Address[]>('/customers/me/addresses', signal)
export const createAddress = (data: AddressInput) =>
  apiPost<Address>('/customers/me/addresses', data)
export const updateAddress = (id: string, data: Partial<AddressInput>) =>
  apiPatch<Address>(`/customers/me/addresses/${encodeURIComponent(id)}`, data)
export const deleteAddress = (id: string) =>
  apiDelete(`/customers/me/addresses/${encodeURIComponent(id)}`)

// ---- wishlist -----------------------------------------------------------------------------

export const getWishlist = (page: number, signal?: AbortSignal) =>
  apiGet<Page<ProductSummary>>(`/customers/me/wishlist?page=${page}&page_size=12`, signal)
export const getWishlistIds = (signal?: AbortSignal) =>
  apiGet<string[]>('/customers/me/wishlist/ids', signal)
export const addToWishlist = (productId: string) =>
  apiPost<{ product_id: string }>('/customers/me/wishlist', { product_id: productId })
export const removeFromWishlist = (productId: string) =>
  apiDelete(`/customers/me/wishlist/${encodeURIComponent(productId)}`)

// ---- cart, checkout, orders ---------------------------------------------------------------

export type PaymentMethod = 'COD' | 'ONLINE'
export type LineIssue = 'NOT_FOUND' | 'UNAVAILABLE' | 'EXCEEDS_AVAILABLE'

export interface CartLine {
  product_id: string
  quantity: number
}

export interface QuoteLine {
  product_id: string
  quantity: number
  name: string | null
  unit_price_paisa: number | null
  line_total_paisa: number | null
  image: ProductImage | null
  issue: LineIssue | null
  max_quantity: number | null
}

export interface Quote {
  lines: QuoteLine[]
  subtotal_paisa: number
  delivery_fee_paisa: number
  total_paisa: number
  payment_methods: PaymentMethod[]
  can_checkout: boolean
}

export const getQuote = (items: CartLine[], signal?: AbortSignal) =>
  request<Quote>('/checkout/quote', {
    method: 'POST',
    body: JSON.stringify({ items }),
    signal,
  })

export interface CheckoutAddress {
  label?: null
  house_no: string
  street_number: string | null
  city: string
  province: string | null
  postal_code: string
  country: string
}

export interface OrderRequest {
  items: CartLine[]
  contact: { name: string; email: string; phone: string | null }
  delivery: { recipient_name?: string | null; address_id?: string; address?: CheckoutAddress }
  payment_method: PaymentMethod
  expected_total_paisa?: number
}

export interface Order {
  order_id: string
  status: string
  payment_method: PaymentMethod
  payment_status: string
  payment_deadline_at: string | null
  customer_name: string
  customer_email: string
  customer_phone: string | null
  delivery_name: string
  delivery_house_no: string
  delivery_street_number: string | null
  delivery_city: string
  delivery_province: string | null
  delivery_postal_code: string
  delivery_country: string
  items: {
    product_id: string | null
    product_name_snapshot: string
    quantity: number
    unit_price_at_purchase_paisa: number
  }[]
  subtotal_paisa: number
  delivery_fee_paisa: number
  total_amount_paisa: number
  created_at: string
}

export const createOrder = (data: OrderRequest) => apiPost<Order>('/orders', data)
