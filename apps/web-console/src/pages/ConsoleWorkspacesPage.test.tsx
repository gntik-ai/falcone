import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ConsoleWorkspacesPage } from './ConsoleWorkspacesPage'

vi.mock('@/lib/console-context', () => ({ useConsoleContext: () => ({ activeTenant: { label: 'Tenant Alpha' }, activeTenantId: 'ten_1' }) }))
vi.mock('@/lib/console-session', () => ({ readConsoleShellSession: () => ({ principal: { platformRoles: ['superadmin'] } }), requestConsoleSessionJson: vi.fn() }))
vi.mock('@/lib/console-quotas', () => ({ useConsoleQuotas: () => ({ posture: null, workspacePosture: null, loading: false }) }))

describe('ConsoleWorkspacesPage', () => {
  it('abre el wizard desde el CTA principal', async () => {
    const user = userEvent.setup()
    render(<ConsoleWorkspacesPage />)
    expect(screen.getByText('Áreas de trabajo')).toBeInTheDocument()
    expect(screen.getByText(/sin salir de la consola administrativa/i)).toBeInTheDocument()
    expect(screen.queryByText(/sin salir del shell administrativo/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /nueva área de trabajo/i }))
    expect(screen.getByRole('heading', { name: /nueva área de trabajo/i })).toBeInTheDocument()
  })
})
