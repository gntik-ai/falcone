import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsoleTenantPlanPage } from './ConsoleTenantPlanPage'

// getEffectiveEntitlements returns the REAL effective-entitlements API shape
// (services/provisioning-orchestrator EffectiveEntitlementProfile): quota limits
// live under `quantitativeLimits` with a per-item `currentUsage` — NOT under
// `quotaDimensions`/`observedUsage`. On main the component reads
// `summary.quotaDimensions` (undefined here) and `.map` throws, so render fails and
// this test ERRORS (RED). On the branch it reads `quantitativeLimits` and renders the
// row (GREEN). The asserted "Flow signal rate" text comes from the mocked
// `quantitativeLimits` entry, so the guard is not tautological.
const { getTenantCurrentPlanMock, getEffectiveEntitlementsMock, getPlanChangeHistoryMock, listPlansMock } = vi.hoisted(() => ({
  getTenantCurrentPlanMock: vi.fn(),
  getEffectiveEntitlementsMock: vi.fn(),
  getPlanChangeHistoryMock: vi.fn(),
  listPlansMock: vi.fn()
}))

vi.mock('@/services/planManagementApi', () => ({
  getTenantCurrentPlan: getTenantCurrentPlanMock,
  getEffectiveEntitlements: getEffectiveEntitlementsMock,
  getPlanChangeHistory: getPlanChangeHistoryMock,
  listPlans: listPlansMock,
  assignPlan: vi.fn()
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/console/tenants/ten_1/plan']}>
      <Routes>
        <Route path="/console/tenants/:tenantId/plan" element={<ConsoleTenantPlanPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ConsoleTenantPlanPage', () => {
  afterEach(() => {
    cleanup()
    getTenantCurrentPlanMock.mockReset()
    getEffectiveEntitlementsMock.mockReset()
    getPlanChangeHistoryMock.mockReset()
    listPlansMock.mockReset()
  })

  it('renders current assignment, change action, and quota limits from quantitativeLimits', async () => {
    getTenantCurrentPlanMock.mockResolvedValue({ assignment: { planId: 'p1' }, plan: { displayName: 'Starter', status: 'active' } })
    getEffectiveEntitlementsMock.mockResolvedValue({
      tenantId: 'ten_1',
      planSlug: 'starter',
      planStatus: 'active',
      quantitativeLimits: [{ dimensionKey: 'flow_signal_rate_per_minute', displayLabel: 'Flow signal rate', unit: 'per_minute', effectiveValue: 100, source: 'plan', quotaType: 'hard', currentUsage: 12, usageStatus: 'within_limit' }],
      capabilities: []
    })
    getPlanChangeHistoryMock.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    listPlansMock.mockResolvedValue({ items: [{ id: 'p1', displayName: 'Starter', status: 'active' }], total: 1, page: 1, pageSize: 20 })

    renderPage()
    expect(await screen.findByText('Starter')).toBeInTheDocument()
    // Breadcrumb names the destination as the user reached it: the nav item + inventory H1 both
    // read "Gestión de organizaciones" (#752 wayfinding alignment).
    expect(screen.getByRole('link', { name: /gestión de organizaciones/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cambiar plan/i })).toBeInTheDocument()
    // Limit row is populated from the API's `quantitativeLimits` (the discriminating guard).
    expect(await screen.findByText('Flow signal rate')).toBeInTheDocument()
  })

  it('[#743] localiza un error 403 del backend — nunca el texto crudo — y permite reintentar', async () => {
    getTenantCurrentPlanMock
      .mockRejectedValueOnce({ status: 403, code: 'FORBIDDEN', message: 'requires superadmin' })
      .mockResolvedValueOnce({ assignment: { planId: 'p1' }, plan: { displayName: 'Starter', status: 'active' } })
    getEffectiveEntitlementsMock.mockResolvedValue({ tenantId: 'ten_1', planSlug: 'starter', planStatus: 'active', quantitativeLimits: [], capabilities: [] })
    getPlanChangeHistoryMock.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    listPlansMock.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    const user = userEvent.setup()

    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/no tienes permiso/i)
    expect(alert.textContent ?? '').not.toMatch(/requires superadmin/i)

    await user.click(screen.getByRole('button', { name: /reintentar/i }))

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(await screen.findByText('Starter')).toBeInTheDocument()
    expect(getTenantCurrentPlanMock).toHaveBeenCalledTimes(2)
  })
})
