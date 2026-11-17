// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { streamFlowExecutionEvents } from '../src/index'
import { persistConsoleShellSession } from '../src/session'
import { loginSession, recordFetch, withSession } from './cases/support.mjs'

const node = { type: 'node-status', nodeId: 'synthetic-node', status: 'started' }
const log = { type: 'log-line', nodeId: 'synthetic-node', level: 'info', message: 'synthetic-message' }
const end = { type: 'stream-end', status: 'Completed' }
const frame = (id: string, data: object) => `id: ${id}\nevent: ${(data as { type: string }).type}\ndata: ${JSON.stringify(data)}\n\n`
function sse(...chunks: string[]) {
  return new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
    controller.close()
  } }), { headers: { 'Content-Type': 'text/event-stream' } })
}
const params = { workspaceId: 'synthetic-ws /?', executionId: 'synthetic-run /?' }

it('requests only the encoded events path with the session bearer and delivers split multi-line frames in order', () => withSession(async () => {
  persistConsoleShellSession(loginSession())
  const requests = recordFetch(() => sse(': heartbeat\r\nevent: node-sta',
    'tus\r\nid: synthetic-1\r\ndata: {"type":"node-status",\r\n',
    'data: "nodeId":"synthetic-node","status":"started"}\r', '\n\r\n',
    frame('synthetic-2', log), frame('synthetic-3', end)))
  const received: unknown[] = []
  const onError = vi.fn()
  await streamFlowExecutionEvents({ ...params, onFrame: (event) => received.push(event), onError }).done
  expect(requests).toHaveLength(1)
  expect(requests[0].url).toBe('/v1/flows/workspaces/synthetic-ws%20%2F%3F/executions/synthetic-run%20%2F%3F/events')
  expect(requests[0].url).not.toMatch(/\?|apikey/i)
  expect(requests[0].headers.get('Authorization')).toBe('Bearer synthetic-access')
  expect(requests[0].headers.get('Accept')).toBe('text/event-stream')
  expect(received).toEqual([{ ...node, id: 'synthetic-1' }, { ...log, id: 'synthetic-2' }, { ...end, id: 'synthetic-3' }])
  expect(onError).not.toHaveBeenCalled()
}))

it('resumes a dropped stream with the last received id and never delivers replayed ids twice', () => withSession(async () => {
  persistConsoleShellSession(loginSession())
  const requests = recordFetch((_request, index) => index === 1
    ? sse(frame('synthetic-1', node), frame('synthetic-2', log))
    : sse(frame('synthetic-1', node), frame('synthetic-2', log), frame('synthetic-3', end)))
  const onFrame = vi.fn()
  await streamFlowExecutionEvents({ ...params, lastEventId: 'synthetic-0', onFrame }).done
  expect(requests).toHaveLength(2)
  expect(requests.map(({ headers }) => headers.get('Last-Event-ID'))).toEqual(['synthetic-0', 'synthetic-2'])
  expect(onFrame.mock.calls.map(([event]) => event.id)).toEqual(['synthetic-1', 'synthetic-2', 'synthetic-3'])
  for (const request of requests) {
    expect(request.url).not.toMatch(/\?|apikey/i)
    expect(request.headers.get('Authorization')).toBe('Bearer synthetic-access')
    expect(request.headers.get('Accept')).toBe('text/event-stream')
  }
}))

it('refreshes once on a reconnect 401 and resumes using the new session bearer and last id', () => withSession(async () => {
  persistConsoleShellSession(loginSession())
  const requests = recordFetch(({ method }, index) => {
    if (method === 'POST') return Response.json(loginSession({ tokenSet: { ...loginSession().tokenSet, accessToken: 'synthetic-new-access' } }))
    if (index === 1) return sse(frame('synthetic-1', node))
    if (index === 2) return Response.json({ code: 'SYNTHETIC_EXPIRED' }, { status: 401 })
    return sse(frame('synthetic-1', node), frame('synthetic-2', end))
  })
  const onFrame = vi.fn()
  await streamFlowExecutionEvents({ ...params, onFrame }).done
  expect(requests.map(({ method }) => method)).toEqual(['GET', 'GET', 'POST', 'GET'])
  expect(requests[2].url).toBe('/v1/auth/login-sessions/synthetic-session/refresh')
  expect(requests[3].headers.get('Authorization')).toBe('Bearer synthetic-new-access')
  expect(requests[3].headers.get('Last-Event-ID')).toBe('synthetic-1')
  expect(onFrame.mock.calls.map(([event]) => event.id)).toEqual(['synthetic-1', 'synthetic-2'])
}))

