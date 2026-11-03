import { vi } from 'vitest'

// A controllable text/event-stream response for page-local stream tests.
export function sseResponse(status = 200, contentType = 'text/event-stream') {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
  return {
    response: new Response(body, { status, headers: { 'content-type': contentType } }),
    send: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
    fail: () => controller.error(new TypeError('network error')),
  }
}
export const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`
export const change = (type: string, id: string, extra: Record<string, unknown> = {}) => ({ type, documentId: id, document: { _id: id, ...extra } })
export const errorResponse = (status: number, body: unknown = { status, code: `HTTP_${status}`, message: 'synthetic-error' }) => Response.json(body, { status })

// Resolves queued microtasks and stream reads.
export const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
export function stubFetch(handler: (url: string, init: RequestInit, call: number) => Response | Promise<Response>) {
  let call = 0
  const mock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => handler(String(input), init, call++))
  vi.stubGlobal('fetch', mock)
  return mock
}
