import { useEffect, useState } from 'react'
import { failureOf, type Failure } from './api'

export function useList<T>(load: (signal: AbortSignal) => Promise<T[]>, revision: number) {
  const [result, setResult] = useState<{ revision: number; rows?: T[]; failure?: Failure } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    void Promise.resolve().then(async () => {
      if (!active) return
      try { const rows = await load(controller.signal); if (active) setResult({ revision, rows }) }
      catch (cause) { if (active) setResult({ revision, failure: failureOf(cause) }) }
    })
    return () => { active = false; controller.abort() }
  }, [load, revision])
  return result?.revision === revision ? result : null
}
