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
  return (await res.json()) as T
}

export const apiGet = <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal })

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
