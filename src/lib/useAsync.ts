import { useCallback, useEffect, useState } from 'react'

export type AsyncState<T> =
  | { kind: 'loading' }
  | { kind: 'ready'; data: T }
  | { kind: 'error'; message: string }

/**
 * Runs `load` when `deps` change and exposes the result plus a `reload`.
 * Results from a load that was superseded are dropped.  A reload keeps the
 * old data on screen until the new data arrives.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): { state: AsyncState<T>; reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ kind: 'loading' })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let active = true
    load()
      .then((data) => {
        if (active) setState({ kind: 'ready', data })
      })
      .catch((e: unknown) => {
        if (active) setState({ kind: 'error', message: (e as Error).message })
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { state, reload }
}
