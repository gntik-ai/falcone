import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DEFAULT_RETRY_MS, createFrameParser, openRealtimeStream, realtimeChangesUrl, type StreamHandlers } from '../src/pages/consoleRealtimeChanges/stream'
import { buildTarget, pushChange, resolveSelected, toEntry } from '../src/pages/consoleRealtimeChanges/changes'
import { change, errorResponse, flush, frame, sseResponse, stubFetch } from './consoleRealtimeChanges-support'

const mongoUrl = '/v1/realtime/workspaces/ws-1/data/app_db/collections/orders/changes?apikey=synthetic-anon-key'

function handlers() {
  const events: string[] = []
  const value: StreamHandlers = {
    onOpen: () => events.push('open'),
    onChange: (item, name) => events.push(`change:${name}:${String(item.documentId)}`),
    onDrop: () => events.push('drop'),
    onFailure: (failure) => events.push(`failure:${failure.status}:${failure.requestId ?? ''}`),
  }
  return { events, value }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

test('builds the legacy URLs and encodes every segment', () => {
  expect(realtimeChangesUrl({ workspaceId: 'ws-1', target: { source: 'mongo', databaseName: 'app_db', collectionName: 'orders' }, apiKey: 'synthetic-anon-key' })).toBe(mongoUrl)
  expect(realtimeChangesUrl({ workspaceId: 'ws-1', target: { source: 'postgres', databaseName: 'app_db', schemaName: 'public', tableName: 'accounts' }, apiKey: 'synthetic-anon-key' }))
    .toBe('/v1/realtime/workspaces/ws-1/data/app_db/schemas/public/tables/accounts/changes?apikey=synthetic-anon-key')
  expect(realtimeChangesUrl({ workspaceId: 'w/1', target: { source: 'mongo', databaseName: 'a b', collectionName: 'c?d' }, apiKey: 'k&=' }))
    .toBe('/v1/realtime/workspaces/w%2F1/data/a%20b/collections/c%3Fd/changes?apikey=k%26%3D')
})

test('form validation trims values, defaults a blank schema to public and rejects missing fields', () => {
  const form = { source: 'postgres' as const, database: ' app_db ', collection: '', schema: '  ', table: ' accounts ', apiKey: ' synthetic-anon-key ' }
  expect(buildTarget(form)).toEqual({ target: { source: 'postgres', databaseName: 'app_db', schemaName: 'public', tableName: 'accounts' }, apiKey: 'synthetic-anon-key' })
  expect(buildTarget({ ...form, source: 'mongo', collection: ' orders ' })).toEqual({ target: { source: 'mongo', databaseName: 'app_db', collectionName: 'orders' }, apiKey: 'synthetic-anon-key' })
  for (const missing of [{ database: ' ' }, { table: '' }, { apiKey: '  ' }]) expect(buildTarget({ ...form, ...missing })).toBeNull()
  expect(buildTarget({ ...form, source: 'mongo', collection: ' ' })).toBeNull()
})

test('keeps the 100 newest changes first and falls back to the newest when the selection is evicted', () => {
  let list = [] as ReturnType<typeof toEntry>[]
  for (let index = 1; index <= 101; index++) list = pushChange(list, toEntry({ type: 'insert', documentId: `o${index}`, document: { _id: `o${index}` } }, 'insert', `c${index}`, new Date(0)))
  expect(list).toHaveLength(100)
  expect(list[0].id).toBe('c101'); expect(list.at(-1)!.id).toBe('c2')
  expect(resolveSelected(list, null)?.id).toBe('c101')
  expect(resolveSelected(list, 'c50')?.id).toBe('c50')
  expect(resolveSelected(list, 'c1')?.id).toBe('c101')
  expect(resolveSelected([], 'c1')).toBeNull()
})

test('maps a change to a log entry without validating its shape', () => {
  const entry = toEntry({ type: 'delete', documentId: 'o4', document: { _id: 'o4' } }, 'delete', 'c1', new Date(2026, 5, 1, 12, 0, 1, 5))
  expect(entry).toMatchObject({ id: 'c1', type: 'delete', known: true, level: 'error', json: '{"_id":"o4"}', receivedAt: '12:00:01.005' })
  expect(toEntry({}, 'update', 'c2', new Date())).toMatchObject({ type: 'update', known: true, level: 'warn', json: 'null' })
  expect(toEntry(null, 'insert', 'c3', new Date())).toMatchObject({ type: 'insert', json: 'null' })
  expect(toEntry({ type: 'custom', document: { a: 1 } }, 'insert', 'c4', new Date())).toMatchObject({ type: 'custom', known: false, level: 'info' })
})

test('parses CRLF, comments, multi-line data, retry and frames split across chunks', () => {
  const frames: unknown[] = []; const retries: number[] = []
  const parser = createFrameParser((value) => frames.push(value), (ms) => retries.push(ms))
  parser.push(': comment\r\nretry: 1500\r\nevent: insert\r\nda')
  parser.push('ta: {"a":\r\n')
  parser.push('data: 1}\r\n\r')
  parser.push('\nevent: update\ndata: x\n\n')
  parser.push('data: only\r\r')
  expect(frames).toEqual([{ event: 'insert', data: '{"a":\n1}' }, { event: 'update', data: 'x' }, { event: 'message', data: 'only' }])
  expect(retries).toEqual([1500])
})

test('accepts a text/event-stream 200, delivers valid frames and ignores malformed frames and other events', async () => {
  const stream = sseResponse(); const calls: Array<[string, RequestInit]> = []
  stubFetch((url, init) => { calls.push([url, init]); return stream.response })
  const { events, value } = handlers()
  const opened = openRealtimeStream({ url: mongoUrl, handlers: value })
  await flush()
  stream.send(frame('insert', change('insert', 'a')) + frame('insert', '{not json') + frame('ping', {}) + 'data: {"type":"insert"}\n\n')
  stream.send(frame('update', change('update', 'b')))
  await flush()
  expect(events).toEqual(['open', 'change:insert:a', 'change:update:b'])
  expect(calls).toHaveLength(1)
  expect(calls[0][0]).toBe(mongoUrl)
  // No credential other than the anon key: no Authorization header, no body.
  expect(calls[0][1]).toMatchObject({ method: 'GET', headers: { Accept: 'text/event-stream' } })
  expect(Object.keys(calls[0][1].headers as Record<string, string>)).toEqual(['Accept'])
  expect(calls[0][1].body).toBeUndefined()
  opened.close()
})

test.each([401, 403, 404, 500])('HTTP %s stops reconnection and reports the status and request id', async (status) => {
  const mock = stubFetch(() => errorResponse(status, { status, code: `HTTP_${status}`, requestId: 'synthetic-request' }))
  const { events, value } = handlers()
  openRealtimeStream({ url: mongoUrl, handlers: value })
  await flush()
  await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_MS * 5)
  expect(events).toEqual([`failure:${status}:synthetic-request`])
  expect(mock).toHaveBeenCalledTimes(1)
})

