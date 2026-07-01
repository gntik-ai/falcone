import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getWorkspaceConsumptionMock } = vi.hoisted(() => ({
  getWorkspaceConsumptionMock: vi.fn()
}))

vi.mock('@/services/planManagementApi', () => ({
  getWorkspaceConsumption: getWorkspaceConsumptionMock
}))

import { ConsoleWorkspaceDashboardPage } from './ConsoleWorkspaceDashboardPage'

describe('ConsoleWorkspaceDashboardPage', () => {
  beforeEach(() => {
    getWorkspaceConsumptionMock.mockReset()
  })

  function renderPage(path = '/console/workspaces/ws-prod') {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/console/workspaces/:workspaceId" element={<ConsoleWorkspaceDashboardPage />} />
          <Route path="/console/my-plan" element={<div>My plan route</div>} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('announces the loading state with workspace context', () => {
    getWorkspaceConsumptionMock.mockReturnValue(new Promise(() => undefined))

    renderPage()

    const state = screen.getByRole('status', { name: /loading workspace dashboard/i })
    expect(state).toHaveAttribute('aria-busy', 'true')
    expect(state).toHaveTextContent(/ws-prod/i)
  })

  it('renders workspace consumption and capabilities when the API succeeds', async () => {
    getWorkspaceConsumptionMock.mockResolvedValue({
      tenantId: 'pro-corp',
      workspaceId: 'ws-prod',
      snapshotAt: '2026-07-01T00:00:00.000Z',
      dimensions: [
        {
          dimensionKey: 'max_pg_databases',
          displayLabel: 'PostgreSQL databases',
          unit: 'count',
          tenantEffectiveValue: 10,
          workspaceLimit: 6,
          workspaceSource: 'workspace_sub_quota',
          currentUsage: 4,
          usageStatus: 'within_limit',
          usageUnknownReason: null
        }
      ],
      capabilities: [
        { capabilityKey: 'realtime', displayLabel: 'Realtime', enabled: true, source: 'plan' }
      ]
    })

    renderPage()

    expect((await screen.findByRole('heading', { name: /workspace dashboard/i })).textContent).toMatch(/workspace dashboard/i)
    expect(screen.getAllByText('Workspace').length).toBeGreaterThan(0)
    expect(screen.getByText('ws-prod')).toBeInTheDocument()
    expect(screen.getByText('pro-corp')).toBeInTheDocument()
    expect(screen.getByText(/Jul 1, 2026/i)).toBeInTheDocument()
    expect(screen.getByText('PostgreSQL databases')).toBeInTheDocument()
    expect(screen.getByText('Within limit')).toBeInTheDocument()
    expect(screen.getByText('Realtime')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /capabilities/i })).toBeInTheDocument()
    expect(screen.queryByText(/consumption data unavailable/i)).not.toBeInTheDocument()
    expect(getWorkspaceConsumptionMock).toHaveBeenCalledWith('ws-prod')
  })

  it('does not render raw NO_ROUTE details when workspace consumption cannot be retrieved', async () => {
    getWorkspaceConsumptionMock.mockRejectedValue(
      new Error('404 NO_ROUTE: No action mapped for GET /v1/workspaces/ws-prod/consumption')
    )

    renderPage()

    const state = await screen.findByRole('status', { name: /consumption data unavailable/i })
    expect(state).toHaveTextContent(/does not have consumption data available right now/i)
    expect(screen.queryByText(/NO_ROUTE/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/No action mapped/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(getWorkspaceConsumptionMock).toHaveBeenCalledWith('ws-prod')
  })

  it('offers a clean route to tenant-level quotas when workspace consumption is unavailable', async () => {
    const user = userEvent.setup()
    getWorkspaceConsumptionMock.mockRejectedValue(new Error('404 NO_ROUTE'))

    renderPage()

    await user.click(await screen.findByRole('button', { name: /open my plan/i }))

    expect(screen.getByText('My plan route')).toBeInTheDocument()
  })
})
