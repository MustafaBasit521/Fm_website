import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <h1 className="font-serif text-5xl">Page not found</h1>
      <p className="mt-4">We could not find that page.</p>
      <p className="mt-2">
        <Link to="/" className="text-terracotta underline">
          Go to the home page
        </Link>
      </p>
    </main>
  )
}
