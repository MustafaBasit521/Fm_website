import { useEffect, useState } from 'react'
import { getHealth } from './lib/api'

type State = 'loading' | 'ok' | 'error'

export default function App() {
  const [state, setState] = useState<State>('loading')

  useEffect(() => {
    const controller = new AbortController()
    getHealth(controller.signal)
      .then(() => setState('ok'))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setState('error')
      })
    return () => controller.abort()
  }, [])

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4">
      <h1 className="font-serif text-5xl">Crochet Shop</h1>
      <p className="text-muted" role="status">
        {state === 'loading' && 'Checking API…'}
        {state === 'ok' && 'API connected.'}
        {state === 'error' && 'Cannot reach the API.'}
      </p>
    </main>
  )
}
