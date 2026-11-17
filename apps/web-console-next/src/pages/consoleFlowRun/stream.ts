import { useEffect, useRef, useState } from 'react'
import { streamFlowExecutionEvents, type FlowExecutionEvent } from '@in-falcone/console-api'
import type { NodeStatusSnapshot } from './status'

// 'connecting': no response yet. 'live': the events request is open. 'reconnecting': the
// connection dropped or failed and the client is retrying. 'unavailable': the client gave up.
export type StreamConnection = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'unavailable'
export interface FlowRunStream {
  nodeStatuses: Map<string, NodeStatusSnapshot>
  connection: StreamConnection
  ended: boolean
}

// The console-api stream client reconnects on its own and exposes no signal for a drop, so the
// page watches the events fetch: a rejected or non-OK response is a failed attempt, and an OK
// response whose body ends or errors on its own is a dropped connection. The bytes, status and
// headers pass through untouched, and the wrapper is removed when the stream closes.
function observeEventsFetch(path: string, listener: { attempt(): void; open(): void; failed(status?: number): void; dropped(): void }) {
  const original = globalThis.fetch
  const wrapped: typeof fetch = async (input, init) => {
    const watched = typeof input === 'string' && input === path
    if (watched) listener.attempt()
    try {
      const response = await original(input, init)
      if (!watched) return response
      if (!response.ok) { listener.failed(response.status); return response }
      listener.open()
      if (!response.body) return response
      const reader = response.body.getReader()
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read()
            if (chunk.done) { listener.dropped(); controller.close() } else controller.enqueue(chunk.value)
          } catch (cause) { listener.dropped(); controller.error(cause) }
        },
        // The client cancelling its own reader (close, stream-end) is not a drop.
        cancel: (reason) => reader.cancel(reason),
      })
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
    } catch (cause) {
      if (watched) listener.failed()
      throw cause
    }
  }
  globalThis.fetch = wrapped
  return () => { if (globalThis.fetch === wrapped) globalThis.fetch = original }
}

export function useFlowRunStream({ workspaceId, executionId, enabled, onStatusChange }: {
  workspaceId: string; executionId: string; enabled: boolean
  // Called once per live change of a node's status, outside React's render phase.
  onStatusChange: (nodeId: string, status: NodeStatusSnapshot['status']) => void
}): FlowRunStream {
  const [nodeStatuses, setNodeStatuses] = useState<Map<string, NodeStatusSnapshot>>(new Map())
  const [connection, setConnection] = useState<StreamConnection>('idle')
  const [ended, setEnded] = useState(false)
  const latest = useRef(new Map<string, NodeStatusSnapshot>())
  const notify = useRef(onStatusChange)
  notify.current = onStatusChange

  useEffect(() => {
    if (!enabled) return
    let active = true
    let attempts = 0
    let replaying = false
    let finished = false
    setConnection('connecting')
    const path = `/v1/flows/workspaces/${encodeURIComponent(workspaceId)}/executions/${encodeURIComponent(executionId)}/events`
    const stopObserving = observeEventsFetch(path, {
      attempt: () => {
        if (!active) return
        // The replay after a 401 is part of the same attempt, not a reconnect.
        if (replaying) { replaying = false; return }
        setConnection(attempts++ === 0 ? 'connecting' : 'reconnecting')
      },
      open: () => { if (active) setConnection('live') },
      dropped: () => { if (active && !finished) setConnection('reconnecting') },
      // A 401 is replayed once after the shell refresh; it is not a dropped connection.
      failed: (status) => {
        if (!active) return
        if (status === 401) replaying = true
        else setConnection('reconnecting')
      },
    })
    const stream = streamFlowExecutionEvents({
      workspaceId, executionId,
      onFrame: (frame: FlowExecutionEvent) => {
        if (!active) return
        if (frame.type === 'node-status') {
          const previous = latest.current.get(frame.nodeId)
          const snapshot: NodeStatusSnapshot = {
            nodeId: frame.nodeId, status: frame.status,
            attemptNumber: frame.attemptNumber ?? previous?.attemptNumber ?? 1,
            startedAt: frame.startedAt ?? previous?.startedAt ?? null,
            completedAt: frame.completedAt ?? previous?.completedAt ?? null,
            error: frame.error ?? previous?.error ?? null,
          }
          latest.current = new Map(latest.current).set(frame.nodeId, snapshot)
          setNodeStatuses(latest.current)
          if (previous?.status !== frame.status) notify.current(frame.nodeId, frame.status)
        } else if (frame.type === 'stream-end') {
          finished = true; setConnection('idle'); setEnded(true); stream.close()
        }
      },
      onError: () => { if (active) setConnection('unavailable') },
    })
    // The client reports a terminal failure through onError and rejects done as well.
    stream.done.catch(() => {})
    return () => { active = false; stopObserving(); stream.close() }
  }, [workspaceId, executionId, enabled])

  return { nodeStatuses, connection: enabled ? connection : 'idle', ended }
}
