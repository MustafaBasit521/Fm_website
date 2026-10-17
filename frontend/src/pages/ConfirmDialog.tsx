import { useEffect, useRef, type ReactNode } from 'react'
import { buttonClass, dangerButtonClass, secondaryButtonClass } from './ui'

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** A centred pop-up that asks "are you sure?" before something that cannot be undone. Focus starts
 *  on the safe button, Tab stays inside, Escape or a click outside cancels, and focus returns to
 *  the button that opened it. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Keep it',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** Style the confirm button as a destructive (red) action. */
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.querySelector<HTMLElement>('[data-cancel]')?.focus()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') return onCancel()
      if (e.key !== 'Tab' || !panel.current) return
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      opener?.focus?.()
    }
  }, [open, onCancel])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        className="panel-backdrop absolute inset-0 bg-ink/50"
        aria-hidden="true"
        onClick={onCancel}
      />
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-text"
        className="relative w-full max-w-md rounded-[18px] bg-paper p-6 shadow-xl"
      >
        <h2 id="confirm-title" className="font-serif text-3xl">
          {title}
        </h2>
        <div id="confirm-text" className="mt-2 text-bark">
          {children}
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" data-cancel onClick={onCancel} className={secondaryButtonClass}>
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={danger ? dangerButtonClass : buttonClass}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
