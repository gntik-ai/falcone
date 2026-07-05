import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleMongoDataPage } from './ConsoleMongoDataPage'

const mockUseConsoleContext = vi.fn()
const mockReadConsoleShellSession = vi.fn()
const mockMongoDataEditor = vi.fn()

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))
vi.mock('@/lib/console-session', () => ({
  readConsoleShellSession: () => mockReadConsoleShellSession()
}))
vi.mock('@/components/console/MongoDataEditor', () => ({
  MongoDataEditor: (props: { workspaceId: string; databaseName: string; collectionName: string }) => {
    mockMongoDataEditor(props)
    return <div data-testid="mongo-data-editor">{props.workspaceId}</div>
  }
}))

function renderPage() {
  return render(<ConsoleMongoDataPage />, { wrapper: MemoryRouter })
}

describe('ConsoleMongoDataPage', () => {
  beforeEach(() => {
    mockUseConsoleContext.mockReset()
    mockReadConsoleShellSession.mockReset()
    mockReadConsoleShellSession.mockReturnValue({ principal: { userId: 'usr_1', platformRoles: ['tenant_owner'] } })
    mockMongoDataEditor.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  // #742: the no-workspace guard is the shared WorkspaceRequiredState, not a static message.
  it('[#742] offers a create-workspace CTA when the active organization has no workspaces', () => {
    mockUseConsoleContext.mockReturnValue({ activeWorkspaceId: null, workspaces: [] })
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent(/selecciona un área de trabajo/i)
    expect(screen.getByRole('link', { name: /crear área de trabajo/i })).toHaveAttribute('href', '/console/workspaces')
    expect(mockMongoDataEditor).not.toHaveBeenCalled()
  })

  it('[#742] offers an inline picker that activates the chosen workspace when workspaces already exist', async () => {
    const user = userEvent.setup()
    const selectWorkspace = vi.fn()
    mockUseConsoleContext.mockReturnValue({
      activeWorkspaceId: null,
      workspaces: [
        { workspaceId: 'wrk_1', tenantId: 'ten_1', label: 'Producción', secondary: 'prod' },
        { workspaceId: 'wrk_2', tenantId: 'ten_1', label: 'Staging', secondary: 'staging' }
      ],
      selectWorkspace
    })
    renderPage()

    await user.selectOptions(screen.getByRole('combobox', { name: /seleccionar área de trabajo/i }), 'wrk_2')
    expect(selectWorkspace).toHaveBeenCalledWith('wrk_2')
  })

  it('renders the editor only once a database and collection are entered', async () => {
    const user = userEvent.setup()
    mockUseConsoleContext.mockReturnValue({ activeWorkspaceId: 'wrk_1' })
    renderPage()

    expect(screen.queryByTestId('mongo-data-editor')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(/base de datos/i), 'catalog')
    await user.type(screen.getByLabelText(/colección/i), 'orders')

    expect(screen.getByTestId('mongo-data-editor')).toHaveTextContent('wrk_1')
    expect(mockMongoDataEditor).toHaveBeenCalledWith({ workspaceId: 'wrk_1', databaseName: 'catalog', collectionName: 'orders' })
  })
})
