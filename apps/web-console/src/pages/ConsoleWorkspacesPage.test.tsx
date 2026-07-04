import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ConsoleWorkspacesPage } from './ConsoleWorkspacesPage'

const mockReadConsoleShellSession = vi.fn()

vi.mock('@/lib/console-context', () => ({ useConsoleContext: () => ({ activeTenant: { label: 'Tenant Alpha' }, activeTenantId: 'ten_1' }) }))
vi.mock('@/lib/console-session', () => ({ readConsoleShellSession: () => mockReadConsoleShellSession(), requestConsoleSessionJson: vi.fn() }))
vi.mock('@/lib/console-quotas', () => ({ useConsoleQuotas: () => ({ posture: null, workspacePosture: null, loading: false }) }))

describe('ConsoleWorkspacesPage', () => {
  it('abre el wizard desde el CTA principal', async () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['superadmin'] } })
    const user = userEvent.setup()
    render(<ConsoleWorkspacesPage />)
    expect(screen.getByText('Áreas de trabajo')).toBeInTheDocument()
    expect(screen.getByText(/sin salir de la consola administrativa/i)).toBeInTheDocument()
    expect(screen.queryByText(/sin salir del shell administrativo/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /nueva área de trabajo/i }))
    expect(screen.getByRole('heading', { name: /nueva área de trabajo/i })).toBeInTheDocument()
  })
})

describe('ConsoleWorkspacesPage permission-aware "Nueva área de trabajo" CTA (#761)', () => {
  it.each([
    { label: 'tenant_viewer', platformRoles: ['tenant_viewer'] },
    { label: 'tenant_developer', platformRoles: ['tenant_developer'] }
  ])('hides the create CTA for $label and shows a read-only indicator instead', ({ platformRoles }) => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles } })
    render(<ConsoleWorkspacesPage />)

    expect(screen.queryByRole('button', { name: /nueva área de trabajo/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('workspaces-read-only-indicator')).toBeInTheDocument()
  })

  it.each([
    { label: 'tenant_owner', platformRoles: ['tenant_owner'] },
    { label: 'tenant_admin', platformRoles: ['tenant_admin'] }
  ])('keeps the create CTA available for $label — no more "enabled but the wizard blocks late"', ({ platformRoles }) => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles } })
    render(<ConsoleWorkspacesPage />)

    expect(screen.getByRole('button', { name: /nueva área de trabajo/i })).toBeInTheDocument()
    expect(screen.queryByTestId('workspaces-read-only-indicator')).not.toBeInTheDocument()
  })

  it('exposes the role-aware recourse text in the read-only indicator, not just a mouse-only title', () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['tenant_viewer'] } })
    render(<ConsoleWorkspacesPage />)

    expect(screen.getByTestId('workspaces-read-only-indicator')).toHaveTextContent(/contacta con un administrador/i)
  })
})
