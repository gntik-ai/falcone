import type { ReactNode } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

import { ConsoleFlowDesignerPage } from './ConsoleFlowDesignerPage'

const mockUseConsoleContext = vi.fn()
const mockGetFlow = vi.fn()
const mockTriggerFlowSchedule = vi.fn()
const mockUpdateFlowDraft = vi.fn()

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))

vi.mock('@/services/flowsApi', () => ({
  getFlow: (...args: unknown[]) => mockGetFlow(...args),
  isFlowApiError: () => false,
  publishFlow: vi.fn(),
  triggerFlowSchedule: (...args: unknown[]) => mockTriggerFlowSchedule(...args),
  updateFlowDraft: (...args: unknown[]) => mockUpdateFlowDraft(...args)
}))

vi.mock('@xyflow/react', () => ({
  ReactFlowProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="react-flow-provider-stub">{children}</div>
  ),
  ReactFlow: ({ children }: { children?: ReactNode }) => (
    <div data-testid="react-flow-stub">{children}</div>
  ),
  Background: () => <div data-testid="react-flow-background-stub" />,
  Controls: () => <div data-testid="react-flow-controls-stub" />,
  useReactFlow: () => ({
    screenToFlowPosition: (point: { x: number; y: number }) => point
  }),
  applyEdgeChanges: (_changes: unknown, edges: unknown[]) => edges,
  applyNodeChanges: (_changes: unknown, nodes: unknown[]) => nodes
}))

vi.mock('@/components/flows/FlowPalette', () => ({
  FLOW_PALETTE_DRAG_MIME: 'application/x-falcone-flow-node',
  FlowPalette: () => <div data-testid="flow-palette-stub" />
}))

function LocationProbe() {
  const location = useLocation()
  return (
    <>
      <div data-testid="current-path">{location.pathname}</div>
      <div data-testid="current-state">{JSON.stringify(location.state)}</div>
    </>
  )
}

function renderPage(flowId = 'flow-1') {
  return render(
    <MemoryRouter initialEntries={[`/console/flows/${flowId}`]}>
      <Routes>
        <Route
          path="/console/flows/:flowId"
          element={(
            <>
              <ConsoleFlowDesignerPage />
              <LocationProbe />
            </>
          )}
        />
        <Route path="/console/flows/:flowId/runs" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  mockUseConsoleContext.mockReset().mockReturnValue({ activeWorkspaceId: 'ws1' })
  mockUpdateFlowDraft.mockReset()
  mockGetFlow.mockReset().mockResolvedValue({
    flowId: 'flow-1',
    name: 'Alpha flow',
    status: 'draft',
    definition: {
      apiVersion: 'v1.0',
      name: 'Alpha flow',
      nodes: []
    }
  })
  mockTriggerFlowSchedule.mockReset().mockResolvedValue({
    status: 'triggered',
    scheduleId: 'ten1:ws1:flow-1'
  })
})
afterEach(cleanup)

describe('ConsoleFlowDesignerPage run-history navigation (#792)', () => {
  it('links from the designer header to that flow run history', async () => {
    renderPage()

    await waitFor(() => expect(mockGetFlow).toHaveBeenCalledWith('ws1', 'flow-1'))
    expect(screen.getByRole('tablist', { name: /vista del flujo/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /lienzo/i })).toBeInTheDocument()
    const runHistoryLink = screen.getByRole('link', { name: /ver historial de ejecuciones para alpha flow/i })
    expect(runHistoryLink).toHaveAttribute('href', '/console/flows/flow-1/runs')
  })

  it('muestra fallback de carga en español cuando el error no trae mensaje', async () => {
    mockGetFlow.mockRejectedValueOnce('network-failed')
    renderPage()
    expect(await screen.findByText('No se pudo cargar el flujo.')).toBeInTheDocument()
  })

  it('[#793] triggers a published flow from the designer and navigates to run history', async () => {
    mockGetFlow.mockResolvedValueOnce({
      flowId: 'flow-1',
      name: 'Alpha flow',
      status: 'published',
      definition: {
        apiVersion: 'v1.0',
        name: 'Alpha flow',
        nodes: []
      }
    })
    const user = userEvent.setup()

    renderPage()

    await waitFor(() => expect(mockGetFlow).toHaveBeenCalledWith('ws1', 'flow-1'))
    await user.click(screen.getByRole('button', { name: /ejecutar ahora alpha flow/i }))

    const dialog = screen.getByTestId('confirm-action-dialog')
    await user.click(within(dialog).getByTestId('confirm-action-confirm'))

    await waitFor(() => expect(mockTriggerFlowSchedule).toHaveBeenCalledWith('ws1', 'flow-1'))
    await waitFor(() => expect(screen.getByTestId('current-path')).toHaveTextContent('/console/flows/flow-1/runs'))
    expect(screen.getByTestId('current-state')).toHaveTextContent('ten1:ws1:flow-1')
  })
})

describe('ConsoleFlowDesignerPage save-error banner (#743)', () => {
  it('localiza el error de guardado — nunca el mensaje crudo del backend', async () => {
    mockUpdateFlowDraft.mockRejectedValueOnce({ status: 403, code: 'FORBIDDEN', message: 'requires superadmin' })
    const user = userEvent.setup()

    renderPage()

    await waitFor(() => expect(mockGetFlow).toHaveBeenCalledWith('ws1', 'flow-1'))
    await user.click(screen.getByTestId('save-draft-button'))

    const banner = await screen.findByText(/no tienes permiso/i)
    expect(banner.textContent ?? '').not.toMatch(/requires superadmin/i)
  })
})

// #742: the no-workspace guard is the shared WorkspaceRequiredState, not a static blocked state
// whose only action navigated away.
describe('ConsoleFlowDesignerPage — no active workspace', () => {
  it('[#742] shows the shared WorkspaceRequiredState instead of loading the flow', () => {
    mockGetFlow.mockReset()
    mockUseConsoleContext.mockReturnValue({
      activeWorkspaceId: null,
      workspaces: [],
      workspacesLoading: false,
      workspacesError: null,
      selectWorkspace: vi.fn(),
      reloadWorkspaces: vi.fn()
    })

    renderPage()

    expect(mockGetFlow).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Diseñador bloqueado' })).toBeInTheDocument()
    expect(screen.getByText(/selecciona un área de trabajo para abrir el diseñador/i)).toBeInTheDocument()
  })
})
