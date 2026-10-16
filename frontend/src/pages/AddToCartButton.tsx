import { useCart } from '../cart/context'
import { useToast } from '../toast/context'
import { buttonClass } from './ui'

/** Adds a product to the bag. `quantity` (default 1) lets the product page add several at once;
 *  `label` replaces the button text (e.g. "Add to bag · Rs 2,500"). */
export function AddToCartButton({
  productId,
  productName,
  disabled = false,
  compact = false,
  quantity = 1,
  label,
}: {
  productId: string
  productName: string
  disabled?: boolean
  compact?: boolean
  quantity?: number
  label?: string
}) {
  const { add } = useCart()
  const toast = useToast()

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={disabled}
        aria-label={compact ? `Add ${productName} to bag` : undefined}
        className={
          compact
            ? 'text-left text-terracotta underline disabled:opacity-40'
            : `${buttonClass} w-full`
        }
        onClick={() => {
          add(productId, quantity)
          toast.show(`${productName} added to your bag`, {
            action: { label: 'View bag', to: '/cart' },
          })
        }}
      >
        {disabled ? 'Unavailable' : (label ?? (compact ? 'Add to bag' : 'Add to bag'))}
      </button>
    </div>
  )
}
