import { useEffect, useRef, useState } from 'react'
import { failureFrom, type Failure } from './api'

export interface Remote<T> {
  phase: 'loading' | 'ready' | 'error'
  data: T | null
  failure: Failure | null
  // A retry keeps the previous surface mounted so keyboard focus is not dropped.
  retrying: boolean
  retry: () => void
  refresh: () => void
}

// One request per key and attempt; a late response from an earlier key or attempt is ignored.
export function useRemote<T>(key: string, load: () => Promise<T>): Remote<T> {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<Pick<Remote<T>, 'phase' | 'data' | 'failure' | 'retrying'>>({ phase: 'loading', data: null, failure: null, retrying: false })
  const mode = useRef<'reset' | 'retry'>('reset')
  const loader = useRef(load)
  loader.current = load
  useEffect(() => {
    let active = true
    if (mode.current === 'retry') setState((current) => ({ ...current, retrying: true }))
    else setState({ phase: 'loading', data: null, failure: null, retrying: false })
    mode.current = 'reset'
    loader.current().then(
      (data) => { if (active) setState({ phase: 'ready', data, failure: null, retrying: false }) },
      (cause: unknown) => { if (active) setState({ phase: 'error', data: null, failure: failureFrom(cause), retrying: false }) },
    )
    return () => { active = false }
  }, [key, attempt])
  return {
    ...state,
    retry: () => { mode.current = 'retry'; setAttempt((value) => value + 1) },
    refresh: () => { mode.current = 'reset'; setAttempt((value) => value + 1) },
  }
}
