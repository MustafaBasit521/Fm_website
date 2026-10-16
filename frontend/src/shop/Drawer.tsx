import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CloseIcon } from './icons'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** A slide-in panel (menu, bag, wishlist, search sheet). Accessible: it is a modal dialog, focus moves into it and
 *  stays inside while it is open, Escape or a click outside closes it, the page behind does not
 *  scroll, and focus returns to the button that opened it. */
export function Drawer({
  open,
  onClose,
  title,
  side = 'right',
  footer,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  side?: 'left' | 'right' | 'top'
  footer?: ReactNode
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  // Stay on screen for the length of the slide-out animation after `open` turns false.
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  useEffect(() => {
    if (open || !mounted) return
    const timer = setTimeout(() => setMounted(false), 200)
    return () => clearTimeout(timer)
  }, [open, mounted])
  const closing = mounted && !open

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const target =
      panel.current?.querySelector<HTMLElement>('[data-initial-focus]') ??
      panel.current?.querySelector<HTMLElement>('[data-autofocus]')
    target?.focus()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') return onClose()
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
  }, [open, onClose])

  if (!mounted) return null
  const place =
    side === 'right'
      ? 'right-0 top-0 h-full w-[min(100%,26rem)]'
      : side === 'left'
        ? 'left-0 top-0 h-full w-[min(100%,24rem)]'
        : 'left-0 top-0 max-h-[90vh] w-full'
  return (
    <div
      className="fixed inset-0 z-50"
      aria-hidden={closing || undefined}
      inert={closing || undefined}
    >
      <div
        className={`panel-backdrop absolute inset-0 bg-ink/40 ${closing ? 'closing' : ''}`}
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`panel-${side} absolute flex flex-col bg-cream shadow-xl ${place} ${closing ? 'closing' : ''}`}
      >
        <div className="flex items-center justify-between border-b border-sand px-5 py-4">
          <h2 className="font-serif text-2xl">{title}</h2>
          <button
            type="button"
            data-autofocus
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()}`}
            className="rounded-full p-2 hover:bg-cream-200 focus-visible:outline-2 focus-visible:outline-terracotta"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-sand px-5 py-4">{footer}</div>}
      </div>
    </div>
  )
}
