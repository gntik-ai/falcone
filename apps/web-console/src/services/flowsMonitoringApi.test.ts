import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  flowExecutionEventsUrl,
  isTerminalExecution,
  subscribeFlowExecution,
  type FlowExecutionEvent
} from './flowsMonitoringApi'

// Minimal EventSource stub mirroring realtimeApi.test.ts: records listeners + emits named events.
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

describe('flowsMonitoringApi', () => {
  it('builds the execution SSE URL with the anon key as ?apikey=', () => {
    const url = flowExecutionEventsUrl({
      workspaceId: 'ws1',
      executionId: 'ten:ws1:flow:run-1',
      apiKey: 'flc_anon_x',
      origin: 'https://api.example.com'
    })
    expect(url).toBe(
      'https://api.example.com/v1/flows/workspaces/ws1/executions/ten%3Aws1%3Aflow%3Arun-1/events?apikey=flc_anon_x'
    )
  })

  it('subscribes via EventSource and delivers node-status / log-line / stream-end frames', () => {
    const events: FlowExecutionEvent[] = []
    subscribeFlowExecution({
      workspaceId: 'ws1',
      executionId: 'ten:ws1:flow:run-1',
      apiKey: 'flc_anon_x',
      onEvent: (event) => events.push(event)
    })
    const es = FakeEventSource.last as FakeEventSource
    expect(es.url).toContain('apikey=flc_anon_x')
    es.emit('node-status', { type: 'node-status', nodeId: 'step-1', status: 'started', attemptNumber: 1 })
    es.emit('log-line', { type: 'log-line', nodeId: 'step-1', level: 'info', message: 'hello' })
    es.emit('stream-end', { type: 'stream-end', status: 'Completed' })
    expect(events).toEqual([
      { type: 'node-status', nodeId: 'step-1', status: 'started', attemptNumber: 1 },
      { type: 'log-line', nodeId: 'step-1', level: 'info', message: 'hello' },
      { type: 'stream-end', status: 'Completed' }
    ])
  })

  it('close() closes the EventSource', () => {
    const sub = subscribeFlowExecution({
      workspaceId: 'ws1',
      executionId: 'e1',
      apiKey: 'k',
      onEvent: () => {}
    })
    sub.close()
    expect((FakeEventSource.last as FakeEventSource).closed).toBe(true)
  })

  it('ignores malformed frames without throwing', () => {
    const events: FlowExecutionEvent[] = []
    subscribeFlowExecution({ workspaceId: 'ws1', executionId: 'e1', apiKey: 'k', onEvent: (e) => events.push(e) })
    const es = FakeEventSource.last as FakeEventSource
    for (const fn of es.listeners['node-status'] ?? []) fn({ data: '{not json' })
    expect(events).toEqual([])
  })

  it('isTerminalExecution recognises terminal Temporal statuses', () => {
    expect(isTerminalExecution('Running')).toBe(false)
    expect(isTerminalExecution(null)).toBe(false)
    expect(isTerminalExecution('Completed')).toBe(true)
    expect(isTerminalExecution('Failed')).toBe(true)
    expect(isTerminalExecution('Canceled')).toBe(true)
    expect(isTerminalExecution('TimedOut')).toBe(true)
  })
})
