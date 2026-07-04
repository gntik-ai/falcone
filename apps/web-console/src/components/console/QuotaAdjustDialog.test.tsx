import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { QuotaAdjustDialog, type QuotaAdjustTarget } from './QuotaAdjustDialog'
import type { ConsoleQuotaDimensionView } from '@/lib/console-quotas'

// Issue #750: "Ajustar cuota" on /console/quotas must actually persist. The only wired write
// path for a quota dimension's hard limit is the tenant's assigned PLAN limit
// (planManagementApi.setPlanLimit), so this dialog resolves the tenant's current plan first.
const planApi = vi.hoisted(() => ({
  getTenantCurrentPlan: vi.fn(),
  setPlanLimit: vi.fn()
}))

vi.mock('@/services/planManagementApi', () => planApi)

function dimension(overrides: Partial<ConsoleQuotaDimensionView> = {}): ConsoleQuotaDimensionView {
  return {
    dimensionId: 'max_workspaces',
    displayName: 'Maximum Workspaces',
    policyMode: 'enforced',
    hardLimit: 5,
    softLimit: null,
    measuredValue: 3,
    remainingToHardLimit: 2,
    pctUsed: 60,
    freshnessStatus: 'fresh',
    isWarning: false,
    isExceeded: false,
    ...overrides
  }
}

function makeTarget(overrides: Partial<QuotaAdjustTarget> = {}): QuotaAdjustTarget {
  return { tenantId: 'ten_1', dimension: dimension(), tableKey: 'Organización-max_workspaces', ...overrides }
}

function renderDialog(target: QuotaAdjustTarget | null = makeTarget()) {
  const onClose = vi.fn()
  const onAdjusted = vi.fn()
  const utils = render(
    <MemoryRouter>
      <QuotaAdjustDialog target={target} onClose={onClose} onAdjusted={onAdjusted} />
    </MemoryRouter>
  )
  return { ...utils, onClose, onAdjusted }
}

