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
  removePlanLimit: vi.fn()
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
      </Routes>
    </MemoryRouter>
  )
}

async function openLimitsTab() {
  expect(await screen.findByText('Starter')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /límites/i }))
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

    planApi.getPlan.mockResolvedValue(plan)
    planApi.getPlanLimitsProfile.mockResolvedValue({ planId: 'p1', profile: [limitRow(10)] })
  })

  it('renders plan detail tabs', async () => {
    renderPage()
    expect(await screen.findByText('Starter')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /capacidades/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /asignaciones de organizaciones/i })).toBeInTheDocument()
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
