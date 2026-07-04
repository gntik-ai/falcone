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

  // getEffectiveEntitlements returns the REAL effective-entitlements API shape
  // (services/provisioning-orchestrator EffectiveEntitlementProfile): quota limits
  // live under `quantitativeLimits` with a per-item `currentUsage` — there is NO
  // `quotaDimensions`/`observedUsage` field on this response. On main the component
  // reads `summary.quotaDimensions` (undefined here) and `.filter`/`.map` throws, so
  // render fails and this test ERRORS (RED). On the branch it reads
  // `quantitativeLimits` and renders the row (GREEN). The asserted "Workspaces" text
  // comes from the mocked `quantitativeLimits` entry, so the guard is not tautological.
  it('renders tenant owner plan overview from quantitativeLimits', async () => {
    readConsoleShellSessionMock.mockReturnValue(createSession({ platformRoles: ['tenant_owner'], tenantIds: ['ten_alpha'] }))
    getEffectiveEntitlementsMock.mockResolvedValue({
      tenantId: 'ten_alpha',
      planSlug: 'starter',
      planStatus: 'active',
      quantitativeLimits: [{ dimensionKey: 'max_workspaces', displayLabel: 'Workspaces', unit: null, effectiveValue: 10, source: 'plan', quotaType: 'hard', currentUsage: 3, usageStatus: 'within_limit' }],
      capabilities: [{ capabilityKey: 'realtime', displayLabel: 'Realtime', enabled: true }]
    })

    render(<MemoryRouter><ConsoleTenantPlanOverviewPage /></MemoryRouter>)

    expect(await screen.findByText('starter')).toBeInTheDocument()
    expect(screen.getByText('Workspaces')).toBeInTheDocument()
    expect(screen.getByText('Realtime')).toBeInTheDocument()
    expect(getEffectiveEntitlementsMock).toHaveBeenCalledWith(undefined, { includeConsumption: true })
  })

  // Scenario 2 (issue #735): an absent/empty `quantitativeLimits` collection must render
  // a clear "no quotas" empty state instead of throwing when `.filter`/`.map` is called
  // on it. On main this ALSO errors identically to the populated case (undefined
  // `quotaDimensions`), so this is RED on main and GREEN on the branch.
  it('renders a no-quotas empty state when quantitativeLimits is absent, not a crash', async () => {
    readConsoleShellSessionMock.mockReturnValue(createSession({ platformRoles: ['tenant_owner'], tenantIds: ['ten_alpha'] }))
    getEffectiveEntitlementsMock.mockResolvedValue({
      tenantId: 'ten_alpha',
      planSlug: 'starter',
      planStatus: 'active',
      capabilities: []
    })

    render(<MemoryRouter><ConsoleTenantPlanOverviewPage /></MemoryRouter>)

    expect(await screen.findByRole('status', { name: /sin cuotas/i })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  // Same empty-state requirement, but for an explicitly empty array rather than an
  // absent field.
  it('renders a no-quotas empty state when quantitativeLimits is an empty array', async () => {
    readConsoleShellSessionMock.mockReturnValue(createSession({ platformRoles: ['tenant_owner'], tenantIds: ['ten_alpha'] }))
    getEffectiveEntitlementsMock.mockResolvedValue({
      tenantId: 'ten_alpha',
      planSlug: 'starter',
      planStatus: 'active',
      quantitativeLimits: [],
      capabilities: []
    })

    render(<MemoryRouter><ConsoleTenantPlanOverviewPage /></MemoryRouter>)

    expect(await screen.findByRole('status', { name: /sin cuotas/i })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('renders an accessible error state when the entitlements fetch rejects, not a white screen', async () => {
    readConsoleShellSessionMock.mockReturnValue(createSession({ platformRoles: ['tenant_owner'], tenantIds: ['ten_alpha'] }))
    getEffectiveEntitlementsMock.mockRejectedValue(new Error('NETWORK_ERROR'))

    render(<MemoryRouter><ConsoleTenantPlanOverviewPage /></MemoryRouter>)

    expect(await screen.findByRole('alert', { name: /resumen del plan no disponible/i })).toBeInTheDocument()
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

    expect(await screen.findByRole('status', { name: /sin plan personal de organización/i })).toBeInTheDocument()
    expect(screen.getByText(/cuenta de nivel plataforma no está asociada a una organización/i)).toBeInTheDocument()
    expect(screen.queryByText(/TENANT_NOT_FOUND/)).not.toBeInTheDocument()
    expect(getEffectiveEntitlementsMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /abrir catálogo de planes/i }))

    expect(screen.getByRole('heading', { name: /plan catalog target/i })).toBeInTheDocument()
  })

  it('renders a platform-operator no-personal-plan state without a gated catalog action', async () => {
    readConsoleShellSessionMock.mockReturnValue(createSession({ platformRoles: ['platform_operator'], tenantIds: [] }))

    render(<MemoryRouter><ConsoleTenantPlanOverviewPage /></MemoryRouter>)

    expect(await screen.findByRole('status', { name: /sin plan personal de organización/i })).toBeInTheDocument()
    expect(screen.getByText(/derechos de la organización se revisan desde páginas específicas/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /abrir catálogo de planes/i })).not.toBeInTheDocument()
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
