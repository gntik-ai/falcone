import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ConsolePlanDetailPage } from './ConsolePlanDetailPage'
import type { LimitProfileRow, PlanRecord } from '@/services/planManagementApi'

const planApi = vi.hoisted(() => ({
  getPlan: vi.fn(),
  getPlanLimitsProfile: vi.fn(),
  setPlanLimit: vi.fn(),
  removePlanLimit: vi.fn(),
  transitionPlanLifecycle: vi.fn(),
  deletePlan: vi.fn()
}))

vi.mock('@/services/planManagementApi', () => planApi)

const plan: PlanRecord = {
  id: 'p1',
  slug: 'starter',
  displayName: 'Starter',
  description: 'Desc',
  status: 'active',
  capabilities: { api: true },
  quotaDimensions: {}
}

function limitRow(effectiveValue: number, source: LimitProfileRow['source'] = 'explicit'): LimitProfileRow {
  return {
    dimensionKey: 'max_workspaces',
    displayLabel: 'Max workspaces',
    unit: 'count',
    effectiveValue,
    source,
    unlimitedSentinel: effectiveValue === -1
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/console/plans/p1']}>
      <Routes>
        <Route path="/console/plans/:planId" element={<ConsolePlanDetailPage />} />
        <Route path="/console/plans" element={<div>Catálogo listo</div>} />
      </Routes>
    </MemoryRouter>
  )
}

async function openLimitsTab() {
  expect(await screen.findByText('Starter')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: /límites/i }))
  return screen.findByLabelText(/max workspaces: valor del límite/i) as Promise<HTMLInputElement>
}

async function tabPastLimitReset() {
  await userEvent.tab()
  await userEvent.tab()
}

const apiError = (status: number, code: string) => Object.assign(new Error(code), { status, code })

