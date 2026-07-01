import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { ConsoleFlowsPage } from './ConsoleFlowsPage'

const mockUseConsoleContext = vi.fn()
const mockListFlows = vi.fn()
const mockCreateFlowDraft = vi.fn()

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))

vi.mock('@/services/flowsApi', () => ({
  listFlows: (...args: unknown[]) => mockListFlows(...args),
  createFlowDraft: (...args: unknown[]) => mockCreateFlowDraft(...args)
}))

// IMPORTANT: `@/lib/hooks/use-capability-gate` is intentionally NOT mocked here. This test
// must exercise the REAL fail-closed gate against the universal production state — the
// effective-capabilities map never contains a `workflows` key (it is absent from the
// boolean-capability catalog, migrations 104 + 114). If a Flows page were (re)wrapped in
// `CapabilityGate capability="workflows"`, the real gate would resolve to disabled and the
// content would render inside `[data-testid="capability-gate-disabled"]`. (#790)

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/console/flows']}>
      <ConsoleFlowsPage />
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
})
