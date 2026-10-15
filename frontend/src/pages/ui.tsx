import type { InputHTMLAttributes } from 'react'

// Shapes and colours follow the design system in the project mockup:
// pill buttons (48 px tall), 10 px inputs with a dashed "stitched" focus ring, 18 px cards.
const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dashed focus-visible:outline-bark'

const pill = `inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 py-2 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`

/** Accent pill: the "commit" actions (add to bag, place order, pay, save). */
export const buttonClass = `${pill} bg-terracotta text-white hover:bg-accent-hover`
/** Dark pill: the main call to action on a page. */
export const primaryButtonClass = `${pill} bg-ink text-cream hover:opacity-90`
/** Outlined pill: secondary actions. */
export const secondaryButtonClass = `${pill} border border-ink bg-transparent text-ink hover:bg-cream-200`

export const inputClass =
  'w-full rounded-[10px] border border-linen bg-paper px-4 py-3 text-ink placeholder:text-muted focus:border-ink focus:outline-2 focus:outline-offset-2 focus:outline-dashed focus:outline-bark disabled:bg-cream-200 disabled:text-muted'

export function Field({
  label,
  id,
  hint,
  ...props
}: { label: string; id: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-bark">
        {label}
      </label>
      <input
        id={id}
        className={inputClass}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...props}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
    </div>
  )
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="flex items-start gap-2 text-danger">
      <span aria-hidden="true" className="mt-0.5 font-bold">
        !
      </span>
      {message}
    </p>
  )
}