describe('ConsolePlanDetailPage', () => {
  beforeEach(() => {
    planApi.getPlan.mockReset()
    planApi.getPlanLimitsProfile.mockReset()
    planApi.setPlanLimit.mockReset()
    planApi.removePlanLimit.mockReset()
    planApi.transitionPlanLifecycle.mockReset()
    planApi.deletePlan.mockReset()

    planApi.getPlan.mockResolvedValue(plan)
    planApi.getPlanLimitsProfile.mockResolvedValue({ planId: 'p1', profile: [limitRow(10)] })
    planApi.transitionPlanLifecycle.mockResolvedValue({
      planId: 'p1',
      previousStatus: 'draft',
      newStatus: 'active',
      transitionedAt: '2026-07-01T00:00:00Z'
    })
    planApi.deletePlan.mockResolvedValue({ planId: 'p1', deleted: true })
  })

  it('renders plan detail tabs', async () => {
    renderPage()
    expect(await screen.findByText('Starter')).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: /detalle del plan/i })).toHaveAttribute('data-slot', 'tabs-list')
    expect(screen.getByRole('tab', { name: /información/i })).toHaveAttribute('data-slot', 'tabs-trigger')
    expect(screen.getByRole('tab', { name: /información/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /capacidades/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /asignaciones de organizaciones/i })).toBeInTheDocument()
  })

  it('[#751] marks the active detail tab with the shared Tabs state and renders one active panel', async () => {
    renderPage()

    expect(await screen.findByText('Starter')).toBeInTheDocument()
    const infoTab = screen.getByRole('tab', { name: /información/i })
    const capabilitiesTab = screen.getByRole('tab', { name: /capacidades/i })
    expect(infoTab).toHaveAttribute('data-state', 'active')
    expect(capabilitiesTab).toHaveAttribute('data-state', 'inactive')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-slot', 'tabs-content')
    expect(screen.getByRole('tabpanel')).toHaveTextContent(/resumen del plan/i)

    await userEvent.click(capabilitiesTab)

    expect(infoTab).toHaveAttribute('data-state', 'inactive')
    expect(capabilitiesTab).toHaveAttribute('data-state', 'active')
    expect(screen.getByRole('tabpanel')).toHaveTextContent(/funciones habilitadas/i)
  })

  it('offers lifecycle controls on a draft plan and reflects the activated status', async () => {
    planApi.getPlan
      .mockResolvedValueOnce({ ...plan, status: 'draft' })
      .mockResolvedValueOnce({ ...plan, status: 'active', updatedAt: '2026-07-01T00:00:00Z' })
    planApi.transitionPlanLifecycle.mockResolvedValue({
      planId: 'p1',
      previousStatus: 'draft',
      newStatus: 'active',
      transitionedAt: '2026-07-01T00:00:00Z'
    })

    renderPage()

    expect(await screen.findByRole('button', { name: /activar plan/i })).toBeInTheDocument()
    expect(screen.getByText('Borrador', { selector: '[aria-current="step"]' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /activar plan/i }))

    await waitFor(() => expect(planApi.transitionPlanLifecycle).toHaveBeenCalledWith('p1', { targetStatus: 'active' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/estado del plan actualizado/i)
    await waitFor(() => expect(screen.getByText('Activo', { selector: '[aria-current="step"]' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /marcar como obsoleto/i })).toBeInTheDocument()
  })

  it('guards plan deletion behind confirmation and returns to the catalog after success', async () => {
    planApi.getPlan.mockResolvedValue({ ...plan, status: 'draft' })

    renderPage()

    expect(await screen.findByRole('button', { name: /eliminar plan/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /eliminar plan/i }))

    expect(screen.getByRole('alertdialog', { name: /eliminar plan/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^eliminar$/i })).toBeDisabled()

    await userEvent.type(screen.getByPlaceholderText('Starter'), 'Starter')
    await userEvent.click(screen.getByRole('button', { name: /^eliminar$/i }))

    await waitFor(() => expect(planApi.deletePlan).toHaveBeenCalledWith('p1'))
    expect(await screen.findByText('Catálogo listo')).toBeInTheDocument()
  })

  it('requires confirmation before deprecating a plan and surfaces transition refusals in the dialog', async () => {
    planApi.getPlan.mockResolvedValue({ ...plan, status: 'active', assignedTenantCount: 1 })
    planApi.transitionPlanLifecycle.mockRejectedValue(apiError(409, 'PLAN_HAS_ACTIVE_ASSIGNMENTS'))

    renderPage()

    expect(await screen.findByRole('button', { name: /marcar como obsoleto/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /eliminar plan/i })).toBeDisabled()
    expect(screen.getByText(/los planes activos se retiran/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /marcar como obsoleto/i }))

    expect(screen.getByRole('alertdialog', { name: /confirmar acción/i })).toBeInTheDocument()
    expect(planApi.transitionPlanLifecycle).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /^confirmar$/i }))

    await waitFor(() => expect(planApi.transitionPlanLifecycle).toHaveBeenCalledWith('p1', { targetStatus: 'deprecated' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/plan_has_active_assignments/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/organizaciones activas/i)
  })

  it('[#743] localiza el error de carga inicial — nunca el mensaje crudo del backend', async () => {
    planApi.getPlan.mockRejectedValue(Object.assign(new Error('requires superadmin'), { status: 403, code: 'FORBIDDEN' }))
    planApi.getPlanLimitsProfile.mockResolvedValue({ planId: 'p1', profile: [] })

    renderPage()

    const state = await screen.findByRole('alert', { name: /no se pudo cargar el plan/i })
    expect(state).toHaveTextContent(/no tienes permiso/i)
    expect(state.textContent ?? '').not.toMatch(/requires superadmin/i)
  })

  it('[#743] las transiciones de ciclo de vida con un código no reconocido localizan el mensaje — nunca el texto crudo', async () => {
    planApi.getPlan.mockResolvedValue({ ...plan, status: 'active', assignedTenantCount: 1 })
    planApi.transitionPlanLifecycle.mockRejectedValue(
      Object.assign(new Error('No action mapped for POST /v1/plans/p1/lifecycle'), { status: 400, code: 'SOME_UNRECOGNIZED_CODE' })
    )

    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /marcar como obsoleto/i }))
    await userEvent.click(screen.getByRole('button', { name: /^confirmar$/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent ?? '').not.toMatch(/no action mapped/i)
    expect(alert.textContent?.trim()).not.toBe('')
  })

  it('keeps backend deletion refusals visible in the confirmation dialog', async () => {
    planApi.getPlan.mockResolvedValue({ ...plan, status: 'draft', assignedTenantCount: 0 })
    planApi.deletePlan.mockRejectedValue(apiError(409, 'PLAN_HAS_ASSIGNMENT_HISTORY'))

    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /eliminar plan/i }))
    await userEvent.type(screen.getByPlaceholderText('Starter'), 'Starter')
    await userEvent.click(screen.getByRole('button', { name: /^eliminar$/i }))

    await waitFor(() => expect(planApi.deletePlan).toHaveBeenCalledWith('p1'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/plan_has_assignment_history/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/archívalo/i)
    expect(screen.queryByText('Catálogo listo')).not.toBeInTheDocument()
  })

  it('shows an explicit error and restores the persisted value when the API rejects an edit', async () => {
    planApi.getPlanLimitsProfile
      .mockResolvedValueOnce({ planId: 'p1', profile: [limitRow(10)] })
      .mockResolvedValueOnce({ planId: 'p1', profile: [limitRow(10)] })
    planApi.setPlanLimit.mockRejectedValue(apiError(400, 'INVALID_LIMIT_VALUE'))

    renderPage()
    const input = await openLimitsTab()

    await userEvent.clear(input)
    await userEvent.type(input, '1.5')
    await tabPastLimitReset()

    await waitFor(() => expect(planApi.setPlanLimit).toHaveBeenCalledWith('p1', 'max_workspaces', 1.5))
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid_limit_value/i)
    await waitFor(() => expect(input).toHaveValue(10))
    expect(screen.getByText('Explícito')).toBeInTheDocument()
  })

  it('updates the row from accepted API data after a successful edit', async () => {
    planApi.getPlanLimitsProfile
      .mockResolvedValueOnce({ planId: 'p1', profile: [limitRow(10)] })
      .mockResolvedValueOnce({ planId: 'p1', profile: [limitRow(42)] })
    planApi.setPlanLimit.mockResolvedValue({
      planId: 'p1',
      dimensionKey: 'max_workspaces',
      previousValue: 10,
      newValue: 42,
      source: 'explicit'
    })

    renderPage()
    const input = await openLimitsTab()

    await userEvent.clear(input)
    await userEvent.type(input, '41')
    await tabPastLimitReset()

    await waitFor(() => expect(planApi.setPlanLimit).toHaveBeenCalledWith('p1', 'max_workspaces', 41))
    expect(await screen.findByRole('status')).toHaveTextContent(/límite guardado/i)
    await waitFor(() => expect(input).toHaveValue(42))
    expect(screen.getByText('Explícito')).toBeInTheDocument()
  })

  it('shows the reverted default value without reload after reset succeeds', async () => {
    planApi.getPlanLimitsProfile
      .mockResolvedValueOnce({ planId: 'p1', profile: [limitRow(42)] })
      .mockResolvedValueOnce({ planId: 'p1', profile: [limitRow(5, 'default')] })
    planApi.removePlanLimit.mockResolvedValue({
      planId: 'p1',
      dimensionKey: 'max_workspaces',
      removedValue: 42,
      effectiveValue: 5,
      source: 'default'
    })

    renderPage()
    const input = await openLimitsTab()
    expect(input).toHaveValue(42)

    await userEvent.click(screen.getByRole('button', { name: /restablecer límite de max workspaces al valor predeterminado/i }))

    await waitFor(() => expect(planApi.removePlanLimit).toHaveBeenCalledWith('p1', 'max_workspaces'))
    expect(await screen.findByRole('status')).toHaveTextContent(/límite restablecido/i)
    await waitFor(() => expect(input).toHaveValue(5))
    expect(screen.getByText('Predeterminado')).toBeInTheDocument()
  })
})
