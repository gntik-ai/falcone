import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useFlowExecution, type FlowExecutionState } from './use-flow-execution'

// Reuse the same FakeEventSource shape as the service test so the hook exercises the real
// subscribeFlowExecution path (no service mock — closer to integration).
class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  closed = false
  listeners: Record<string, Array<(e: unknown) => void>> = {}
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
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
  FakeEventSource.instances = []
  ;(globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource as unknown
})
afterEach(cleanup)

function Harness({ onState }: { onState: (state: FlowExecutionState) => void }) {
  const state = useFlowExecution({ workspaceId: 'ws1', executionId: 'ten:ws1:flow:run-1', apiKey: 'flc_anon' })
  onState(state)
  return null
}

describe('useFlowExecution', () => {
  it('accumulates node-status events into a per-node map (latest wins)', () => {
    let latest: FlowExecutionState | null = null
    render(<Harness onState={(s) => (latest = s)} />)
    const es = FakeEventSource.instances[0]
    act(() => {
      es.emit('node-status', { type: 'node-status', nodeId: 'step-1', status: 'scheduled', attemptNumber: 1 })
      es.emit('node-status', { type: 'node-status', nodeId: 'step-1', status: 'started', attemptNumber: 1 })
      es.emit('node-status', { type: 'node-status', nodeId: 'step-2', status: 'scheduled' })
    })
    expect(latest!.nodeStatuses.get('step-1')?.status).toBe('started')
    expect(latest!.nodeStatuses.get('step-2')?.status).toBe('scheduled')
  })

  it('marks the run ended and closes the EventSource on stream-end', () => {
    let latest: FlowExecutionState | null = null
    render(<Harness onState={(s) => (latest = s)} />)
    const es = FakeEventSource.instances[0]
    act(() => {
      es.emit('stream-end', { type: 'stream-end', status: 'Completed' })
    })
    expect(latest!.ended).toBe(true)
    expect(es.closed).toBe(true)
  })

  it('closes the EventSource on unmount and dispatches no state update afterward', () => {
    const states: FlowExecutionState[] = []
    const { unmount } = render(<Harness onState={(s) => states.push(s)} />)
    const es = FakeEventSource.instances[0]
    const countBeforeUnmount = states.length
    unmount()
    expect(es.closed).toBe(true)
    // A late frame from an in-flight EventSource must NOT trigger a re-render / state update.
    act(() => {
      es.emit('node-status', { type: 'node-status', nodeId: 'late', status: 'completed' })
    })
    expect(states.length).toBe(countBeforeUnmount)
  })
})
