import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { ConsoleFlowHistoryPage } from './ConsoleFlowHistoryPage'

const mockUseConsoleContext = vi.fn()
const mockListExecutions = vi.fn()
const EXECUTION_ID = 'ten1:ws1:flow1:run-aaaaaaaaaaaaaaaaaaaaaaaaa'

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

function renderPage(initialEntry: string | { pathname: string; state?: unknown } = '/console/flows/flow1/runs') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
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
      { executionId: EXECUTION_ID, status: 'Completed', triggerType: 'manual', version: 1, startedAt: '2026-01-01T00:00:00Z' }
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
    expect(screen.getByLabelText(/disparador/i)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /cualquier disparador/i })).toBeInTheDocument()
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
    expect(await screen.findByTestId('run-history-empty')).toHaveTextContent('Todavía no hay ejecuciones')
    expect(screen.queryByTestId('run-history-row')).toBeNull()
  })

  it('[#793] shows the trigger success next-step state from navigation state', async () => {
    mockListExecutions.mockResolvedValue({ items: [], nextPageToken: null })
    renderPage({
      pathname: '/console/flows/flow1/runs',
      state: {
        flowTrigger: {
          flowId: 'flow1',
          scheduleId: 'ten1:ws1:flow1',
          triggeredAt: '2026-07-01T00:00:00Z'
        }
      }
    })

    expect(await screen.findByTestId('flow-trigger-success')).toHaveTextContent('Ejecución solicitada')
    expect(screen.getByTestId('flow-trigger-success')).toHaveTextContent('ten1:ws1:flow1')
    expect(screen.getByRole('button', { name: /actualizar historial/i })).toBeInTheDocument()
  })

  it('[#793] uses ConsolePageState for load errors with a retry CTA', async () => {
    mockListExecutions.mockRejectedValueOnce(new Error('Temporal no disponible'))
    renderPage()

    // [#743] a network/unknown-status failure renders the page's own localized fallback —
    // never the raw thrown message.
    const alert = await screen.findByRole('alert', { name: /no se pudieron cargar las ejecuciones/i })
    expect(alert).toHaveTextContent(/no se pudieron cargar las ejecuciones/i)
    expect(alert.textContent ?? '').not.toMatch(/temporal no disponible/i)
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument()
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

  it('links a run-history row to the run detail route (#792)', async () => {
    renderPage()

    const row = await screen.findByTestId('run-history-row')
    const detailLink = within(row).getByRole('link', { name: /abrir detalles de ejecución/i })
    expect(detailLink).toHaveAttribute(
      'href',
      `/console/flows/flow1/runs/${encodeURIComponent(EXECUTION_ID)}`
    )
  })
})

// #742: the no-workspace guard is the shared WorkspaceRequiredState, not a static blocked state
// whose only action navigated away.
describe('ConsoleFlowHistoryPage — no active workspace', () => {
  it('[#742] shows the shared WorkspaceRequiredState instead of listing executions', () => {
    mockListExecutions.mockReset()
    mockUseConsoleContext.mockReturnValue({
      activeWorkspaceId: null,
      activeTenantId: 'ten1',
      workspaces: [],
      workspacesLoading: false,
      workspacesError: null,
      selectWorkspace: vi.fn(),
      reloadWorkspaces: vi.fn()
    })

    renderPage()

    expect(mockListExecutions).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Historial bloqueado' })).toBeInTheDocument()
    expect(screen.getByText(/selecciona un área de trabajo para ver el historial de ejecuciones/i)).toBeInTheDocument()
  })
})
