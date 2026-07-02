import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'

import { ConsoleFlowsPage } from './ConsoleFlowsPage'

const mockUseConsoleContext = vi.fn()
const mockListFlows = vi.fn()
const mockCreateFlowDraft = vi.fn()
const mockTriggerFlowSchedule = vi.fn()

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))

vi.mock('@/services/flowsApi', () => ({
  listFlows: (...args: unknown[]) => mockListFlows(...args),
  createFlowDraft: (...args: unknown[]) => mockCreateFlowDraft(...args),
  triggerFlowSchedule: (...args: unknown[]) => mockTriggerFlowSchedule(...args)
}))

// IMPORTANT: `@/lib/hooks/use-capability-gate` is intentionally NOT mocked here. This test
// must exercise the REAL fail-closed gate against the universal production state — the
// effective-capabilities map never contains a `workflows` key (it is absent from the
// boolean-capability catalog, migrations 104 + 114). If a Flows page were (re)wrapped in
// `CapabilityGate capability="workflows"`, the real gate would resolve to disabled and the
// content would render inside `[data-testid="capability-gate-disabled"]`. (#790)

function LocationProbe() {
  const location = useLocation()
  return (
    <>
      <div data-testid="current-path">{location.pathname}</div>
      <div data-testid="current-state">{JSON.stringify(location.state)}</div>
    </>
  )
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/console/flows']}>
      <ConsoleFlowsPage />
      <LocationProbe />
    </MemoryRouter>
  )
}

beforeEach(() => {
  mockUseConsoleContext.mockReset().mockReturnValue({
    activeWorkspaceId: 'wrk_alpha',
    // The real, universal capabilities map: NO `workflows` key (Flows is not plan-gated).
    capabilities: {
      sql_admin_api: false,
      passthrough_admin: false,
      realtime: false,
      webhooks: false,
      public_functions: false,
      custom_domains: false,
      scheduled_functions: false,
      backup_scope_access: false
    },
    capabilitiesLoading: false
  })
  mockListFlows.mockReset().mockResolvedValue({ items: [] })
  mockCreateFlowDraft.mockReset()
  mockTriggerFlowSchedule.mockReset().mockResolvedValue({
    status: 'triggered',
    scheduleId: 'ten_alpha:wrk_alpha:flow-alpha'
  })
})
afterEach(cleanup)

describe('ConsoleFlowsPage capability gating (#790)', () => {
  it('renders the Flows UI interactively for a tenant without a `workflows` capability key', async () => {
    renderPage()

    // The page content is present and NOT wrapped in the disabled capability-gate overlay.
    expect(await screen.findByTestId('console-flows-page')).toBeInTheDocument()
    expect(screen.getAllByText('Flujos').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByTestId('capability-gate-disabled')).not.toBeInTheDocument()
    expect(screen.queryByTestId('capability-gate-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('capability-gate-skeleton')).not.toBeInTheDocument()
  })

  it('renders the interactive "Flujo nuevo" affordance and the flow-name input', async () => {
    renderPage()

    await waitFor(() => expect(mockListFlows).toHaveBeenCalledWith('wrk_alpha'))

    // Key controls are rendered and live (not inside a `pointer-events-none` gate overlay).
    expect(screen.getByTestId('new-flow-name-input')).toBeInTheDocument()
    const newFlowButton = screen.getByRole('button', { name: /flujo nuevo/i })
    expect(newFlowButton).toBeInTheDocument()
  })

  it('links each flow row to that flow run history (#792)', async () => {
    mockListFlows.mockResolvedValue({
      items: [
        {
          flowId: 'flow-alpha',
          name: 'Alpha flow',
          status: 'published',
          updatedAt: '2026-06-30T12:00:00Z'
        }
      ]
    })

    renderPage()

    const row = await screen.findByTestId('flow-row')
    expect(screen.getByRole('columnheader', { name: /acciones/i })).toBeInTheDocument()
    expect(within(row).getByText('Publicado')).toBeInTheDocument()
    const openDesignerLink = within(row).getByRole('link', { name: /abrir diseñador para alpha flow/i })
    expect(openDesignerLink).toHaveAttribute('href', '/console/flows/flow-alpha')
    const runHistoryLink = within(row).getByRole('link', { name: /ver historial de ejecuciones para alpha flow/i })
    expect(runHistoryLink).toHaveAttribute('href', '/console/flows/flow-alpha/runs')
  })

  it('[#793] triggers a published flow and navigates to its run history with next-step state', async () => {
    mockListFlows.mockResolvedValue({
      items: [
        {
          flowId: 'flow-alpha',
          name: 'Alpha flow',
          status: 'published',
          updatedAt: '2026-06-30T12:00:00Z'
        }
      ]
    })
    const user = userEvent.setup()

    renderPage()

    const row = await screen.findByTestId('flow-row')
    await user.click(within(row).getByRole('button', { name: /ejecutar ahora alpha flow/i }))
    expect(mockTriggerFlowSchedule).not.toHaveBeenCalled()

    const dialog = screen.getByTestId('confirm-action-dialog')
    expect(dialog).toHaveTextContent(/ejecutar flujo ahora/i)
    await user.click(within(dialog).getByTestId('confirm-action-confirm'))

    await waitFor(() => expect(mockTriggerFlowSchedule).toHaveBeenCalledWith('wrk_alpha', 'flow-alpha'))
    await waitFor(() => expect(screen.getByTestId('current-path')).toHaveTextContent('/console/flows/flow-alpha/runs'))
    expect(screen.getByTestId('current-state')).toHaveTextContent('ten_alpha:wrk_alpha:flow-alpha')
  })

  it('[#793] disables Run now for draft flows and does not call the trigger API', async () => {
    mockListFlows.mockResolvedValue({
      items: [
        {
          flowId: 'flow-draft',
          name: 'Draft flow',
          status: 'draft',
          updatedAt: '2026-06-30T12:00:00Z'
        }
      ]
    })
    const user = userEvent.setup()

    renderPage()

    const row = await screen.findByTestId('flow-row')
    const runButton = within(row).getByRole('button', { name: /ejecutar ahora no disponible para draft flow/i })
    expect(runButton).toBeDisabled()
    expect(runButton).toHaveAttribute('title', 'Publica este flujo antes de ejecutarlo.')
    await user.click(runButton)
    expect(mockTriggerFlowSchedule).not.toHaveBeenCalled()
    expect(screen.queryByTestId('confirm-action-dialog')).not.toBeInTheDocument()
  })

  it('[#793] uses ConsolePageState for the no-workspace blocked state', () => {
    mockUseConsoleContext.mockReturnValue({ activeWorkspaceId: null, capabilities: {}, capabilitiesLoading: false })

    renderPage()

    expect(screen.getByRole('alert', { name: /flujos bloqueados/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /gestionar áreas de trabajo/i })).toBeInTheDocument()
  })
})