test('an error body without JSON still reports the status; a non event-stream 200 is a failure', async () => {
  stubFetch(() => new Response('<html>', { status: 500 }))
  const first = handlers()
  openRealtimeStream({ url: mongoUrl, handlers: first.value })
  await flush()
  expect(first.events).toEqual(['failure:500:'])
  stubFetch(() => sseResponse(200, 'application/json').response)
  const second = handlers()
  openRealtimeStream({ url: mongoUrl, handlers: second.value })
  await flush()
  expect(second.events).toEqual(['failure:200:'])
})

test('a dropped connection reconnects once to the same URL and honours retry', async () => {
  const streams = [sseResponse(), sseResponse()]
  const mock = stubFetch((_url, _init, call) => streams[call].response)
  const { events, value } = handlers()
  const opened = openRealtimeStream({ url: mongoUrl, handlers: value })
  await flush()
  streams[0].send('retry: 500\n\n' + frame('insert', change('insert', 'a')))
  streams[0].end()
  await flush()
  expect(events).toEqual(['open', 'change:insert:a', 'drop'])
  await vi.advanceTimersByTimeAsync(499)
  expect(mock).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  await flush()
  expect(mock).toHaveBeenCalledTimes(2)
  expect(mock.mock.calls.map(([url]) => url)).toEqual([mongoUrl, mongoUrl])
  streams[1].send(frame('update', change('update', 'b')))
  await flush()
  expect(events.slice(3)).toEqual(['open', 'change:update:b'])
  opened.close()
})

test('a network failure while connecting or reading schedules a reconnect', async () => {
  const stream = sseResponse()
  const mock = stubFetch((_url, _init, call) => { if (call === 0) throw new TypeError('Failed to fetch'); return stream.response })
  const { events, value } = handlers()
  const opened = openRealtimeStream({ url: mongoUrl, handlers: value })
  await flush()
  expect(events).toEqual(['drop'])
  await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_MS)
  await flush()
  expect(mock).toHaveBeenCalledTimes(2)
  stream.fail()
  await flush()
  expect(events).toEqual(['drop', 'open', 'drop'])
  opened.close()
})

test('close cancels a pending reconnect, aborts the request and silences late callbacks', async () => {
  const first = sseResponse(); let signal: AbortSignal | null | undefined
  const mock = stubFetch((_url, init) => { signal = init.signal; return first.response })
  const { events, value } = handlers()
  const opened = openRealtimeStream({ url: mongoUrl, handlers: value })
  await flush()
  first.end()
  await flush()
  expect(events).toEqual(['open', 'drop'])
  opened.close()
  await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_MS * 3)
  expect(mock).toHaveBeenCalledTimes(1)
  expect(signal?.aborted).toBe(true)
  expect(events).toEqual(['open', 'drop'])
})
