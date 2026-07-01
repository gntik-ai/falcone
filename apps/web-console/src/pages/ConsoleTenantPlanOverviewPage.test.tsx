import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getEffectiveEntitlementsMock, readConsoleShellSessionMock } = vi.hoisted(() => ({
  getEffectiveEntitlementsMock: vi.fn(),
  readConsoleShellSessionMock: vi.fn()
}))

vi.mock('@/services/planManagementApi', () => ({
  getEffectiveEntitlements: getEffectiveEntitlementsMock
}))

vi.mock('@/lib/console-session', () => ({
  readConsoleShellSession: readConsoleShellSessionMock
}))

import { ConsoleTenantPlanOverviewPage } from './ConsoleTenantPlanOverviewPage'

describe('ConsoleTenantPlanOverviewPage', () => {
  beforeEach(() => {
    getEffectiveEntitlementsMock.mockReset()
    readConsoleShellSessionMock.mockReset()
  })

  it('renders tenant owner plan overview', async () => {
    readConsoleShellSessionMock.mockReturnValue(createSession({ platformRoles: ['tenant_owner'], tenantIds: ['ten_alpha'] }))
    getEffectiveEntitlementsMock.mockResolvedValue({
      planDisplayName: 'Starter',
      planSlug: 'starter',
      latestHistoryEntryId: 'h1',
      noAssignment: false,
      quotaDimensions: [{ dimensionKey: 'max_workspaces', displayLabel: 'Workspaces', effectiveValue: 10, observedUsage: 3, usageStatus: 'within_limit' }],
      capabilities: [{ capabilityKey: 'realtime', displayLabel: 'Realtime', enabled: true }]
    })

    render(<MemoryRouter><ConsoleTenantPlanOverviewPage /></MemoryRouter>)

    expect(await screen.findByText('Starter')).toBeInTheDocument()
    expect(screen.getByText('starter')).toBeInTheDocument()
    expect(screen.getByText('Workspaces')).toBeInTheDocument()
    expect(screen.getByText('Realtime')).toBeInTheDocument()
    expect(getEffectiveEntitlementsMock).toHaveBeenCalledWith(undefined, { includeConsumption: true })
  })

  it('renders a superadmin no-personal-plan state with a plan catalog action', async () => {
    const user = userEvent.setup()
    readConsoleShellSessionMock.mockReturnValue(createSession({ platformRoles: ['superadmin'], tenantIds: [] }))
    getEffectiveEntitlementsMock.mockRejectedValue(new Error('TENANT_NOT_FOUND'))

    render(
      <MemoryRouter initialEntries={['/console/my-plan']}>
        <Routes>
          <Route path="/console/my-plan" element={<ConsoleTenantPlanOverviewPage />} />
          <Route path="/console/plans" element={<h1>Plan catalog target</h1>} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByRole('status', { name: /no personal tenant plan/i })).toBeInTheDocument()
    expect(screen.getByText(/platform-level account is not attached to a tenant/i)).toBeInTheDocument()
    expect(screen.queryByText(/TENANT_NOT_FOUND/)).not.toBeInTheDocument()
    expect(getEffectiveEntitlementsMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /open plan catalog/i }))

    expect(screen.getByRole('heading', { name: /plan catalog target/i })).toBeInTheDocument()
  })

  it('renders a platform-operator no-personal-plan state without a gated catalog action', async () => {
    readConsoleShellSessionMock.mockReturnValue(createSession({ platformRoles: ['platform_operator'], tenantIds: [] }))

    render(<MemoryRouter><ConsoleTenantPlanOverviewPage /></MemoryRouter>)

    expect(await screen.findByRole('status', { name: /no personal tenant plan/i })).toBeInTheDocument()
    expect(screen.getByText(/tenant entitlements are reviewed from tenant-specific plan pages/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /open plan catalog/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/TENANT_NOT_FOUND/)).not.toBeInTheDocument()
    expect(getEffectiveEntitlementsMock).not.toHaveBeenCalled()
  })
})

function createSession({
  platformRoles,
  tenantIds
}: {
  platformRoles: string[]
  tenantIds?: string[]
}) {
  return {
    principal: {
      userId: 'usr_test',
      username: 'operator',
      displayName: 'Operator',
      primaryEmail: 'operator@example.com',
      state: 'active',
      platformRoles,
      tenantIds
    }
  }
}
