/** Display only. Amounts are integer paisa end to end; no floating point is used. */
export function formatPrice(paisa: number): string {
  const rupees = Math.floor(paisa / 100)
  const rest = paisa % 100
  const whole = rupees.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return rest === 0 ? `Rs ${whole}` : `Rs ${whole}.${rest.toString().padStart(2, '0')}`
}

/** "1250.50" -> 125050 paisa using string/integer math only. Returns null for anything else. */
export function parseRupeesToPaisa(input: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(input.trim())
  if (!match) return null
  const rupees = Number(match[1])
  const paisa = match[2] ? Number(match[2].padEnd(2, '0')) : 0
  return rupees * 100 + paisa
}
