// Single place for talking to the FastAPI backend.
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE_URL}/api${path}`, { signal })
  if (!res.ok) throw new ApiError(res.status, `Request failed (${res.status})`)
  return (await res.json()) as T
}

export interface HealthResponse {
  status: string
}

export const getHealth = (signal?: AbortSignal) => apiGet<HealthResponse>('/health', signal)
