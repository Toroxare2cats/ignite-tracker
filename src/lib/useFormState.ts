import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface FormState<T> {
  values: T
  /** Change one field. */
  set: <K extends keyof T>(key: K, value: T[K]) => void
  /** True when what is on screen differs from what was last saved. */
  dirty: boolean
  status: SaveStatus
  error: string | null
  savedAt: string | null
  /**
   * Runs a save.  On success the current values become the saved baseline
   * (or the values `run` returns, when the save changes them).  On failure
   * everything typed stays on screen.  A second tap while saving is ignored.
   */
  submit: (run: (values: T) => Promise<T | void>) => Promise<boolean>
  /** Show a problem without trying to save (for example a missing field). */
  fail: (message: string) => void
  /** Throw away edits and go back to the saved values. */
  reset: (values?: T) => void
}

/** While `dirty` is true, the browser warns before the tab is closed or reloaded. */
export function useUnsavedWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
}

/**
 * Tracks one form's saved and unsaved state, for every form in the portal.
 * While there are unsaved changes the browser also warns before the tab is
 * closed or reloaded.
 */
export function useFormState<T>(initial: T): FormState<T> {
  const [values, setValues] = useState<T>(initial)
  const [baseline, setBaseline] = useState<T>(initial)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const saving = useRef(false)

  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(baseline), [values, baseline])
  useUnsavedWarning(dirty)

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
    setError(null)
    setStatus((s) => (s === 'error' ? 'idle' : s))
  }, [])

  const submit = useCallback(
    async (run: (values: T) => Promise<T | void>): Promise<boolean> => {
      if (saving.current) return false
      saving.current = true
      setStatus('saving')
      setError(null)
      try {
        const next = await run(values)
        const saved = (next ?? values) as T
        setValues(saved)
        setBaseline(saved)
        setSavedAt(new Date().toISOString())
        setStatus('saved')
        return true
      } catch (e) {
        setError((e as Error).message)
        setStatus('error')
        return false
      } finally {
        saving.current = false
      }
    },
    [values],
  )

  const fail = useCallback((message: string) => {
    setError(message)
    setStatus('error')
  }, [])

  const reset = useCallback(
    (next?: T) => {
      const target = next ?? baseline
      setValues(target)
      setBaseline(target)
      setError(null)
      setStatus('idle')
    },
    [baseline],
  )

  return { values, set, dirty, status, error, savedAt, submit, fail, reset }
}
