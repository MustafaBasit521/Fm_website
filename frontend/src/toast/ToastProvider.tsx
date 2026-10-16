import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ToastContext, type ToastOptions } from './context'

interface Toast extends ToastOptions {
  id: number
  message: string
}

const SHOW_MS = 4500

/** Short pop-up confirmations ("Added to your bag") in the corner of the screen. They are read
 *  out by screen readers (a polite live region), vanish by themselves and can be closed. Errors
 *  stay inside the form they belong to; toasts are for things that went well. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const next = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const show = useCallback(
    (message: string, options?: ToastOptions) => {
      const id = next.current++
      setToasts((list) => [...list.slice(-2), { id, message, ...options }]) // at most 3 at once
      setTimeout(() => dismiss(id), SHOW_MS)
    },
    [dismiss],
  )

  const api = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast pointer-events-auto flex max-w-md flex-nowrap items-center gap-3 rounded-full bg-ink py-2.5 pl-5 pr-3 text-cream shadow-lg"
          >
            <span aria-hidden="true" className="text-moss">
              ✓
            </span>
            <span>{t.message}</span>
            {t.action && (
              <Link
                to={t.action.to}
                onClick={() => dismiss(t.id)}
                className="whitespace-nowrap font-semibold text-cream underline underline-offset-4"
              >
                {t.action.label}
              </Link>
            )}
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-cream hover:bg-bark focus-visible:outline-2 focus-visible:outline-linen"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
