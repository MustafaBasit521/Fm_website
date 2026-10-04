/** Display only. Amounts are integer paisa end to end; no floating point is used. */
export function formatPrice(paisa: number): string {
  const rupees = Math.floor(paisa / 100)
  const rest = paisa % 100
  const whole = rupees.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return rest === 0 ? `Rs ${whole}` : `Rs ${whole}.${rest.toString().padStart(2, '0')}`
}
