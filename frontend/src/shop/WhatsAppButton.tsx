import { ChatIcon } from './icons'
import { useShopWhatsapp, waLink } from '../lib/whatsapp'

/** "Chat on WhatsApp" with a ready-typed message. Hidden until the shop has set its number. */
export function WhatsAppButton({
  message,
  children = 'Chat on WhatsApp',
  className,
}: {
  message: string
  children?: string
  className: string
}) {
  const digits = useShopWhatsapp()
  if (!digits) return null
  return (
    <a
      href={waLink(digits, message)}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      <ChatIcon /> {children}
      <span className="sr-only"> (opens WhatsApp in a new tab)</span>
    </a>
  )
}
