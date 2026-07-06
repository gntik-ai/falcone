import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleQuotasPage } from './ConsoleQuotasPage'

// #766: the posture badge header now links to `/console/quotas` (wayfinding), so every render
// needs a Router context.
function renderPage() {
  return render(<ConsoleQuotasPage />, { wrapper: MemoryRouter })
}

const mockUseConsoleContext = vi.fn()
const mockUseConsoleQuotas = vi.fn()
const mockReadConsoleShellSession = vi.fn()

// Issue #750: "Ajustar cuota" must be wired to the quota/limit API (via the tenant's assigned
// plan — see QuotaAdjustDialog), not a dead button. Mock the plan API so this page-level test can
// drive the full click -> resolve plan -> submit -> reload flow.
const planApi = vi.hoisted(() => ({
  getTenantCurrentPlan: vi.fn(),
  setPlanLimit: vi.fn()
}))

vi.mock('@/lib/console-context', () => ({ useConsoleContext: () => mockUseConsoleContext() }))
vi.mock('@/lib/console-quotas', async () => {
  const actual = await vi.importActual<typeof import('@/lib/console-quotas')>('@/lib/console-quotas')
  return { ...actual, useConsoleQuotas: (...args: unknown[]) => mockUseConsoleQuotas(...args) }
})
vi.mock('@/lib/console-session', () => ({ readConsoleShellSession: () => mockReadConsoleShellSession() }))
vi.mock('@/services/planManagementApi', () => planApi)

describe('ConsoleQuotasPage', () => {
  beforeEach(() => {
    planApi.getTenantCurrentPlan.mockReset()
    planApi.setPlanLimit.mockReset()
  })

  afterEach(() => {
    cleanup()
    mockUseConsoleContext.mockReset()
    mockUseConsoleQuotas.mockReset()
  })

  it('renderiza warning, exceeded y CTA superadmin sin el descargo de T01', () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['platform_operator'] } })
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeTenant: { label: 'Tenant' }, activeWorkspaceId: 'wrk_1' })
    mockUseConsoleQuotas.mockReturnValue({ posture: { overallPosture: 'warning_threshold_reached', evaluatedAt: 'now', dimensions: [{ dimensionId: 'api', displayName: 'API', hardLimit: 10, softLimit: null, measuredValue: 8, remainingToHardLimit: 2, pctUsed: 80, policyMode: 'enforced', freshnessStatus: 'fresh', isWarning: true, isExceeded: false }, { dimensionId: 'storage', displayName: 'Storage', hardLimit: 10, softLimit: null, measuredValue: 11, remainingToHardLimit: 0, pctUsed: 110, policyMode: 'enforced', freshnessStatus: 'fresh', isWarning: false, isExceeded: true }], generatedAt: 'now', hardLimitDimensions: [] }, workspacePosture: null, loading: false, error: null, reload: vi.fn() })
    renderPage()
    expect(screen.getByText('API')).toBeInTheDocument()
    expect(screen.getByText('Storage')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /ajustar cuota/i }).length).toBeGreaterThan(0)
    // The old "out of scope" scaffolding disclaimer must be gone now that the action is wired.
    expect(screen.queryByText(/fuera de T01/i)).not.toBeInTheDocument()
  })

  it('WHEN a superadmin adjusts a dimension hard limit and confirms THEN it persists via the plan-limit API, shows a success confirmation, and refreshes the quotas table', async () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['superadmin'] } })
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeTenant: { label: 'Tenant' }, activeWorkspaceId: 'wrk_1' })
    const reload = vi.fn()
    mockUseConsoleQuotas.mockReturnValue({
      posture: { overallPosture: 'within_limit', evaluatedAt: 'now', dimensions: [{ dimensionId: 'max_workspaces', displayName: 'Maximum Workspaces', hardLimit: 5, softLimit: null, measuredValue: 3, remainingToHardLimit: 2, pctUsed: 60, policyMode: 'enforced', freshnessStatus: 'fresh', isWarning: false, isExceeded: false }], generatedAt: 'now', hardLimitDimensions: [] },
      workspacePosture: null,
      loading: false,
      error: null,
      reload
    })
    planApi.getTenantCurrentPlan.mockResolvedValue({ assignment: { planId: 'plan_1' }, plan: { id: 'plan_1', displayName: 'Starter', status: 'active' } })
    planApi.setPlanLimit.mockResolvedValue({ planId: 'plan_1', dimensionKey: 'max_workspaces', newValue: 10, source: 'explicit' })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /ajustar cuota de maximum workspaces/i }))

    const input = await screen.findByLabelText(/nuevo límite de maximum workspaces/i)
    await userEvent.clear(input)
    await userEvent.type(input, '10')
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    await waitFor(() => expect(planApi.setPlanLimit).toHaveBeenCalledWith('plan_1', 'max_workspaces', 10))
    expect(await screen.findByText(/límite guardado/i)).toBeInTheDocument()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('WHEN the plan-limit API rejects the change THEN it shows an error and does not refresh the table', async () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['superadmin'] } })
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeTenant: { label: 'Tenant' }, activeWorkspaceId: 'wrk_1' })
    const reload = vi.fn()
    mockUseConsoleQuotas.mockReturnValue({
      posture: { overallPosture: 'within_limit', evaluatedAt: 'now', dimensions: [{ dimensionId: 'max_workspaces', displayName: 'Maximum Workspaces', hardLimit: 5, softLimit: null, measuredValue: 3, remainingToHardLimit: 2, pctUsed: 60, policyMode: 'enforced', freshnessStatus: 'fresh', isWarning: false, isExceeded: false }], generatedAt: 'now', hardLimitDimensions: [] },
      workspacePosture: null,
      loading: false,
      error: null,
      reload
    })
    planApi.getTenantCurrentPlan.mockResolvedValue({ assignment: { planId: 'plan_1' }, plan: { id: 'plan_1', displayName: 'Starter', status: 'active' } })
    planApi.setPlanLimit.mockRejectedValue(Object.assign(new Error('nope'), { code: 'PLAN_LIMITS_FROZEN', status: 409 }))

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /ajustar cuota de maximum workspaces/i }))

    const input = await screen.findByLabelText(/nuevo límite de maximum workspaces/i)
    await userEvent.clear(input)
    await userEvent.type(input, '10')
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    expect(await screen.findByText(/PLAN_LIMITS_FROZEN/)).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
  })
})
