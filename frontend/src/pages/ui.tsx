import type { InputHTMLAttributes } from 'react'

export function Field({
  label,
  id,
  ...props
}: { label: string; id: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-bark">
        {label}
      </label>
      <input
        id={id}
        className="rounded-lg border border-sand bg-white px-3 py-2 focus:outline-2 focus:outline-offset-2 focus:outline-terracotta"
        {...props}
      />
    </div>
  )
}

export const buttonClass =
  'rounded-lg bg-terracotta px-4 py-2 font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta disabled:opacity-50'

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="text-danger">
      {message}
    </p>
  )
}
