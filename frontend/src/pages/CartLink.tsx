import { Link } from 'react-router-dom'
import { useCart } from '../cart/context'

export function CartLink() {
  const { units } = useCart()
  return (
    <Link to="/cart" className="text-terracotta underline">
      Cart{units > 0 ? ` (${units})` : ''}
    </Link>
  )
}
