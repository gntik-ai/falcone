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
    expect(screen.getByText('Admin write access')).toBeInTheDocument()
    expect(screen.getByText('Manage topics, publish messages, and consume from a workspace stream.')).toBeInTheDocument()
    expect(screen.getByTestId('events-console')).toHaveTextContent('true')
    expect(mockEventsConsole).toHaveBeenCalledWith({ workspaceId: 'ws1', canManageEvents: true })
  })

  it('withholds Events create/publish access for tenant_developer', () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['tenant_developer'] } })
    render(<ConsoleEventsDataPage />)
    expect(screen.getByText('Read-only')).toBeInTheDocument()
    expect(screen.getByText('Browse topics and consume messages from a workspace stream.')).toBeInTheDocument()
    expect(screen.getByTestId('events-console')).toHaveTextContent('false')
    expect(mockEventsConsole).toHaveBeenCalledWith({ workspaceId: 'ws1', canManageEvents: false })
  })

  it('withholds Events create/publish access for tenant_viewer', () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['tenant_viewer'] } })
    render(<ConsoleEventsDataPage />)
    expect(screen.getByText('Read-only')).toBeInTheDocument()
    expect(screen.getByTestId('events-console')).toHaveTextContent('false')
    expect(mockEventsConsole).toHaveBeenCalledWith({ workspaceId: 'ws1', canManageEvents: false })
  })

  it('shows a workspace selection state before rendering the Events console', () => {
    mockUseConsoleContext.mockReturnValue({ activeWorkspaceId: '' })
    render(<ConsoleEventsDataPage />)
    expect(screen.getByRole('status')).toHaveTextContent('Select a workspace to use events.')
    expect(mockEventsConsole).not.toHaveBeenCalled()
  })
})
