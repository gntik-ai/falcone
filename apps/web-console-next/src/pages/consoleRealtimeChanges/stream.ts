// Page-local change-stream client for /console/realtime/changes.
// Legacy used EventSource (apps/web-console/src/services/realtimeApi.ts). fetch plus a
// text/event-stream reader keeps the same URL and the same reconnect behaviour while exposing
// the HTTP status, which EventSource hides. The anon key in ?apikey= is the only credential:
// this client never goes through the session transport, never sends Authorization and so a
// stream 401 can never trigger a session refresh.
const enc = encodeURIComponent

export interface RealtimeChange {
  type: string
  documentId?: unknown
  document?: unknown
}

export type RealtimeTarget =
  | { source: 'mongo'; databaseName: string; collectionName: string }
  | { source: 'postgres'; databaseName: string; schemaName: string; tableName: string }

export interface StreamFailure {
  status?: number
  requestId?: string
}

export interface StreamHandlers {
  /** The stream response was accepted (HTTP 200, text/event-stream). Called again after a reconnect. */
  onOpen: () => void
  onChange: (change: RealtimeChange, eventName: string) => void
  /** The connection dropped; a reconnect to the same URL is scheduled. */
  onDrop: () => void
  /** An HTTP error status (or a response that is not an event stream). Reconnection stops. */
  onFailure: (failure: StreamFailure) => void
}

export interface RealtimeStream {
  close: () => void
}

// Postgres can also emit deletes (the Mongo change stream does not).
export const CHANGE_EVENTS = ['insert', 'update', 'replace', 'delete'] as const
// EventSource waits a few seconds before it reconnects unless the server sends `retry:`.
export const DEFAULT_RETRY_MS = 3000

export function realtimeChangesUrl(params: { workspaceId: string; target: RealtimeTarget; apiKey: string; origin?: string }): string {
  const t = params.target
  const wp = `${params.origin ?? ''}/v1/realtime/workspaces/${enc(params.workspaceId)}/data/${enc(t.databaseName)}`
  const path = t.source === 'mongo'
    ? `${wp}/collections/${enc(t.collectionName)}/changes`
    : `${wp}/schemas/${enc(t.schemaName)}/tables/${enc(t.tableName)}/changes`
  return `${path}?apikey=${enc(params.apiKey)}`
}

interface Frame { event: string; data: string }

// Incremental parser for the text/event-stream format (WHATWG HTML, "Server-sent events").
export function createFrameParser(onFrame: (frame: Frame) => void, onRetry: (ms: number) => void) {
  let buffer = ''
  let skipLeadingLf = false
  let event = ''
  let data: string[] = []
  let hasData = false
  function dispatch() {
    if (hasData) onFrame({ event: event || 'message', data: data.join('\n') })
    event = ''; data = []; hasData = false
  }
  function line(text: string) {
    if (text === '') return dispatch()
    if (text.startsWith(':')) return
    const colon = text.indexOf(':')
    const field = colon === -1 ? text : text.slice(0, colon)
    let value = colon === -1 ? '' : text.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') { data.push(value); hasData = true }
    else if (field === 'retry' && /^\d+$/.test(value)) onRetry(Number(value))
  }
  return {
    push(chunk: string) {
      if (skipLeadingLf && chunk.startsWith('\n')) chunk = chunk.slice(1)
      skipLeadingLf = false
      buffer += chunk
      // Lines end with CRLF, LF or a lone CR; a CR at the very end may be half of a CRLF.
      let start = 0
      for (let i = 0; i < buffer.length; i++) {
        const char = buffer[i]
        if (char !== '\n' && char !== '\r') continue
        line(buffer.slice(start, i))
        if (char === '\r') {
          if (buffer[i + 1] === '\n') i++
          else if (i + 1 === buffer.length) skipLeadingLf = true
        }
        start = i + 1
      }
      buffer = buffer.slice(start)
    },
  }
}

async function failureFrom(response: Response): Promise<StreamFailure> {
  let requestId: string | undefined
  try {
    const body = await response.json() as { requestId?: unknown; correlationId?: unknown } | null
    const candidate = body?.requestId ?? body?.correlationId
    if (typeof candidate === 'string' && candidate) requestId = candidate
  } catch { /* The error body is optional. */ }
  return { status: response.status, requestId }
}

export function openRealtimeStream(params: { url: string; handlers: StreamHandlers }): RealtimeStream {
  const { url, handlers } = params
  let closed = false
  let retryMs = DEFAULT_RETRY_MS
  let controller: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  function drop() {
    if (closed) return
    handlers.onDrop()
    if (closed) return
    timer = setTimeout(() => { timer = null; void connect() }, retryMs)
  }

  async function connect() {
    if (closed) return
    const current = new AbortController()
    controller = current
    let response: Response
    try {
      response = await fetch(url, { method: 'GET', headers: { Accept: 'text/event-stream' }, cache: 'no-store', signal: current.signal })
    } catch {
      if (!closed && controller === current) drop()
      return
    }
    if (closed || controller !== current) return
    if (!response.ok) {
      const failure = await failureFrom(response)
      if (!closed && controller === current) { closed = true; handlers.onFailure(failure) }
      return
    }
    if (!/^text\/event-stream\b/i.test(response.headers.get('content-type') ?? '') || !response.body) {
      closed = true
      handlers.onFailure({ status: response.status })
      return
    }
    handlers.onOpen()
    if (closed) return
    const parser = createFrameParser((frame) => {
      if (closed || !(CHANGE_EVENTS as readonly string[]).includes(frame.event)) return
      let change: RealtimeChange
      try { change = JSON.parse(frame.data) as RealtimeChange } catch { return /* Ignore a malformed frame. */ }
      handlers.onChange(change, frame.event)
    }, (ms) => { retryMs = ms })
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (closed || controller !== current) return
        if (done) break
        parser.push(decoder.decode(value, { stream: true }))
      }
    } catch {
      if (closed || controller !== current) return
    }
    if (!closed && controller === current) drop()
  }

  void connect()
  return {
    close() {
      if (closed) return
      closed = true
      if (timer !== null) { clearTimeout(timer); timer = null }
      controller?.abort()
    },
  }
}
