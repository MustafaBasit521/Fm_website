// Typed client for the admin endpoints. Every call needs an admin login; the backend enforces
// that (frontend route guards are only a convenience).
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  type Address,
  type CheckoutAddress,
  type Customer,
  type CustomOrder,
  type GalleryImageType,
  type CustomOrderStatus,
  type Order,
  type Page,
  type ProductDetail,
  type Review,
  type UploadTarget,
} from './api'

const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v))
  const s = q.toString()
  return s ? `?${s}` : ''
}
const id = encodeURIComponent

export const getAdminMe = (signal?: AbortSignal) =>
  apiGet<{ id: string; role: string }>('/admin/me', signal)

// ---- dashboard ----------------------------------------------------------------------------

export interface AdminOrderSummary {
  order_id: string
  status: string
  payment_method: 'COD' | 'ONLINE'
  payment_status: string
  total_amount_paisa: number
  item_count: number
  payment_deadline_at: string | null
  created_at: string
  customer_name: string
  customer_email: string
}

export interface Dashboard {
  orders_by_status: Record<string, number>
  orders_needing_action: number
  new_messages: number
  new_custom_orders: number
  low_stock_threshold: number
  low_stock_products: { product_id: string; name: string; stock_quantity: number }[]
  recent_orders: AdminOrderSummary[]
}

export const getDashboard = (signal?: AbortSignal) => apiGet<Dashboard>('/admin/dashboard', signal)

// ---- orders -------------------------------------------------------------------------------

export interface AdminPayment {
  payment_id: string
  method: 'COD' | 'ONLINE'
  status: string
  amount_paisa: number
  refunded_amount_paisa: number
  provider_reference: string | null
  created_at: string
}

export interface AdminOrder extends Order {
  customer_id: string | null
  updated_at: string
  payments: AdminPayment[]
}

export const getAdminOrders = (
  filters: { status?: string; payment_method?: string; search?: string; page?: number },
  signal?: AbortSignal,
) => apiGet<Page<AdminOrderSummary>>(`/admin/orders${qs({ ...filters, page_size: 20 })}`, signal)
export const getAdminOrder = (orderId: string, signal?: AbortSignal) =>
  apiGet<AdminOrder>(`/admin/orders/${id(orderId)}`, signal)
export const setOrderStatus = (orderId: string, status: string) =>
  apiPost<AdminOrder>(`/admin/orders/${id(orderId)}/status`, { status })
export const cancelAdminOrder = (orderId: string, waiveCharge: boolean) =>
  apiPost<AdminOrder>(`/admin/orders/${id(orderId)}/cancel`, { waive_charge: waiveCharge })
export const refundOrder = (orderId: string, amountPaisa: number | null) =>
  apiPost<AdminOrder>(
    `/admin/orders/${id(orderId)}/refund`,
    amountPaisa === null ? {} : { amount_paisa: amountPaisa },
  )
export const confirmCodPayment = (orderId: string) =>
  apiPost<AdminOrder>(`/admin/orders/${id(orderId)}/confirm-cod-payment`, {})
export const changeAdminOrderAddress = (
  orderId: string,
  delivery: { recipient_name?: string | null; address: CheckoutAddress },
) => apiPatch<AdminOrder>(`/admin/orders/${id(orderId)}/address`, delivery)

// ---- products and categories --------------------------------------------------------------

export interface AdminProduct extends ProductDetail {
  category_id: string
  stock_quantity: number
  max_active_units: number
  is_visible: boolean
  created_at: string
  updated_at: string
}

export interface ProductWrite {
  category_id: string
  name: string
  description: string | null
  price_paisa: number
  availability_type: 'READY_TO_SHIP' | 'MADE_TO_ORDER'
  stock_quantity: number
  max_active_units: number
  is_visible: boolean
  is_featured: boolean
}

export const getAdminProducts = (
  filters: { search?: string; category_id?: string; availability?: string; page?: number },
  signal?: AbortSignal,
) => apiGet<Page<AdminProduct>>(`/admin/products${qs({ ...filters, page_size: 20 })}`, signal)
export const getAdminProduct = (productId: string, signal?: AbortSignal) =>
  apiGet<AdminProduct>(`/admin/products/${id(productId)}`, signal)
export const createProduct = (data: ProductWrite) => apiPost<AdminProduct>('/admin/products', data)
export const updateProduct = (productId: string, data: Partial<ProductWrite>) =>
  apiPatch<AdminProduct>(`/admin/products/${id(productId)}`, data)
export const deleteProduct = (productId: string) => apiDelete(`/admin/products/${id(productId)}`)

export const getProductImageUpload = (productId: string, contentType: string) =>
  apiPost<UploadTarget>(`/admin/products/${id(productId)}/images/upload-url`, {
    content_type: contentType,
  })
export const registerProductImage = (
  productId: string,
  data: { storage_path: string; alt_text?: string | null; sort_order?: number },
) => apiPost<{ image_id: string }>(`/admin/products/${id(productId)}/images`, data)
export const updateProductImage = (
  productId: string,
  imageId: string,
  data: { alt_text?: string | null; sort_order?: number },
) => apiPatch(`/admin/products/${id(productId)}/images/${id(imageId)}`, data)
export const deleteProductImage = (productId: string, imageId: string) =>
  apiDelete(`/admin/products/${id(productId)}/images/${id(imageId)}`)

