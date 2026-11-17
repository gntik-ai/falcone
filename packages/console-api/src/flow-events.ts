import { ensureConsoleSession, refreshConsoleShellSession } from './session'

export type FlowNodeStatus = 'scheduled' | 'started' | 'retrying' | 'completed' | 'failed' | 'skipped' | 'waiting-approval'
export interface FlowNodeStatusEvent {
  type: 'node-status'
  id?: string
  nodeId: string
  status: FlowNodeStatus
  attemptNumber?: number
  startedAt?: string | null
  completedAt?: string | null
  error?: { message: string; stack?: string } | null
}
export interface FlowLogLineEvent {
  type: 'log-line'
  id?: string
  nodeId: string
  level: string
  message: string
  timestamp?: string | null
}
export interface FlowStreamEndEvent {
  type: 'stream-end'
  id?: string
  status?: string
}
export type FlowExecutionEvent = FlowNodeStatusEvent | FlowLogLineEvent | FlowStreamEndEvent
export interface FlowEventsError { status: number; code: string }
export interface FlowExecutionEventsOptions {
  workspaceId: string
  executionId: string
  onFrame: (frame: FlowExecutionEvent) => void
  onError?: (error: FlowEventsError) => void
  signal?: AbortSignal
  lastEventId?: string
}
export interface FlowExecutionEventsStream { close(): void; done: Promise<void> }

export function streamFlowExecutionEvents(options: FlowExecutionEventsOptions): FlowExecutionEventsStream {
  const controller = new AbortController()
  let closed = false
  let failed = false
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let stop!: () => void
  const stopped = new Promise<void>((resolve) => { stop = resolve })
  const close = () => {
    closed = true
    controller.abort()
    void reader?.cancel().catch(() => {})
    if (!failed) stop()
  }
  options.signal?.addEventListener('abort', close, { once: true })
  if (options.signal?.aborted) close()

  async function run() {
    if (closed) return
    const session = await ensureConsoleSession()
    if (closed) return
    let token = session?.tokenSet?.accessToken?.trim()
    if (!token) throw { status: 401, code: 'HTTP_401' }
    let refreshedAfterUnauthorized = false
    let lastEventId = options.lastEventId
    const delivered = new Set<string>(lastEventId ? [lastEventId] : [])
    const url = `/v1/flows/workspaces/${encodeURIComponent(options.workspaceId)}/executions/${encodeURIComponent(options.executionId)}/events`
    while (!closed) {
      const headers = new Headers({ Accept: 'text/event-stream', Authorization: `Bearer ${token}` })
      if (lastEventId) headers.set('Last-Event-ID', lastEventId)
      let response: Response | undefined
      try { response = await fetch(url, { method: 'GET', headers, signal: controller.signal }) }
      catch { if (closed) return }
      if (closed) {
        await response?.body?.cancel().catch(() => {})
        return
      }
      if (response?.status === 401 && !refreshedAfterUnauthorized) {
        refreshedAfterUnauthorized = true
        await response.body?.cancel().catch(() => {})
        if (closed) return
        const refreshed = await refreshConsoleShellSession()
        if (closed) return
        token = refreshed?.tokenSet?.accessToken?.trim()
        if (!token) throw { status: 401, code: 'HTTP_401' }
        continue
      }
      if (response && !response.ok) {
        if (response.status >= 400 && response.status < 500) {
          let code = `HTTP_${response.status}`
          try {
            const body = await response.json()
            if (typeof body?.code === 'string') code = body.code
          } catch { /* Preserve a typed error for non-JSON responses. */ }
          throw { status: response.status, code }
        }
        await response.body?.cancel().catch(() => {})
        response = undefined
      }
      if (response?.ok) refreshedAfterUnauthorized = false
      if (response?.body) {
        reader = response.body.getReader()
        try {
          const frames = parseFrames(reader)
          while (!closed) {
            let next: IteratorResult<FlowExecutionEvent>
            try { next = await frames.next() } catch { break }
            if (next.done || closed) break
            const frame = next.value
            if (frame.id) {
              lastEventId = frame.id
              if (delivered.has(frame.id)) continue
              delivered.add(frame.id)
            }
            options.onFrame(frame)
            if (frame.type === 'stream-end') return
          }
        } finally {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
          reader = undefined
        }
      }
      if (!closed) await new Promise<void>((resolve) => {
        const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', finish); resolve() }
        const timer = setTimeout(finish, 1000)
        controller.signal.addEventListener('abort', finish, { once: true })
      })
    }
  }
  const done = Promise.race([stopped, run().catch((error: FlowEventsError) => {
    if (closed) return
    failed = true
    try { options.onError?.(error) } finally { throw error }
  })]).finally(() => { options.signal?.removeEventListener('abort', close) })
  return { close, done }
}

async function* parseFrames(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<FlowExecutionEvent> {
  const decoder = new TextDecoder()
  let buffer = '', event = '', id: string | undefined
  let data: string[] = []
  while (true) {
    const chunk = await reader.read()
    buffer += decoder.decode(chunk.value, { stream: !chunk.done })
    let match: RegExpExecArray | null
    while ((match = /\r\n|\r|\n/.exec(buffer))) {
      if (!chunk.done && match[0] === '\r' && match.index === buffer.length - 1) break
      const line = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      if (!line) {
        if (data.length && ['node-status', 'log-line', 'stream-end'].includes(event)) {
          let payload
          try { payload = JSON.parse(data.join('\n')) } catch { /* Ignore malformed frames. */ }
          if (payload && typeof payload === 'object') {
            yield { ...payload, type: event, ...(id === undefined ? {} : { id }) } as FlowExecutionEvent
          }
        }
        event = ''; id = undefined; data = []
      } else {
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') event = value
        if (field === 'id' && !value.includes('\0')) id = value
        if (field === 'data') data.push(value)
      }
    }
    if (chunk.done) return
  }
}
