import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearConsoleShellSession, persistConsoleShellSession } from '@/lib/console-session'

const useConsoleContextMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/console-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/console-context')>('@/lib/console-context')

  return {
    ...actual,
    useConsoleContext: useConsoleContextMock
  }
})

import { ConsoleProfilePage } from './ConsoleProfilePage'

const NO_SCAFFOLDING_PATTERNS = [/EP-\d+/, /US-UI/i, /consola base/i, /pantalla temporal/i, /entrada base/i, /iteración posterior/i]

const session = {
  sessionId: 'ses_profile1',
  authenticationState: 'active' as const,
  statusView: 'login' as const,
  issuedAt: '2099-03-28T18:00:00.000Z',
  lastActivityAt: '2099-03-28T18:00:00.000Z',
  expiresAt: '2099-03-28T20:00:00.000Z',
  idleExpiresAt: '2099-03-28T19:00:00.000Z',
  refreshExpiresAt: '2099-03-29T18:00:00.000Z',
  sessionPolicy: {
    maxLifetime: '8h',
    idleTimeout: '1h',
    refreshTokenMaxAge: '24h'
  },
  principal: {
    userId: 'usr_profile1',
    username: 'operaciones',
    displayName: 'Operaciones Plataforma',
    primaryEmail: 'ops@example.com',
    state: 'active' as const,
    platformRoles: ['tenant_owner']
  }
}

describe('ConsoleProfilePage', () => {
  afterEach(() => {
    cleanup()
    useConsoleContextMock.mockReset()
    clearConsoleShellSession()
    window.localStorage.clear()
  })

  it('[#744][Scenario: Tenant owner views any authenticated page] muestra los datos reales de identidad y rol, sin copy de scaffolding', () => {
    persistConsoleShellSession(session)
    useConsoleContextMock.mockReturnValue(
      createContextValue({ activeTenant: { label: 'Tenant Alpha' }, activeWorkspace: { label: 'Workspace Prod' } })
    )

    render(<ConsoleProfilePage />)

    expect(screen.getByRole('heading', { name: /perfil de usuario/i })).toBeInTheDocument()
    expect(screen.getByText('Operaciones Plataforma')).toBeInTheDocument()
    expect(screen.getByText('tenant_owner')).toBeInTheDocument()

    const pageText = document.body.textContent ?? ''
    expect(pageText).toContain('ops@example.com')
    expect(pageText).toContain('Tenant Alpha')
    expect(pageText).toContain('Workspace Prod')
    for (const pattern of NO_SCAFFOLDING_PATTERNS) {
      expect(pageText).not.toMatch(pattern)
    }
  })

  it('degrada con elegancia cuando no hay organización ni área de trabajo activa', () => {
    persistConsoleShellSession(session)
    useConsoleContextMock.mockReturnValue(createContextValue({ activeTenant: null, activeWorkspace: null }))

    render(<ConsoleProfilePage />)

    expect(screen.getAllByText('Ninguna seleccionada')).toHaveLength(2)
  })
})

function createContextValue(overrides: Record<string, unknown> = {}) {
  return {
    tenants: [],
    workspaces: [],
    activeTenantId: null,
    activeWorkspaceId: null,
    activeTenant: null,
    activeWorkspace: null,
    operationalAlerts: [],
    tenantsLoading: false,
    workspacesLoading: false,
    tenantsError: null,
    workspacesError: null,
    selectTenant: vi.fn(),
    selectWorkspace: vi.fn(),
    reloadTenants: vi.fn(),
    reloadWorkspaces: vi.fn(),
    ...overrides
  }
}