it.each([401, 403])('a terminal reconnect %s reports its typed error once, rejects done and sends no further request', (status) => withSession(async () => {
  persistConsoleShellSession(loginSession())
  const requests = recordFetch(({ method }, index) => {
    if (method === 'POST') return Response.json(loginSession({ tokenSet: { ...loginSession().tokenSet, accessToken: 'synthetic-new-access' } }))
    if (index === 1) return sse(frame('synthetic-1', node))
    return Response.json({ code: 'SYNTHETIC_DENIED' }, { status: index === 2 ? 401 : status })
  })
  const onError = vi.fn()
  const handle = streamFlowExecutionEvents({ ...params, onFrame: vi.fn(), onError })
  await expect(handle.done).rejects.toEqual({ status, code: 'SYNTHETIC_DENIED' })
  expect(onError).toHaveBeenCalledExactlyOnceWith({ status, code: 'SYNTHETIC_DENIED' })
  expect(requests.map(({ method }) => method)).toEqual(['GET', 'GET', 'POST', 'GET'])
  expect(requests[3].headers.get('Last-Event-ID')).toBe('synthetic-1')
  handle.close()
  expect(onError).toHaveBeenCalledTimes(1)
}))

it.each(['close', 'abort', 'already-aborted'] as const)('%s resolves quietly and cancels an active reader without reconnecting', (mode) => withSession(async () => {
  persistConsoleShellSession(loginSession())
  const signal = new AbortController()
  const cancelled = vi.fn()
  const onFrame = vi.fn()
  const onError = vi.fn()
  const requests = recordFetch(() => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(frame('synthetic-1', node))) },
    cancel: cancelled,
  })))
  if (mode === 'already-aborted') signal.abort()
  const handle = streamFlowExecutionEvents({ ...params, signal: signal.signal, onFrame, onError })
  if (mode !== 'already-aborted') {
    await vi.waitFor(() => expect(onFrame).toHaveBeenCalledTimes(1))
    if (mode === 'close') handle.close()
    else signal.abort()
  }
  await expect(handle.done).resolves.toBeUndefined()
  expect(onError).not.toHaveBeenCalled()
  expect(requests).toHaveLength(mode === 'already-aborted' ? 0 : 1)
  if (mode !== 'already-aborted') expect(cancelled).toHaveBeenCalledTimes(1)
}))

it('an initial 401 refreshes exactly once before connecting successfully', () => withSession(async () => {
  persistConsoleShellSession(loginSession())
  const requests = recordFetch(({ method }, index) => {
    if (method === 'POST') return Response.json(loginSession({ tokenSet: { ...loginSession().tokenSet, accessToken: 'synthetic-new-access' } }))
    return index === 1 ? new Response(null, { status: 401 }) : sse(frame('synthetic-2', end))
  })
  await streamFlowExecutionEvents({ ...params, lastEventId: 'synthetic-1', onFrame: vi.fn() }).done
  expect(requests.map(({ method }) => method)).toEqual(['GET', 'POST', 'GET'])
  expect(requests[2].headers.get('Authorization')).toBe('Bearer synthetic-new-access')
  expect(requests[2].headers.get('Last-Event-ID')).toBe('synthetic-1')
}))

it('an unrefreshable session fails locally without an unauthenticated request', () => withSession(async () => {
  const requests = recordFetch(() => { throw new Error('Unexpected request') })
  const onError = vi.fn()
  await expect(streamFlowExecutionEvents({ ...params, onFrame: vi.fn(), onError }).done).rejects.toEqual({ status: 401, code: 'HTTP_401' })
  expect(onError).toHaveBeenCalledExactlyOnceWith({ status: 401, code: 'HTTP_401' })
  expect(requests).toHaveLength(0)
}))