export interface AdminCategory {
  category_id: string
  name: string
  product_count: number
}
export const getAdminCategories = (signal?: AbortSignal) =>
  apiGet<AdminCategory[]>('/admin/categories', signal)
export const createCategory = (name: string) =>
  apiPost<{ category_id: string; name: string }>('/admin/categories', { name })
export const renameCategory = (categoryId: string, name: string) =>
  apiPatch<{ category_id: string; name: string }>(`/admin/categories/${id(categoryId)}`, { name })
export const deleteCategory = (categoryId: string) =>
  apiDelete(`/admin/categories/${id(categoryId)}`)

// ---- customers ----------------------------------------------------------------------------

export interface AdminCustomer extends Customer {
  order_count: number
}
export interface AdminCustomerDetail extends AdminCustomer {
  custom_order_count: number
  recent_orders: AdminOrderSummary[]
}
export const getAdminCustomers = (
  filters: { search?: string; page?: number },
  signal?: AbortSignal,
) => apiGet<Page<AdminCustomer>>(`/admin/customers${qs({ ...filters, page_size: 20 })}`, signal)
export const getAdminCustomer = (customerId: string, signal?: AbortSignal) =>
  apiGet<AdminCustomerDetail>(`/admin/customers/${id(customerId)}`, signal)

// ---- gallery ------------------------------------------------------------------------------

export interface AdminGalleryImage {
  gallery_image_id: string
  url: string
  title: string | null
  description: string | null
  image_type: GalleryImageType
  is_visible: boolean
  created_at: string
}
export const getAdminGallery = (page: number, signal?: AbortSignal) =>
  apiGet<Page<AdminGalleryImage>>(`/admin/gallery${qs({ page, page_size: 24 })}`, signal)
export const getGalleryUpload = (contentType: string) =>
  apiPost<UploadTarget>('/admin/gallery/upload-url', { content_type: contentType })
export const createGalleryImage = (data: {
  storage_path: string
  title?: string | null
  description?: string | null
  image_type: GalleryImageType
  is_visible: boolean
}) => apiPost<AdminGalleryImage>('/admin/gallery', data)
export const updateGalleryImage = (
  imageId: string,
  data: Partial<{
    title: string | null
    description: string | null
    image_type: GalleryImageType
    is_visible: boolean
  }>,
) => apiPatch<AdminGalleryImage>(`/admin/gallery/${id(imageId)}`, data)
export const deleteGalleryImage = (imageId: string) => apiDelete(`/admin/gallery/${id(imageId)}`)

// ---- custom orders, messages, reviews -----------------------------------------------------

export interface AdminCustomOrder extends CustomOrder {
  customer_id: string | null
  reference_image_url: string | null
}
export const getAdminCustomOrders = (
  filters: { status?: string; search?: string; page?: number },
  signal?: AbortSignal,
) =>
  apiGet<Page<AdminCustomOrder>>(`/admin/custom-orders${qs({ ...filters, page_size: 20 })}`, signal)
export const setCustomOrderStatus = (customOrderId: string, status: CustomOrderStatus) =>
  apiPost<AdminCustomOrder>(`/admin/custom-orders/${id(customOrderId)}/status`, { status })

export type MessageStatus = 'NEW' | 'READ' | 'REPLIED' | 'ARCHIVED'
export interface AdminMessage {
  message_id: string
  name: string
  email: string | null
  phone: string | null
  whatsapp_number: string | null
  message: string
  status: MessageStatus
  created_at: string
}
export const getAdminMessages = (
  filters: { status?: string; search?: string; page?: number },
  signal?: AbortSignal,
) => apiGet<Page<AdminMessage>>(`/admin/messages${qs({ ...filters, page_size: 20 })}`, signal)
export const setMessageStatus = (messageId: string, status: MessageStatus) =>
  apiPost<AdminMessage>(`/admin/messages/${id(messageId)}/status`, { status })

export interface AdminReview extends Review {
  customer_id: string | null
  customer_name: string | null
  order_id: string
  product_name_snapshot: string
}
export const getAdminReviews = (page: number, signal?: AbortSignal) =>
  apiGet<Page<AdminReview>>(`/admin/reviews${qs({ page, page_size: 20 })}`, signal)
export const deleteAdminReview = (reviewId: string) => apiDelete(`/admin/reviews/${id(reviewId)}`)

// ---- business settings --------------------------------------------------------------------

export interface BusinessSettings {
  business_name: string | null
  email: string | null
  phone: string | null
  whatsapp: string | null
  address: string | null
  delivery_information: string | null
  delivery_fee_paisa: number
  social_links: Record<string, string>
}
export const getAdminSettings = (signal?: AbortSignal) =>
  apiGet<BusinessSettings & { updated_at: string }>('/admin/settings', signal)
export const updateAdminSettings = (data: Partial<BusinessSettings>) =>
  apiPatch<BusinessSettings & { updated_at: string }>('/admin/settings', data)
export const getPublicSettings = (signal?: AbortSignal) =>
  apiGet<BusinessSettings>('/settings', signal)

export type { Address }
