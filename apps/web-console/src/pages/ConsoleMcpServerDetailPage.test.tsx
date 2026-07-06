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
    delete (consoleContextMock as Record<string, unknown>).workspaces
    delete (consoleContextMock as Record<string, unknown>).workspacesError
    delete (consoleContextMock as Record<string, unknown>).selectWorkspace
  })

  it('shows the endpoint, active version and curated tool list on success', async () => {
    fetchMcpServerDetailMock.mockResolvedValue({
      id: 'srv_1',
      name: 'Acme Orders',
      slug: 'acme-orders',
      status: 'running',
      endpointUrl: 'https://gw.example.test/mcp/acme-orders',
      activeVersion: { version: 'v3', source: 'instant', tools: [{ name: 'list_orders', description: 'list', mutates: false, scope: 'mcp:orders:read' }] }
    })
    renderPage()

    await waitFor(() => expect(screen.getByTestId('mcp-server-detail')).toBeInTheDocument())
    expect(fetchMcpServerDetailMock).toHaveBeenCalledWith('ws_1', 'srv_1', expect.any(AbortSignal))
    expect(screen.getByText('Punto de conexión')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-detail-endpoint')).toHaveTextContent('https://gw.example.test/mcp/acme-orders')
    expect(screen.getByTestId('mcp-detail-version')).toHaveTextContent('v3')
    expect(screen.getByTestId('mcp-detail-tools')).toHaveTextContent('list_orders')
    expect(screen.getByTestId('mcp-detail-tools')).toHaveTextContent('Alcance: mcp:orders:read')
    expect(screen.getByTestId('mcp-detail-tools')).not.toHaveTextContent('Scope:')
  })

  it('renders the localized connect tab by default and switches to the localized test-area tab', async () => {
    fetchMcpServerDetailMock.mockResolvedValue({
      id: 'srv_1',
      name: 'Acme Orders',
      endpointUrl: 'https://gw.example.test/mcp/acme-orders',
      activeVersion: { version: 'v1', tools: [{ name: 'list_orders', mutates: false }] }
    })
    renderPage()

    await waitFor(() => expect(screen.getByTestId('mcp-connect-panel')).toBeInTheDocument())
    expect(screen.getByText('Cursor — Añadir a Cursor')).toBeInTheDocument()
    expect(screen.getByRole('tabpanel', { name: 'Conectar' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Área de pruebas' }))
    expect(screen.getByTestId('mcp-playground')).toBeInTheDocument()
    expect(screen.getByRole('tabpanel', { name: 'Área de pruebas' })).toBeInTheDocument()
  })

  it('does not request a server detail without an active workspace and shows a clear state', () => {
    consoleContextMock.activeWorkspaceId = null
    renderPage()

    expect(fetchMcpServerDetailMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('mcp-detail-no-workspace')).toHaveTextContent('Selecciona un área de trabajo')
  })

  // #742: the no-workspace guard is the shared WorkspaceRequiredState — assert its inline picker
  // renders here too when the active organization already has workspaces.
  it('[#742] offers an inline workspace picker that activates the chosen workspace', async () => {
    const user = userEvent.setup()
    const selectWorkspace = vi.fn()
    Object.assign(consoleContextMock, {
      activeWorkspaceId: null,
      workspaces: [
        { workspaceId: 'ws_1', tenantId: 'ten_1', label: 'Producción', secondary: 'prod' },
        { workspaceId: 'ws_2', tenantId: 'ten_1', label: 'Staging', secondary: 'staging' }
      ],
      workspacesError: null,
      selectWorkspace
    })
    renderPage()

    await user.selectOptions(screen.getByRole('combobox', { name: /seleccionar área de trabajo/i }), 'ws_2')
    expect(selectWorkspace).toHaveBeenCalledWith('ws_2')
  })
})