describe('QuotaAdjustDialog', () => {
  beforeEach(() => {
    planApi.getTenantCurrentPlan.mockReset()
    planApi.setPlanLimit.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders nothing when there is no adjust target', () => {
    renderDialog(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(planApi.getTenantCurrentPlan).not.toHaveBeenCalled()
  })

  it('resolves the tenant plan, submits the new limit via setPlanLimit, shows success feedback, and triggers a reload', async () => {
    planApi.getTenantCurrentPlan.mockResolvedValue({ assignment: { planId: 'plan_1' }, plan: { id: 'plan_1', displayName: 'Starter', status: 'active' } })
    planApi.setPlanLimit.mockResolvedValue({ planId: 'plan_1', dimensionKey: 'max_workspaces', newValue: 10, source: 'explicit' })
    const { onAdjusted } = renderDialog()

    expect(await screen.findByText(/starter/i)).toBeInTheDocument()
    const input = await screen.findByLabelText(/nuevo límite de maximum workspaces/i)
    expect(input).toHaveValue(5)

    await userEvent.clear(input)
    await userEvent.type(input, '10')
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    await waitFor(() => expect(planApi.setPlanLimit).toHaveBeenCalledWith('plan_1', 'max_workspaces', 10))
    expect(await screen.findByText(/límite guardado/i)).toBeInTheDocument()
    expect(onAdjusted).toHaveBeenCalledTimes(1)
  })

  it('shows an inline error and does not close the dialog or lose the unsaved value when setPlanLimit rejects', async () => {
    planApi.getTenantCurrentPlan.mockResolvedValue({ assignment: { planId: 'plan_1' }, plan: { id: 'plan_1', displayName: 'Starter', status: 'active' } })
    planApi.setPlanLimit.mockRejectedValue(Object.assign(new Error('bad value'), { code: 'INVALID_LIMIT_VALUE', status: 400 }))
    const { onClose, onAdjusted } = renderDialog()

    const input = await screen.findByLabelText(/nuevo límite de maximum workspaces/i)
    await userEvent.clear(input)
    await userEvent.type(input, '10')
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    expect(await screen.findByText(/INVALID_LIMIT_VALUE/)).toBeInTheDocument()
    expect(onAdjusted).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(input).toHaveValue(10)
  })

  it('shows an actionable no-plan state (not a dead end) when the tenant has no plan assigned', async () => {
    planApi.getTenantCurrentPlan.mockResolvedValue({ noAssignment: true, tenantId: 'ten_1' })
    renderDialog()

    expect(await screen.findByText(/no tiene un plan asignado/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ir a asignar plan/i })).toHaveAttribute('href', '/console/tenants/ten_1/plan')
    expect(screen.queryByRole('button', { name: /^guardar$/i })).not.toBeInTheDocument()
    expect(planApi.setPlanLimit).not.toHaveBeenCalled()
  })

  it('blocks editing with an explanation (and a CTA) when the assigned plan is frozen (archived/deprecated)', async () => {
    planApi.getTenantCurrentPlan.mockResolvedValue({ assignment: { planId: 'plan_2' }, plan: { id: 'plan_2', displayName: 'Legacy', status: 'archived' } })
    renderDialog()

    expect(await screen.findByText(/está retirado/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /abrir plan/i })).toHaveAttribute('href', '/console/plans/plan_2')
    expect(screen.queryByRole('button', { name: /^guardar$/i })).not.toBeInTheDocument()
  })

  it('rejects a non-integer/less-than--1 value client-side without calling the API', async () => {
    planApi.getTenantCurrentPlan.mockResolvedValue({ assignment: { planId: 'plan_1' }, plan: { id: 'plan_1', displayName: 'Starter', status: 'active' } })
    renderDialog()

    const input = await screen.findByLabelText(/nuevo límite de maximum workspaces/i)
    await userEvent.clear(input)
    await userEvent.type(input, '-5')
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    expect(await screen.findByText(/entero mayor o igual a -1/i)).toBeInTheDocument()
    expect(planApi.setPlanLimit).not.toHaveBeenCalled()
  })

  it('marks the field invalid and associates the validation message with it for screen readers', async () => {
    planApi.getTenantCurrentPlan.mockResolvedValue({ assignment: { planId: 'plan_1' }, plan: { id: 'plan_1', displayName: 'Starter', status: 'active' } })
    renderDialog()

    const input = await screen.findByLabelText(/nuevo límite de maximum workspaces/i)
    await userEvent.clear(input)
    await userEvent.type(input, '-5')
    await userEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    expect(input).toHaveAttribute('aria-invalid', 'true')
    const message = screen.getByText(/entero mayor o igual a -1/i)
    expect((input.getAttribute('aria-describedby') ?? '').split(' ')).toContain(message.id)
  })

  it('shows the current value and seeds an unbounded dimension as -1 (never a blank field)', async () => {
    planApi.getTenantCurrentPlan.mockResolvedValue({ assignment: { planId: 'plan_1' }, plan: { id: 'plan_1', displayName: 'Starter', status: 'active' } })
    renderDialog(makeTarget({ dimension: dimension({ hardLimit: null }) }))

    const input = await screen.findByLabelText(/nuevo límite de maximum workspaces/i)
    expect(input).toHaveValue(-1)
    expect(screen.getByText('Valor actual')).toBeInTheDocument()
    expect(screen.getByText('sin límite')).toBeInTheDocument()
  })

  it('lets the user retry plan resolution after a transient failure instead of dead-ending', async () => {
    planApi.getTenantCurrentPlan
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ assignment: { planId: 'plan_1' }, plan: { id: 'plan_1', displayName: 'Starter', status: 'active' } })
    renderDialog()

    expect(await screen.findByText(/no se pudo resolver el plan/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }))

    expect(await screen.findByLabelText(/nuevo límite de maximum workspaces/i)).toBeInTheDocument()
    expect(planApi.getTenantCurrentPlan).toHaveBeenCalledTimes(2)
  })
})
