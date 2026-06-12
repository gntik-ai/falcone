import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { ConsoleFlowHistoryPage } from './ConsoleFlowHistoryPage'

const mockUseConsoleContext = vi.fn()
const mockListExecutions = vi.fn()

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))

vi.mock('@/services/flowsMonitoringApi', async () => {
  const actual = await vi.importActual<typeof import('@/services/flowsMonitoringApi')>('@/services/flowsMonitoringApi')
  return {
    ...actual,
    listExecutions: (...args: unknown[]) => mockListExecutions(...args)
  }
})

// Capability gate must let children through.
vi.mock('@/lib/hooks/use-capability-gate', () => ({
  useCapabilityGate: () => ({ enabled: true, loading: false })
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/console/flows/flow1/runs']}>
      <Routes>
        <Route path="/console/flows/:flowId/runs" element={<ConsoleFlowHistoryPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  mockUseConsoleContext.mockReturnValue({ activeWorkspaceId: 'ws1', activeTenantId: 'ten1' })
  mockListExecutions.mockReset().mockResolvedValue({
    items: [
      { executionId: 'ten1:ws1:flow1:run-aaaaaaaaaaaaaaaaaaaaaaaaa', status: 'Completed', triggerType: 'manual', version: 1, startedAt: '2026-01-01T00:00:00Z' }
    ],
    nextPageToken: null
  })
})
afterEach(cleanup)

describe('ConsoleFlowHistoryPage filters', () => {
  it('loads the first page on mount, scoped to the flow', async () => {
    renderPage()
    await waitFor(() => expect(mockListExecutions).toHaveBeenCalled())
    expect(mockListExecutions.mock.calls[0][0]).toBe('ws1')
    expect(mockListExecutions.mock.calls[0][1].flowId).toBe('flow1')
    expect(await screen.findByTestId('run-history-row')).toBeInTheDocument()
  })

  it('status filter updates the query params', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(mockListExecutions).toHaveBeenCalledTimes(1))
    await user.selectOptions(screen.getByTestId('filter-status'), 'Failed')
    await waitFor(() => expect(mockListExecutions.mock.calls.at(-1)![1].status).toBe('Failed'))
  })

  it('trigger-type filter updates the query params', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(mockListExecutions).toHaveBeenCalledTimes(1))
    await user.selectOptions(screen.getByTestId('filter-trigger-type'), 'webhook')
    await waitFor(() => expect(mockListExecutions.mock.calls.at(-1)![1].triggerType).toBe('webhook'))
  })

  it('flow-version filter updates the query params', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(mockListExecutions).toHaveBeenCalledTimes(1))
    await user.type(screen.getByTestId('filter-flow-version'), '2')
    await waitFor(() => expect(mockListExecutions.mock.calls.at(-1)![1].flowVersion).toBe('2'))
  })

  it('renders the empty-state message when no executions match', async () => {
    mockListExecutions.mockResolvedValue({ items: [], nextPageToken: null })
    renderPage()
    expect(await screen.findByTestId('run-history-empty')).toHaveTextContent('No executions match')
    expect(screen.queryByTestId('run-history-row')).toBeNull()
  })

  it('paginates with the continuation token', async () => {
    mockListExecutions.mockResolvedValueOnce({
      items: [{ executionId: 'ten1:ws1:flow1:run-page1xxxxxxxxxxxxxxxxxxxxxxx', status: 'Completed' }],
      nextPageToken: 'tok-2'
    })
    const user = userEvent.setup()
    renderPage()
    const nextButton = await screen.findByTestId('run-history-next')
    await waitFor(() => expect(nextButton).not.toBeDisabled())
    mockListExecutions.mockResolvedValueOnce({ items: [{ executionId: 'ten1:ws1:flow1:run-page2xxxxxxxxxxxxxxxxxxxxxxx', status: 'Failed' }], nextPageToken: null })
    await user.click(nextButton)
    await waitFor(() => expect(mockListExecutions.mock.calls.at(-1)![1].pageToken).toBe('tok-2'))
  })

  it('only renders rows for the returned (tenant-scoped) items', async () => {
    renderPage()
    const table = await screen.findByTestId('run-history-table')
    expect(within(table).getAllByTestId('run-history-row')).toHaveLength(1)
  })
})
