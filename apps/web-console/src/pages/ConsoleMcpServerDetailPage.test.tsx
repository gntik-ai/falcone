import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleMcpServerDetailPage } from './ConsoleMcpServerDetailPage'

const fetchMcpServerDetailMock = vi.fn()
const consoleContextMock = {
  activeWorkspaceId: 'ws_1' as string | null,
  workspacesLoading: false
}

vi.mock('@/lib/mcp/mcp-api', () => ({
  fetchMcpServerDetail: (...args: unknown[]) => fetchMcpServerDetailMock(...args),
  invokeMcpTool: vi.fn()
}))
vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => consoleContextMock
}))

function renderPage(path = '/console/mcp/servers/srv_1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/console/mcp/servers/:mcpServerId" element={<ConsoleMcpServerDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ConsoleMcpServerDetailPage', () => {
  beforeEach(() => {
    fetchMcpServerDetailMock.mockReset()
    consoleContextMock.activeWorkspaceId = 'ws_1'
    consoleContextMock.workspacesLoading = false
  })

  it('shows the endpoint, active version and curated tool list on success', async () => {
    fetchMcpServerDetailMock.mockResolvedValue({
      id: 'srv_1',
      name: 'Acme Orders',
      slug: 'acme-orders',
      status: 'running',
      endpointUrl: 'https://gw.example.test/mcp/acme-orders',
      activeVersion: { version: 'v3', source: 'instant', tools: [{ name: 'list_orders', description: 'list', mutates: false }] }
    })
    renderPage()

    await waitFor(() => expect(screen.getByTestId('mcp-server-detail')).toBeInTheDocument())
    expect(fetchMcpServerDetailMock).toHaveBeenCalledWith('ws_1', 'srv_1', expect.any(AbortSignal))
    expect(screen.getByTestId('mcp-detail-endpoint')).toHaveTextContent('https://gw.example.test/mcp/acme-orders')
    expect(screen.getByTestId('mcp-detail-version')).toHaveTextContent('v3')
    expect(screen.getByTestId('mcp-detail-tools')).toHaveTextContent('list_orders')
  })

  it('renders the Connect tab by default and switches to the Playground tab', async () => {
    fetchMcpServerDetailMock.mockResolvedValue({
      id: 'srv_1',
      name: 'Acme Orders',
      endpointUrl: 'https://gw.example.test/mcp/acme-orders',
      activeVersion: { version: 'v1', tools: [{ name: 'list_orders', mutates: false }] }
    })
    renderPage()

    await waitFor(() => expect(screen.getByTestId('mcp-connect-panel')).toBeInTheDocument())
    expect(screen.getByText('Cursor — Añadir a Cursor')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Playground' }))
    expect(screen.getByTestId('mcp-playground')).toBeInTheDocument()
  })

  it('does not request a server detail without an active workspace and shows a clear state', () => {
    consoleContextMock.activeWorkspaceId = null
    renderPage()

    expect(fetchMcpServerDetailMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('mcp-detail-no-workspace')).toHaveTextContent('Selecciona un workspace')
  })
})
