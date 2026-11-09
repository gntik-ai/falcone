import { useCallback, useEffect, useRef, useState } from 'react'
import { failureOf, readQuota, type Failure } from './api'

export interface QuotaState { pending: boolean; available: boolean; failure: Failure | null }
export function useQuota(tenantId: string | null) {
  const [state, setState] = useState<QuotaState>({ pending: Boolean(tenantId), available: true, failure: null })
  const controller = useRef<AbortController | null>(null)
  const pending = useRef(false)
  const reload = useCallback(async () => {
    if (!tenantId || pending.current) return false
    pending.current = true
    const request = new AbortController()
    controller.current = request
    setState((previous) => ({ ...previous, pending: true, available: true }))
    try {
      const available = await readQuota(tenantId, request.signal)
      if (!request.signal.aborted) setState({ pending: false, available, failure: null })
      return !request.signal.aborted
    } catch (cause) {
      if (!request.signal.aborted) setState({ pending: false, available: true, failure: failureOf(cause) })
      return false
    } finally { if (controller.current === request) pending.current = false }
  }, [tenantId])
  useEffect(() => {
    let live = true
    // StrictMode's discarded mount must not send an extra pair of GETs.
    void Promise.resolve().then(() => { if (live) void reload() })
    return () => { live = false; controller.current?.abort(); pending.current = false }
  }, [reload])
  return { ...state, reload }
}
