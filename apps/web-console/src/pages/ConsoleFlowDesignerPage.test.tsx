import type { ReactNode } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { ConsoleFlowDesignerPage } from './ConsoleFlowDesignerPage'

const mockUseConsoleContext = vi.fn()
const mockGetFlow = vi.fn()

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))

vi.mock('@/services/flowsApi', () => ({
  getFlow: (...args: unknown[]) => mockGetFlow(...args),
  isFlowApiError: () => false,
  publishFlow: vi.fn(),
  updateFlowDraft: vi.fn()
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

function renderPage(flowId = 'flow-1') {
  return render(
    <MemoryRouter initialEntries={[`/console/flows/${flowId}`]}>
      <Routes>
        <Route path="/console/flows/:flowId" element={<ConsoleFlowDesignerPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  mockUseConsoleContext.mockReset().mockReturnValue({ activeWorkspaceId: 'ws1' })
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
})
afterEach(cleanup)

describe('ConsoleFlowDesignerPage run-history navigation (#792)', () => {
  it('links from the designer header to that flow run history', async () => {
    renderPage()

    await waitFor(() => expect(mockGetFlow).toHaveBeenCalledWith('ws1', 'flow-1'))
    const runHistoryLink = screen.getByRole('link', { name: /view run history for alpha flow/i })
    expect(runHistoryLink).toHaveAttribute('href', '/console/flows/flow-1/runs')
  })
})