it('a reconnect 403 without a preceding 401 is terminal without refreshing', () => withSession(async () => {
  persistConsoleShellSession(loginSession())
  const requests = recordFetch((_request, index) => index === 1
    ? sse(frame('synthetic-1', node)) : new Response('synthetic-denial', { status: 403 }))
  const onError = vi.fn()
  await expect(streamFlowExecutionEvents({ ...params, onFrame: vi.fn(), onError }).done).rejects.toEqual({ status: 403, code: 'HTTP_403' })
  expect(onError).toHaveBeenCalledExactlyOnceWith({ status: 403, code: 'HTTP_403' })
  expect(requests.map(({ method }) => method)).toEqual(['GET', 'GET'])
}))

it('recovers from transport and server failures while preserving the resume cursor', () => withSession(async () => {
  persistConsoleShellSession(loginSession())
  const requests = recordFetch((_request, index) => {
    if (index === 1) return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(frame('synthetic-1', node))) },
      pull(controller) { controller.error(new TypeError('Synthetic connection lost')) },
    }))
    if (index === 2) throw new TypeError('Synthetic network failure')
    if (index === 3) return new Response(null, { status: 503 })
    return sse(frame('synthetic-1', node), frame('synthetic-2', end))
  })
  const onError = vi.fn(), onFrame = vi.fn()
  await streamFlowExecutionEvents({ ...params, onFrame, onError }).done
  expect(requests.map(({ headers }) => headers.get('Last-Event-ID'))).toEqual([null, 'synthetic-1', 'synthetic-1', 'synthetic-1'])
  expect(onFrame.mock.calls.map(([event]) => event.id)).toEqual(['synthetic-1', 'synthetic-2'])
  expect(onError).not.toHaveBeenCalled()
}))

it('an already aborted signal does not refresh an expiring session', () => withSession(async () => {
  persistConsoleShellSession(loginSession({ tokenSet: { ...loginSession().tokenSet, expiresAt: '2026-03-28T17:00:00Z' } }))
  const signal = new AbortController()
  signal.abort()
  const requests = recordFetch(() => Response.json(loginSession()))
  const onError = vi.fn()
  await streamFlowExecutionEvents({ ...params, signal: signal.signal, onFrame: vi.fn(), onError }).done
  expect(requests).toHaveLength(0)
  expect(onError).not.toHaveBeenCalled()
}))

it('a terminal error still rejects done when onError closes the handle', () => withSession(async () => {
  persistConsoleShellSession(loginSession())
  recordFetch(() => Response.json({ code: 'SYNTHETIC_DENIED' }, { status: 403 }))
  let handle: ReturnType<typeof streamFlowExecutionEvents>
  const onError = vi.fn(() => handle.close())
  handle = streamFlowExecutionEvents({ ...params, onFrame: vi.fn(), onError })
  await expect(handle.done).rejects.toEqual({ status: 403, code: 'SYNTHETIC_DENIED' })
  expect(onError).toHaveBeenCalledTimes(1)
}))

it.each(['close', 'abort'] as const)('%s prevents a refresh when a pending connection returns a late 401', (mode) => withSession(async () => {
  persistConsoleShellSession(loginSession())
  let respond!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { respond = resolve })
  const requests = recordFetch((_request, index) => index === 1 ? pending : Response.json(loginSession()))
  const signal = new AbortController()
  const onFrame = vi.fn(), onError = vi.fn()
  const handle = streamFlowExecutionEvents({ ...params, signal: signal.signal, onFrame, onError })
  await vi.waitFor(() => expect(requests).toHaveLength(1))
  if (mode === 'close') handle.close()
  else signal.abort()
  await expect(handle.done).resolves.toBeUndefined()
  // A response already queued by the transport may arrive after cancellation.
  respond(new Response(null, { status: 401 }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(requests.map(({ method }) => method)).toEqual(['GET'])
  expect(onFrame).not.toHaveBeenCalled()
  expect(onError).not.toHaveBeenCalled()
}))
