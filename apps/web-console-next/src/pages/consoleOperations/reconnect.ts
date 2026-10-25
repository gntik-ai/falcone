import { useEffect, useRef } from 'react'
import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import { listOperations, type OperationSummary } from './query'
import { reconcileOperations, type ReconciliationDelta } from './reconcile-operations.runtime.mjs'

export function useReconnectStateSync(tenantId: string | null, workspaceId: string | null, items: OperationSummary[], onChange: (delta: ReconciliationDelta) => void) {
  const latest = useRef({ items, onChange })
  latest.current = { items, onChange }
  useEffect(() => {
    if (!tenantId) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    let mounted = true
    async function sync() {
      controller?.abort()
      const next = new AbortController()
      controller = next
      const snapshot = new Map(latest.current.items.map((item) => [item.operationId, item]))
      try {
        await requestConsoleSessionJson('/v1/console/session', { signal: next.signal })
        if (!mounted || next.signal.aborted) return
        const remote: OperationSummary[] = []
        let offset = 0
        do {
          const response = await listOperations({ status: ['running', 'pending'], tenantId: tenantId!, workspaceId: workspaceId ?? undefined }, offset, 100, next.signal)
          if (!mounted || next.signal.aborted) return
          remote.push(...response.items)
          offset += response.items.length
          if (response.items.length === 0 || offset >= response.total) break
        } while (true)
        latest.current.onChange(reconcileOperations(snapshot, remote))
      } catch {
        // The session transport handles expired authentication. An offline sync leaves the list untouched.
      }
    }
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { void sync() }, 500) }
    const visible = () => { if (document.visibilityState === 'visible') schedule() }
    window.addEventListener('online', schedule)
    document.addEventListener('visibilitychange', visible)
    return () => {
      mounted = false; clearTimeout(timer); controller?.abort()
      window.removeEventListener('online', schedule)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [tenantId, workspaceId])
}
