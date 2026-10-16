import { useEffect, useState } from 'react'
import { getPublicSettings } from './api'

/** wa.me wants the number as digits with the country code. Pakistani numbers are often typed as
 *  "0300 1234567": a leading 0 becomes 92. */
export function waDigits(raw: string | null | undefined): string | null {
  let d = (raw ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('0')) d = `92${d.slice(1)}`
  return d.length >= 8 ? d : null
}

/** A link that opens WhatsApp with the message already typed: the customer only presses send. */
export const waLink = (digits: string, text?: string) =>
  `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`

/** The shop's WhatsApp number from the business settings, or null until known / not set. */
export function useShopWhatsapp(): string | null {
  const [digits, setDigits] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    getPublicSettings()
      .then((s) => active && setDigits(waDigits(s.whatsapp)))
      .catch(() => {}) // WhatsApp buttons simply stay hidden
    return () => {
      active = false
    }
  }, [])
  return digits
}
