import { render, screen } from '@testing-library/react'
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

  it('shows a workspace selection state before rendering the Events console', () => {
    mockUseConsoleContext.mockReturnValue({ activeWorkspaceId: '' })
    render(<ConsoleEventsDataPage />)
    expect(screen.getByRole('status')).toHaveTextContent('Selecciona un área de trabajo para usar eventos.')
    expect(mockEventsConsole).not.toHaveBeenCalled()
  })
})
