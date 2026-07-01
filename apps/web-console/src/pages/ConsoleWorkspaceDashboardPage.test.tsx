import { render, screen } from '@testing-library/react'
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
        </Routes>
      </MemoryRouter>
    )
  }

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
    expect(screen.getByText('ws-prod')).toBeInTheDocument()
    expect(screen.getByText('PostgreSQL databases')).toBeInTheDocument()
    expect(screen.getByText('Realtime')).toBeInTheDocument()
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
})
