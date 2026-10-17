import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'

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

/** "Back to ..." link at the top of a page: a small pill with an arrow icon. */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={`inline-flex min-h-9 items-center gap-2 rounded-full border border-linen bg-paper px-3.5 py-1 text-sm text-ink hover:bg-cream-200 ${focusRing}`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M19 12H5M11 6l-6 6 6 6" />
      </svg>
      {children}
    </Link>
  )
}

/** A file chooser with a proper button instead of the browser's plain "Choose File". The real
 *  <input type="file"> stays in the page (visually hidden, keyboard and screen-reader friendly),
 *  so forms and tests that read it keep working. */
export function FilePicker({
  id,
  name,
  label,
  accept,
  multiple,
  disabled,
  buttonText = 'Choose file',
  showNames = true,
  onChange,
  onFiles,
}: {
  id: string
  name?: string
  label: string
  accept?: string
  multiple?: boolean
  disabled?: boolean
  buttonText?: string
  /** Show the chosen file names next to the button (turn off when the page lists them itself). */
  showNames?: boolean
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void
  onFiles?: (files: File[]) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [names, setNames] = useState<string[]>([])

  // a form reset (after a successful upload) also clears the shown names
  useEffect(() => {
    const form = input.current?.form
    const clear = () => setNames([])
    form?.addEventListener('reset', clear)
    return () => form?.removeEventListener('reset', clear)
  }, [])

  function handle(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    setNames(files.map((f) => f.name))
    onChange?.(e)
    if (onFiles) {
      onFiles(files)
      if (!showNames) e.target.value = '' // the page keeps the files; allow choosing the same one again
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-bark">
        {label}
      </label>
      <div className="relative flex flex-wrap items-center gap-3 rounded-[10px] border-2 border-dashed border-linen bg-cream-100 p-4">
        <input
          ref={input}
          id={id}
          name={name}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={handle}
          className="peer sr-only"
        />
        <label
          htmlFor={id}
          aria-hidden="true"
          className={`${pill} cursor-pointer border border-ink bg-paper text-ink hover:bg-cream-200 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-dashed peer-focus-visible:outline-bark peer-disabled:cursor-not-allowed peer-disabled:opacity-50`}
        >
          {buttonText}
        </label>
        {showNames && (
          <span className="min-w-0 break-words text-sm text-bark">
            {names.length > 0 ? names.join(', ') : 'No file chosen'}
          </span>
        )}
      </div>
    </div>
  )
}

/** Outlined red pill for destructive actions (delete). Always paired with a confirmation dialog. */
export const dangerButtonClass = `${pill} border border-danger bg-transparent text-danger hover:bg-accent-tint`
