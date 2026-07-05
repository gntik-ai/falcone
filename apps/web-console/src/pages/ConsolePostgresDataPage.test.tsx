import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsolePostgresDataPage } from './ConsolePostgresDataPage'

const mockUseConsoleContext = vi.fn()
const mockReadConsoleShellSession = vi.fn()
const mockPostgresDataEditor = vi.fn()

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))
vi.mock('@/lib/console-session', () => ({
  readConsoleShellSession: () => mockReadConsoleShellSession()
}))
vi.mock('@/components/console/PostgresDataEditor', () => ({
  PostgresDataEditor: (props: { workspaceId: string; databaseName: string; schemaName: string; tableName: string }) => {
    mockPostgresDataEditor(props)
    return <div data-testid="postgres-data-editor">{props.workspaceId}</div>
  }
}))

function renderPage() {
  return render(<ConsolePostgresDataPage />, { wrapper: MemoryRouter })
}

describe('ConsolePostgresDataPage', () => {
  beforeEach(() => {
    mockUseConsoleContext.mockReset()
    mockReadConsoleShellSession.mockReset()
    mockReadConsoleShellSession.mockReturnValue({ principal: { userId: 'usr_1', platformRoles: ['tenant_owner'] } })
    mockPostgresDataEditor.mockClear()
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
    expect(mockPostgresDataEditor).not.toHaveBeenCalled()
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

  it('renders the editor only once a database and table are entered', async () => {
    const user = userEvent.setup()
    mockUseConsoleContext.mockReturnValue({ activeWorkspaceId: 'wrk_1' })
    renderPage()

    expect(screen.queryByTestId('postgres-data-editor')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(/base de datos/i), 'app_db')
    await user.type(screen.getByLabelText(/tabla/i), 'accounts')

    expect(screen.getByTestId('postgres-data-editor')).toHaveTextContent('wrk_1')
    expect(mockPostgresDataEditor).toHaveBeenCalledWith({ workspaceId: 'wrk_1', databaseName: 'app_db', schemaName: 'public', tableName: 'accounts' })
  })
})
