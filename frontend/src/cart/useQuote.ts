import { useEffect, useState } from 'react'
import { getQuote, type Quote } from '../lib/api'
import type { CartItems } from '../lib/cart'

/** The bag priced by the backend (prices, availability, totals). The bag itself only holds ids
 *  and quantities. Results are tagged with the bag they answer, so "loading" is derived:
 *  `current` is null while the answer for the present bag has not arrived. */
export function useQuote(items: CartItems, enabled = true) {
  const key = JSON.stringify(items)
  const [loaded, setLoaded] = useState<{ key: string; quote: Quote | null } | null>(null)

  useEffect(() => {
    if (!enabled || items.length === 0) return
    const controller = new AbortController()
    getQuote(items, controller.signal)
      .then((quote) => setLoaded({ key, quote }))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setLoaded({ key, quote: null })
      })
    return () => controller.abort()
    // `key` captures `items`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  const current = loaded?.key === key ? loaded : null
  return { current, quote: current?.quote ?? null }
}
