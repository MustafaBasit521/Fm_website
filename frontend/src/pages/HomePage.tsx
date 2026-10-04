import { Link } from 'react-router-dom'
import { useAuth } from '../auth/context'

export default function HomePage() {
  const { session } = useAuth()
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4">
      <h1 className="font-serif text-5xl">Crochet Shop</h1>
      <p className="text-muted">Handmade crochet, made with care in Lahore.</p>
      <nav className="flex gap-4 text-terracotta underline">
        <Link to="/shop">Shop</Link>
        {session ? (
          <Link to="/account">My account</Link>
        ) : (
          <>
            <Link to="/login">Log in</Link>
            <Link to="/register">Create account</Link>
          </>
        )}
      </nav>
    </main>
  )
}
