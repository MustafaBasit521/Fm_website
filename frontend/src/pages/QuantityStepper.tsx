import { MAX_LINE_QUANTITY } from '../lib/cart'

const step =
  'inline-flex h-11 w-11 items-center justify-center rounded-full text-xl hover:bg-cream-200 focus-visible:outline-2 focus-visible:outline-dashed focus-visible:outline-bark disabled:opacity-40'

/** The "− 1 +" control from the mockup. `label` names the product for screen readers. */
export function QuantityStepper({
  value,
  onChange,
  label,
  min = 1,
  max = MAX_LINE_QUANTITY,
}: {
  value: number
  onChange: (next: number) => void
  label: string
  min?: number
  max?: number
}) {
  return (
    <div
      role="group"
      aria-label={`Quantity of ${label}`}
      className="inline-flex items-center rounded-full border border-linen bg-paper"
    >
      <button
        type="button"
        className={step}
        aria-label={`Decrease quantity of ${label}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <span aria-hidden="true">−</span>
      </button>
      <output aria-live="polite" className="min-w-8 text-center font-semibold">
        {value}
      </output>
      <button
        type="button"
        className={step}
        aria-label={`Increase quantity of ${label}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  )
}
