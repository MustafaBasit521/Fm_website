import { useState, type ReactNode } from 'react'
import { ChevronRightIcon } from './icons'

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
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center gap-4">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="min-h-11 rounded-full border border-linen px-5 py-2 disabled:opacity-40"
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
        className="min-h-11 rounded-full border border-linen px-5 py-2 disabled:opacity-40"
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
  <span className="rounded-full border border-sand bg-paper px-2 py-0.5 text-sm">{children}</span>
)

export const inputClass =
  'rounded-[10px] border border-linen bg-paper px-4 py-3 focus:outline-2 focus:outline-offset-2 focus:outline-terracotta'

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
    <span className="flex flex-wrap gap-3">
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

/** The top of an admin page: a small line above (counts, date), the serif title, actions on the right. */
export function PageTitle({
  eyebrow,
  title,
  actions,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="text-sm text-bark">{eyebrow}</p>}
        <h1 className="font-serif text-4xl leading-tight md:text-5xl">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </header>
  )
}

/** A rounded white panel (cards, tables). */
export const cardClass = 'rounded-[18px] border border-sand bg-paper'

/** A row of a list shown like a table row: the whole row is the link, with a chevron. */
export const rowLinkClass =
  'grid items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-cream-100 focus-visible:outline-2 focus-visible:outline-dashed focus-visible:outline-bark'

export const Chevron = () => <ChevronRightIcon className="hidden text-bark md:block" />

/** An on/off switch (role="switch"), e.g. "In shop". */
export function Switch({
  checked,
  onChange,
  label,
  hiddenLabel,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  /** The accessible name when it differs from the visible text. */
  hiddenLabel?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={hiddenLabel}
      onClick={() => onChange(!checked)}
      className="inline-flex flex-nowrap items-center gap-2 text-sm focus-visible:outline-2 focus-visible:outline-dashed focus-visible:outline-bark"
    >
      <span
        aria-hidden="true"
        className={`relative inline-block h-5 w-9 rounded-full transition ${checked ? 'bg-moss-dark' : 'bg-linen'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-[1.1rem]' : 'left-0.5'}`}
        />
      </span>
      {label}
    </button>
  )
}
