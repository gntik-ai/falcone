import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { realtimeChangesUrl, subscribeRealtimeChanges } from './realtimeApi'

// Minimal EventSource stub: records listeners + lets a test emit named SSE events.
class FakeEventSource {
  static last: FakeEventSource | null = null
  url: string
  closed = false
  listeners: Record<string, Array<(e: unknown) => void>> = {}
  constructor(url: string) {
    this.url = url
    FakeEventSource.last = this
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    ;(this.listeners[type] ??= []).push(fn)
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners[type] ?? []) fn({ data: JSON.stringify(data) })
  }
  close() {
    this.closed = true
  }
}

beforeEach(() => {
  ;(globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource as unknown
})
afterEach(() => {
  FakeEventSource.last = null
})

describe('realtimeApi', () => {
  it('builds the SSE URL with the anon key as ?apikey=', () => {
    const url = realtimeChangesUrl({ workspaceId: 'ws1', databaseName: 'appdb', collectionName: 'notes', apiKey: 'flc_anon_x', origin: 'https://api.example.com' })
    expect(url).toBe('https://api.example.com/v1/realtime/workspaces/ws1/data/appdb/collections/notes/changes?apikey=flc_anon_x')
  })

  it('subscribes via EventSource and delivers insert/update/replace changes', () => {
    const changes: unknown[] = []
    const sub = subscribeRealtimeChanges({
      workspaceId: 'ws1', databaseName: 'appdb', collectionName: 'notes', apiKey: 'flc_anon_x',
      onChange: (c) => changes.push(c)
    })
    const es = FakeEventSource.last as FakeEventSource
    expect(es.url).toContain('apikey=flc_anon_x')
    es.emit('insert', { type: 'insert', documentId: 'd1', document: { _id: 'd1', body: 'hi' } })
    es.emit('update', { type: 'update', documentId: 'd1', document: { _id: 'd1', body: 'bye' } })
    expect(changes).toEqual([
      { type: 'insert', documentId: 'd1', document: { _id: 'd1', body: 'hi' } },
      { type: 'update', documentId: 'd1', document: { _id: 'd1', body: 'bye' } }
    ])
  })

  it('close() closes the EventSource', () => {
    const sub = subscribeRealtimeChanges({ workspaceId: 'ws1', databaseName: 'appdb', collectionName: 'notes', apiKey: 'k', onChange: () => {} })
    sub.close()
    expect((FakeEventSource.last as FakeEventSource).closed).toBe(true)
  })
})
