import { createContext, useContext } from 'react'

export interface ToastOptions {
  /** A link shown in the toast, e.g. "View bag". */
  action?: { label: string; to: string }
}

export interface ToastApi {
  /** Shows a short confirmation that disappears by itself. */
  show: (message: string, options?: ToastOptions) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

const silent: ToastApi = { show: () => {} }

/** Without a provider (some isolated tests) showing a toast does nothing. */
export const useToast = (): ToastApi => useContext(ToastContext) ?? silent
