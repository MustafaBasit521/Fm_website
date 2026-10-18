/** The shop name as a logo: serif type, and a lowercase "of" in the middle is set in italic
 *  terracotta (as in "Bundle of Loops"). A name without " of " is shown plainly. */
export function ShopName({
  name,
  accentClass = 'text-terracotta',
}: {
  name: string
  accentClass?: string
}) {
  const match = /^(.+?)\s+(of)\s+(.+)$/i.exec(name)
  if (!match) return <>{name}</>
  return (
    <>
      {match[1]} <em className={accentClass}>{match[2]}</em> {match[3]}
    </>
  )
}
