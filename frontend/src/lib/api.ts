// Single place for talking to the FastAPI backend.
import { supabase } from './supabase'

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const { data } = await supabase.auth.getSession()
  if (data.session) headers.set('Authorization', `Bearer ${data.session.access_token}`)
  if (init.body) headers.set('Content-Type', 'application/json')

  const res = await fetch(`${BASE_URL}/api${path}`, { ...init, headers })
  if (!res.ok) throw new ApiError(res.status, `Request failed (${res.status})`)
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
