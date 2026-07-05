import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseConsoleContext, mockReadConsoleShellSession, mockEventsConsole } = vi.hoisted(() => ({
  mockUseConsoleContext: vi.fn(),
  mockReadConsoleShellSession: vi.fn(),
  mockEventsConsole: vi.fn()
}))

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))

vi.mock('@/lib/console-session', () => ({
  readConsoleShellSession: () => mockReadConsoleShellSession()
}))

vi.mock('@/components/console/EventsConsole', () => ({
  EventsConsole: (props: { workspaceId: string; canManageEvents?: boolean }) => {
    mockEventsConsole(props)
    return <div data-testid="events-console">{String(props.canManageEvents)}</div>
  }
}))

import { ConsoleEventsDataPage } from './ConsoleEventsDataPage'

describe('ConsoleEventsDataPage', () => {
  beforeEach(() => {
    mockUseConsoleContext.mockReturnValue({ activeWorkspaceId: 'ws1' })
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['tenant_owner'] } })
    mockEventsConsole.mockClear()
  })

  it('passes structural-write access for admin roles', () => {
    render(<ConsoleEventsDataPage />)
    expect(screen.getByText('Acceso de escritura admin')).toBeInTheDocument()
    expect(screen.getByText('Gestiona topics, publica mensajes y consume desde el flujo del área de trabajo.')).toBeInTheDocument()
    expect(screen.getByTestId('events-console')).toHaveTextContent('true')
    expect(mockEventsConsole).toHaveBeenCalledWith({ workspaceId: 'ws1', canManageEvents: true })
  })

  it('withholds Events create/publish access for tenant_developer', () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['tenant_developer'] } })
    render(<ConsoleEventsDataPage />)
    expect(screen.getByText('Solo lectura')).toBeInTheDocument()
    expect(screen.getByText('Consulta topics y consume mensajes desde el flujo del área de trabajo.')).toBeInTheDocument()
    expect(screen.getByTestId('events-console')).toHaveTextContent('false')
    expect(mockEventsConsole).toHaveBeenCalledWith({ workspaceId: 'ws1', canManageEvents: false })
  })

  it('withholds Events create/publish access for tenant_viewer', () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['tenant_viewer'] } })
    render(<ConsoleEventsDataPage />)
    expect(screen.getByText('Solo lectura')).toBeInTheDocument()
    expect(screen.getByTestId('events-console')).toHaveTextContent('false')
    expect(mockEventsConsole).toHaveBeenCalledWith({ workspaceId: 'ws1', canManageEvents: false })
  })

  it('withholds Events create/publish access for platform_operator (round-2 review #761: not in the backend WRITE_CAPABLE_ADMIN_ROLES set — the backend 403s a create-topic/publish from this role)', () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['platform_operator'] } })
    render(<ConsoleEventsDataPage />)
    expect(screen.getByText('Solo lectura')).toBeInTheDocument()
    expect(screen.getByTestId('events-console')).toHaveTextContent('false')
    expect(mockEventsConsole).toHaveBeenCalledWith({ workspaceId: 'ws1', canManageEvents: false })
  })

  it('withholds Events create/publish access for platform_team (round-2 review #761: not in the backend WRITE_CAPABLE_ADMIN_ROLES set — the backend 403s a create-topic/publish from this role)', () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['platform_team'] } })
    render(<ConsoleEventsDataPage />)
    expect(screen.getByText('Solo lectura')).toBeInTheDocument()
    expect(screen.getByTestId('events-console')).toHaveTextContent('false')
    expect(mockEventsConsole).toHaveBeenCalledWith({ workspaceId: 'ws1', canManageEvents: false })
  })

  it('shows a workspace selection state before rendering the Events console', () => {
    mockUseConsoleContext.mockReturnValue({ activeWorkspaceId: '', workspaces: [] })
    render(<ConsoleEventsDataPage />, { wrapper: MemoryRouter })
    expect(screen.getByRole('status')).toHaveTextContent('Selecciona un área de trabajo para usar eventos.')
    expect(mockEventsConsole).not.toHaveBeenCalled()
  })

  // #742: the no-workspace state is the shared WorkspaceRequiredState — assert its inline action.
  it('[#742] offers a create-workspace CTA when the active organization has no workspaces', () => {
    mockUseConsoleContext.mockReturnValue({ activeWorkspaceId: '', workspaces: [] })
    render(<ConsoleEventsDataPage />, { wrapper: MemoryRouter })
    expect(screen.getByRole('link', { name: /crear área de trabajo/i })).toHaveAttribute('href', '/console/workspaces')
  })

  it('[#742] offers an inline picker that activates the chosen workspace when workspaces already exist', async () => {
    const user = userEvent.setup()
    const selectWorkspace = vi.fn()
    mockUseConsoleContext.mockReturnValue({
      activeWorkspaceId: '',
      workspaces: [
        { workspaceId: 'ws_1', tenantId: 'ten_1', label: 'Producción', secondary: 'prod' },
        { workspaceId: 'ws_2', tenantId: 'ten_1', label: 'Staging', secondary: 'staging' }
      ],
      selectWorkspace
    })
    render(<ConsoleEventsDataPage />, { wrapper: MemoryRouter })

    await user.selectOptions(screen.getByRole('combobox', { name: /seleccionar área de trabajo/i }), 'ws_2')
    expect(selectWorkspace).toHaveBeenCalledWith('ws_2')
  })
})
