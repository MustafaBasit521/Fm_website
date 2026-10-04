import { useEffect, useState } from 'react'

/** Loads data. It reloads when `deps` change or `reload()` is called.
 *
 *  Results are tagged with the dependencies that produced them, so a change of dependencies (a new
 *  filter, a new page) shows "loading" instead of the old answer. A plain `reload()` keeps showing
 *  the current data while the fresh data arrives, so lists do not flash or lose their buttons. */
export function useLoad<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): { data: T | null; loading: boolean; failed: boolean; reload: () => void } {
  const [version, setVersion] = useState(0)
  const depsKey = JSON.stringify(deps)
  const [result, setResult] = useState<{ depsKey: string; data: T | null } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetcher(controller.signal)
      .then((data) => setResult({ depsKey, data }))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError'))
          setResult({ depsKey, data: null })
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey, version])

  const current = result?.depsKey === depsKey ? result : null
  return {
    data: current?.data ?? null,
    loading: current === null,
    failed: current !== null && current.data === null,
    reload: () => setVersion((v) => v + 1),
  }
}
