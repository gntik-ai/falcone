import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RunActionToolbar } from './RunActionToolbar'

const mockCancel = vi.fn()
const mockRetry = vi.fn()
const mockSignal = vi.fn()

vi.mock('@/services/flowsMonitoringApi', async () => {
  const actual = await vi.importActual<typeof import('@/services/flowsMonitoringApi')>('@/services/flowsMonitoringApi')
  return {
    ...actual,
    cancelExecution: (...args: unknown[]) => mockCancel(...args),
    retryExecution: (...args: unknown[]) => mockRetry(...args),
    sendApprovalSignal: (...args: unknown[]) => mockSignal(...args)
  }
})

beforeEach(() => {
  mockCancel.mockReset().mockResolvedValue({ executionId: 'e1', status: 'Cancelling' })
  mockRetry.mockReset().mockResolvedValue({ executionId: 'e2', status: 'Running' })
  mockSignal.mockReset().mockResolvedValue({ executionId: 'e1', signal: 'review', delivered: true })
})
afterEach(cleanup)

const base = { workspaceId: 'ws1', flowId: 'flow1', executionId: 'e1' }

describe('RunActionToolbar — Cancel', () => {
  it('disables Cancel on a terminal execution and never calls the API', () => {
    render(<RunActionToolbar {...base} status="Completed" />)
    expect(screen.getByTestId('run-cancel-button')).toBeDisabled()
    expect(mockCancel).not.toHaveBeenCalled()
  })

  it('shows a confirmation dialog before calling the cancel endpoint; API fires only on confirm', async () => {
    const user = userEvent.setup()
    const onCancelled = vi.fn()
    render(<RunActionToolbar {...base} status="Running" onCancelled={onCancelled} />)

    await user.click(screen.getByTestId('run-cancel-button'))
    expect(screen.getByTestId('confirm-action-dialog')).toBeInTheDocument()
    // No API call yet — the dialog gates it.
    expect(mockCancel).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('confirm-action-confirm'))
    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith('ws1', 'flow1', 'e1'))
    expect(onCancelled).toHaveBeenCalled()
  })

  it('closing the dialog without confirming makes no API call', async () => {
    const user = userEvent.setup()
    render(<RunActionToolbar {...base} status="Running" />)
    await user.click(screen.getByTestId('run-cancel-button'))
    await user.click(screen.getByTestId('confirm-action-cancel'))
    expect(mockCancel).not.toHaveBeenCalled()
  })
})

describe('RunActionToolbar — Retry', () => {
  it('hides Retry on a non-terminal execution', () => {
    render(<RunActionToolbar {...base} status="Running" />)
    expect(screen.queryByTestId('run-retry-button')).toBeNull()
  })

  it('shows Retry on a terminal execution and calls retry on confirm', async () => {
    const user = userEvent.setup()
    const onRetried = vi.fn()
    render(<RunActionToolbar {...base} status="Failed" onRetried={onRetried} />)
    await user.click(screen.getByTestId('run-retry-button'))
    expect(screen.getByTestId('confirm-action-dialog')).toBeInTheDocument()
    expect(mockRetry).not.toHaveBeenCalled()
    await user.click(screen.getByTestId('confirm-action-confirm'))
    await waitFor(() => expect(mockRetry).toHaveBeenCalledWith('ws1', 'flow1', 'e1'))
    await waitFor(() => expect(onRetried).toHaveBeenCalledWith('e2'))
  })
})

describe('RunActionToolbar — Approval signal', () => {
  it('renders no approve/reject controls when no node is waiting for approval', () => {
    render(<RunActionToolbar {...base} status="Running" waitingApproval={null} />)
    expect(screen.queryByTestId('run-approve-button')).toBeNull()
    expect(screen.queryByTestId('run-reject-button')).toBeNull()
  })

  it('shows Approve/Reject for a waiting-approval node and sends the signal on confirm', async () => {
    const user = userEvent.setup()
    const onSignalSent = vi.fn()
    render(
      <RunActionToolbar
        {...base}
        status="Running"
        waitingApproval={{ nodeId: 'review', signalName: 'review' }}
        onSignalSent={onSignalSent}
      />
    )
    await user.click(screen.getByTestId('run-approve-button'))
    // Dialog identifies the node before any API call.
    expect(screen.getByTestId('confirm-action-dialog')).toHaveTextContent('review')
    expect(mockSignal).not.toHaveBeenCalled()
    await user.click(screen.getByTestId('confirm-action-confirm'))
    await waitFor(() =>
      expect(mockSignal).toHaveBeenCalledWith('ws1', 'flow1', 'e1', 'review', { approved: true, nodeId: 'review' })
    )
    await waitFor(() => expect(onSignalSent).toHaveBeenCalledWith({ approved: true, nodeId: 'review' }))
  })

  it('Reject sends approved:false', async () => {
    const user = userEvent.setup()
    render(
      <RunActionToolbar {...base} status="Running" waitingApproval={{ nodeId: 'review', signalName: 'review' }} />
    )
    await user.click(screen.getByTestId('run-reject-button'))
    await user.click(screen.getByTestId('confirm-action-confirm'))
    await waitFor(() =>
      expect(mockSignal).toHaveBeenCalledWith('ws1', 'flow1', 'e1', 'review', { approved: false, nodeId: 'review' })
    )
  })
})
