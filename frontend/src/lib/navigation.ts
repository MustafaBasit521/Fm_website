/** Full-page navigation to another site (the payment gateway). Wrapped so tests can replace it. */
export const redirectTo = (url: string): void => {
  window.location.assign(url)
}
