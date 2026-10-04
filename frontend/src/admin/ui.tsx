import { useState, type ReactNode } from 'react'

export function Pager({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number
  total: number
  pageSize: number
  onPage: (p: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center gap-4">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="rounded-lg border border-sand px-3 py-1 disabled:opacity-40"
      >
        Previous
      </button>
      <span>
        Page {page} of {pages}
      </span>
      <button
        type="button"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
        className="rounded-lg border border-sand px-3 py-1 disabled:opacity-40"
      >
        Next
      </button>
    </nav>
  )
}

export function State({
  loading,
  failed,
  empty,
  emptyText,
  children,
}: {
  loading: boolean
  failed: boolean
  empty?: boolean
  emptyText?: string
  children: ReactNode
}) {
  if (loading) return <p role="status">Loading…</p>
  if (failed)
    return (
      <p role="alert" className="text-danger">
        Could not load this page. Please try again.
      </p>
    )
  if (empty) return <p>{emptyText ?? 'Nothing here yet.'}</p>
  return <>{children}</>
}

export const Badge = ({ children }: { children: ReactNode }) => (
  <span className="rounded-full border border-sand bg-cream-100 px-2 py-0.5 text-sm">
    {children}
  </span>
)

export const inputClass =
  'rounded-lg border border-sand bg-white px-3 py-2 focus:outline-2 focus:outline-offset-2 focus:outline-terracotta'

/** A button that needs a second click ("Are you sure?") before running a destructive action. */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
}: {
  label: string
  confirmLabel: string
  onConfirm: () => void | Promise<void>
  disabled?: boolean
}) {
  const [armed, setArmed] = useState(false)
  if (!armed)
    return (
      <button
        type="button"
        disabled={disabled}
        className="text-danger underline disabled:opacity-40"
        onClick={() => setArmed(true)}
      >
        {label}
      </button>
    )
  return (
    <span className="flex gap-3">
      <button
        type="button"
        className="text-danger underline"
        onClick={() => {
          setArmed(false)
          void onConfirm()
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="underline" onClick={() => setArmed(false)}>
        Keep
      </button>
    </span>
  )
}
