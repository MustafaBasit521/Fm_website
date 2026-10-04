import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useCart } from '../cart/context'
import { buttonClass } from './ui'

export function AddToCartButton({
  productId,
  productName,
  disabled = false,
  compact = false,
}: {
  productId: string
  productName: string
  disabled?: boolean
  compact?: boolean
}) {
  const { add } = useCart()
  const [added, setAdded] = useState(false)

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={disabled}
        aria-label={compact ? `Add ${productName} to cart` : undefined}
        className={
          compact ? 'text-left text-terracotta underline disabled:opacity-40' : buttonClass
        }
        onClick={() => {
          add(productId)
          setAdded(true)
        }}
      >
        {disabled ? 'Unavailable' : 'Add to cart'}
      </button>
      {added && (
        <p role="status" className="text-sm text-moss-dark">
          Added.{' '}
          <Link to="/cart" className="underline">
            View cart
          </Link>
        </p>
      )}
    </div>
  )
}
