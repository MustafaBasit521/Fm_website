import type { ReactNode } from 'react'

/** The opening of a page: small eyebrow label, serif title, optional intro (design-system type). */
export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string
  title: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="mb-6">
      {eyebrow && (
        <p className="text-sm font-medium uppercase tracking-widest text-bark">{eyebrow}</p>
      )}
      <h1 className="mt-1 font-serif text-5xl leading-tight">{title}</h1>
      {children && <div className="mt-2 max-w-xl text-bark">{children}</div>}
    </header>
  )
}
