import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { ConsoleFlowRunPage } from './ConsoleFlowRunPage'
import type { RunCanvasProps } from '@/components/flows/RunCanvas'

const mockUseConsoleContext = vi.fn()
const mockGetFlow = vi.fn()
const mockGetExecution = vi.fn()

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))

vi.mock('@/lib/hooks/use-capability-gate', () => ({
  useCapabilityGate: () => ({ enabled: true, loading: false })
}))

vi.mock('@/services/flowsApi', () => ({
  getFlow: (...args: unknown[]) => mockGetFlow(...args)
}))

vi.mock('@/services/flowsMonitoringApi', async () => {
  const actual = await vi.importActual<typeof import('@/services/flowsMonitoringApi')>('@/services/flowsMonitoringApi')
  return {
    ...actual,
    getExecution: (...args: unknown[]) => mockGetExecution(...args)
  }
})

// Replace the ReactFlow-backed canvas with a lightweight probe that surfaces the per-node statuses
// it was handed and forwards node clicks — jsdom cannot render the real @xyflow/react canvas.
let lastCanvasProps: RunCanvasProps | null = null
vi.mock('@/components/flows/RunCanvas', () => ({
  RunCanvas: (props: RunCanvasProps) => {
    lastCanvasProps = props
    return (
      <div data-testid="run-canvas-probe">
        {[...props.nodeStatuses.entries()].map(([nodeId, snapshot]) => (
          <button
            key={nodeId}
            type="button"
            data-testid={`probe-node-${nodeId}`}
            data-status={snapshot.status}
            onClick={() => props.onSelectNode?.(nodeId)}
          >
            {nodeId}:{snapshot.status}
          </button>
        ))}
      </div>
    )
  }
}))

const DEFINITION = {
  apiVersion: 'v1.0',
  name: 'demo',
  nodes: [
    { id: 'step-1', type: 'task', taskType: 'fetch', next: 'step-2' },
    { id: 'step-2', type: 'task', taskType: 'persist' }
  ]
}

function renderRun(executionId = 'ten1:ws1:flow1:run-1') {
  return render(
    <MemoryRouter initialEntries={[`/console/flows/flow1/runs/${encodeURIComponent(executionId)}`]}>
      <Routes>
        <Route path="/console/flows/:flowId/runs/:executionId" element={<ConsoleFlowRunPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  lastCanvasProps = null
  mockUseConsoleContext.mockReturnValue({ activeWorkspaceId: 'ws1', activeTenantId: 'ten1' })
  mockGetFlow.mockReset().mockResolvedValue({ flowId: 'flow1', name: 'demo', definition: DEFINITION })
})
afterEach(cleanup)

describe('ConsoleFlowRunPage — completed run rendered from history', () => {
  beforeEach(() => {
    mockGetExecution.mockReset().mockResolvedValue({
      executionId: 'ten1:ws1:flow1:run-1',
      workflowId: 'ten1:ws1:flow1:run-1',
      status: 'Completed',
      nodes: [
        { nodeId: 'step-1', status: 'completed', input: { a: 1 }, output: { ok: true }, attempts: [{ status: 'completed', attemptNumber: 1, startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:01Z' }] },
        { nodeId: 'step-2', status: 'failed', error: { message: 'boom', stack: 'at x' }, attempts: [{ status: 'failed', attemptNumber: 1 }] }
      ]
    })
  })

  it('renders all node statuses from persisted detail without opening an SSE stream', async () => {
    // No global EventSource defined → if the page tried to stream, it would throw. It must not.
    renderRun()
    await waitFor(() => expect(screen.getByTestId('run-canvas-probe')).toBeInTheDocument())
    expect(screen.getByTestId('probe-node-step-1')).toHaveAttribute('data-status', 'completed')
    expect(screen.getByTestId('probe-node-step-2')).toHaveAttribute('data-status', 'failed')
    // A terminal run shows the static indicator (no live apikey input).
    expect(screen.getByTestId('run-static-indicator')).toBeInTheDocument()
    expect(screen.queryByTestId('run-apikey-input')).toBeNull()
  })

  it('opens the node detail panel with capped payloads + error on node click', async () => {
    const user = userEvent.setup()
    renderRun()
    await waitFor(() => expect(screen.getByTestId('probe-node-step-2')).toBeInTheDocument())
    await user.click(screen.getByTestId('probe-node-step-2'))
    expect(await screen.findByTestId('run-node-detail-panel')).toBeInTheDocument()
    expect(screen.getByTestId('run-node-error')).toHaveTextContent('boom')
  })

  it('shows the terminal status badge and disables Cancel', async () => {
    renderRun()
    await waitFor(() => expect(screen.getByTestId('run-status-badge')).toHaveTextContent('Completed'))
    expect(screen.getByTestId('run-cancel-button')).toBeDisabled()
    // Retry is available for a terminal run.
    expect(screen.getByTestId('run-retry-button')).toBeInTheDocument()
  })
})

describe('ConsoleFlowRunPage — running run', () => {
  it('offers the live-stream apikey input (no static indicator) for a non-terminal run', async () => {
    mockGetExecution.mockResolvedValue({
      executionId: 'ten1:ws1:flow1:run-1',
      workflowId: 'ten1:ws1:flow1:run-1',
      status: 'Running',
      nodes: []
    })
    renderRun()
    await waitFor(() => expect(screen.getByTestId('run-status-badge')).toHaveTextContent('Running'))
    expect(screen.getByTestId('run-apikey-input')).toBeInTheDocument()
    expect(screen.queryByTestId('run-static-indicator')).toBeNull()
    // Retry hidden on a non-terminal run; Cancel enabled.
    expect(screen.queryByTestId('run-retry-button')).toBeNull()
    expect(screen.getByTestId('run-cancel-button')).not.toBeDisabled()
  })
})
