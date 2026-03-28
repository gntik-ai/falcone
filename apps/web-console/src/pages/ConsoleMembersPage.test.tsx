import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConsoleContextProvider } from '@/lib/console-context'
import { clearConsoleShellSession, persistConsoleShellSession, type ConsoleShellSession } from '@/lib/console-session'

import { ConsoleMembersPage } from './ConsoleMembersPage'

const fetchMock = vi.fn<typeof fetch>()

const baseSession: ConsoleShellSession = {
  sessionId: 'ses_abc123',
  authenticationState: 'active',
  statusView: 'login',
  issuedAt: '2099-03-28T18:00:00.000Z',
  expiresAt: '2099-03-28T20:00:00.000Z',
  refreshExpiresAt: '2099-03-29T18:00:00.000Z',
  tokenSet: {
    accessToken: 'access-token-1234567890',
    refreshToken: 'refresh-token-1234567890',
    tokenType: 'Bearer',
    expiresIn: 3600,
    refreshExpiresIn: 7200,
    scope: 'openid profile email',
    expiresAt: '2099-03-28T20:00:00.000Z',
    refreshExpiresAt: '2099-03-29T18:00:00.000Z'
  },
  principal: {
    userId: 'usr_abc123',
    username: 'operaciones',
    displayName: 'Operaciones Plataforma',
    primaryEmail: 'ops@example.com',
    state: 'active',
    platformRoles: ['platform_operator']
  } as NonNullable<ConsoleShellSession['principal']>
}

describe('ConsoleMembersPage', () => {
  afterEach(() => {
    cleanup()
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    clearConsoleShellSession()
    window.localStorage.clear()
  })

  it('renderiza mensaje sin tenant activo', async () => {
    stubMembersApi({
      tenants: [createTenant('ten_alpha', 'Tenant Alpha'), createTenant('ten_beta', 'Tenant Beta')]
    })

    renderPage()

    expect(await screen.findByText(/selecciona un tenant para gestionar sus miembros y roles/i)).toBeInTheDocument()
  })

  it('renderiza mensaje sin realm IAM cuando consoleUserRealm es null', async () => {
    stubMembersApi({
      tenants: [createTenant('ten_alpha', 'Tenant Alpha', { identityContext: {} })],
      workspacesByTenant: {
        ten_alpha: []
      }
    })

    renderPage()

    expect(await screen.findByText(/no tiene un realm de consola iam configurado/i)).toBeInTheDocument()
  })

  it('renderiza la lista de usuarios y badges de realmRoles', async () => {
    stubMembersApi({
      tenants: [createTenant('ten_alpha', 'Tenant Alpha', { identityContext: { consoleUserRealm: 'realm-alpha' } })],
      users: [
        createIamUser('usr_1', 'alice', {
          email: 'alice@example.com',
          realmRoles: ['realm-admin', 'tenant-owner'],
          requiredActions: ['UPDATE_PASSWORD']
        })
      ],
      roles: [createIamRole('realm-admin')]
    })

    renderPage()

    expect(await screen.findByRole('table', { name: /listado de usuarios iam del realm activo/i })).toBeInTheDocument()
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByText('tenant-owner')).toBeInTheDocument()
    expect(screen.getByText('UPDATE_PASSWORD')).toBeInTheDocument()
  })

  it('renderiza la lista de roles y marca roles compuestos', async () => {
    stubMembersApi({
      tenants: [createTenant('ten_alpha', 'Tenant Alpha', { identityContext: { consoleUserRealm: 'realm-alpha' } })],
      users: [],
      roles: [
        createIamRole('realm-admin', {
          composite: true,
          compositeRoles: ['viewer', 'editor'],
          description: 'Admin role'
        })
      ]
    })

    renderPage()

    expect(await screen.findByRole('table', { name: /listado de roles iam del realm activo/i })).toBeInTheDocument()
    expect(screen.getByText('realm-admin')).toBeInTheDocument()
    expect(screen.getByText('Compuesto')).toBeInTheDocument()
    expect(screen.getByText('viewer')).toBeInTheDocument()
    expect(screen.getByText('editor')).toBeInTheDocument()
  })

  it('renderiza estado de carga mientras se resuelven los fetches', async () => {
    let releaseUsers: (() => void) | undefined
    let releaseRoles: (() => void) | undefined

    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const parsedUrl = new URL(url, 'http://localhost')

      if (parsedUrl.pathname === '/v1/tenants') {
        return createJsonResponse(200, {
          items: [createTenant('ten_alpha', 'Tenant Alpha', { identityContext: { consoleUserRealm: 'realm-alpha' } })],
          page: {}
        })
      }

      if (parsedUrl.pathname === '/v1/workspaces') {
        return createJsonResponse(200, { items: [], page: {} })
      }

      if (parsedUrl.pathname === '/v1/iam/realms/realm-alpha/users') {
        await new Promise<void>((resolve) => {
          releaseUsers = resolve
        })
        return createJsonResponse(200, { items: [], page: { size: 100 }, compatibility: createCompatibility() })
      }

      if (parsedUrl.pathname === '/v1/iam/realms/realm-alpha/roles') {
        await new Promise<void>((resolve) => {
          releaseRoles = resolve
        })
        return createJsonResponse(200, { items: [], page: { size: 100 }, compatibility: createCompatibility() })
      }

      return createJsonResponse(404, { message: 'Not found' })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByText(/cargando usuarios iam/i)).toBeInTheDocument()
    expect(screen.getByText(/cargando roles iam/i)).toBeInTheDocument()

    if (typeof releaseUsers === 'function') {
      releaseUsers()
    }

    if (typeof releaseRoles === 'function') {
      releaseRoles()
    }

    await waitFor(() => {
      expect(screen.getByText(/no hay usuarios iam registrados/i)).toBeInTheDocument()
      expect(screen.getByText(/no hay roles iam registrados/i)).toBeInTheDocument()
    })
  })

  it('renderiza error y permite reintentar la carga', async () => {
    let usersShouldFail = true
    let rolesShouldFail = true
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const parsedUrl = new URL(url, 'http://localhost')

      if (parsedUrl.pathname === '/v1/tenants') {
        return createJsonResponse(200, {
          items: [createTenant('ten_alpha', 'Tenant Alpha', { identityContext: { consoleUserRealm: 'realm-alpha' } })],
          page: {}
        })
      }

      if (parsedUrl.pathname === '/v1/workspaces') {
        return createJsonResponse(200, { items: [], page: {} })
      }

      if (parsedUrl.pathname === '/v1/iam/realms/realm-alpha/users') {
        if (usersShouldFail) {
          usersShouldFail = false
          return createJsonResponse(500, { message: 'Usuarios degradados' })
        }

        return createJsonResponse(200, {
          items: [createIamUser('usr_1', 'alice')],
          page: { size: 100 },
          compatibility: createCompatibility()
        })
      }

      if (parsedUrl.pathname === '/v1/iam/realms/realm-alpha/roles') {
        if (rolesShouldFail) {
          rolesShouldFail = false
          return createJsonResponse(500, { message: 'Roles degradados' })
        }

        return createJsonResponse(200, {
          items: [createIamRole('realm-admin')],
          page: { size: 100 },
          compatibility: createCompatibility()
        })
      }

      return createJsonResponse(404, { message: 'Not found' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    renderPage()

    const alerts = await screen.findAllByRole('alert')
    expect(alerts).toHaveLength(2)
    expect(alerts[0]?.textContent ?? '').toMatch(/usuarios degradados|roles degradados/i)

    await user.click(screen.getAllByRole('button', { name: /reintentar usuarios/i })[0]!)
    await user.click(screen.getAllByRole('button', { name: /reintentar roles/i })[0]!)

    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument()
      expect(screen.getByText('realm-admin')).toBeInTheDocument()
    })
  })
})

function renderPage(session: ConsoleShellSession | null = baseSession) {
  vi.stubGlobal('fetch', fetchMock)

  if (session) {
    persistConsoleShellSession(session as never)
  } else {
    clearConsoleShellSession()
  }

  return render(
    <ConsoleContextProvider session={session}>
      <ConsoleMembersPage />
    </ConsoleContextProvider>
  )
}

function stubMembersApi({
  tenants = [createTenant('ten_alpha', 'Tenant Alpha', { identityContext: { consoleUserRealm: 'realm-alpha' } })],
  workspacesByTenant = { ten_alpha: [] as Array<ReturnType<typeof createWorkspace>> },
  users = [],
  roles = []
}: {
  tenants?: Array<ReturnType<typeof createTenant>>
  workspacesByTenant?: Record<string, Array<ReturnType<typeof createWorkspace>>>
  users?: Array<ReturnType<typeof createIamUser>>
  roles?: Array<ReturnType<typeof createIamRole>>
} = {}) {
  fetchMock.mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const parsedUrl = new URL(url, 'http://localhost')

    if (parsedUrl.pathname === '/v1/tenants') {
      return createJsonResponse(200, { items: tenants, page: {} })
    }

    if (parsedUrl.pathname === '/v1/workspaces') {
      const tenantId = parsedUrl.searchParams.get('filter[tenantId]') ?? ''
      return createJsonResponse(200, { items: workspacesByTenant[tenantId] ?? [], page: {} })
    }

    if (parsedUrl.pathname === '/v1/iam/realms/realm-alpha/users') {
      return createJsonResponse(200, { items: users, page: { size: 100 }, compatibility: createCompatibility() })
    }

    if (parsedUrl.pathname === '/v1/iam/realms/realm-alpha/roles') {
      return createJsonResponse(200, { items: roles, page: { size: 100 }, compatibility: createCompatibility() })
    }

    return createJsonResponse(404, { message: 'Not found' })
  })
  vi.stubGlobal('fetch', fetchMock)
}

function createTenant(tenantId: string, displayName: string, overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    displayName,
    slug: displayName.toLowerCase().replace(/\s+/g, '-'),
    state: 'active',
    governance: {
      governanceStatus: 'nominal'
    },
    quotaProfile: {
      governanceStatus: 'nominal',
      limits: []
    },
    inventorySummary: {
      tenantId,
      workspaceCount: 0,
      applicationCount: 0,
      managedResourceCount: 0,
      serviceAccountCount: 0,
      workspaces: []
    },
    ...overrides
  }
}

function createWorkspace(workspaceId: string, tenantId: string, displayName: string) {
  return {
    workspaceId,
    tenantId,
    displayName,
    slug: displayName.toLowerCase().replace(/\s+/g, '-'),
    environment: 'sandbox',
    state: 'active',
    provisioning: {
      status: 'completed'
    }
  }
}

function createCompatibility() {
  return {
    provider: 'keycloak',
    contractVersion: '1.0.0',
    supportedVersions: ['25.0'],
    adminApiStability: 'stable_v1'
  }
}

function createIamUser(userId: string, username: string, overrides: Record<string, unknown> = {}) {
  return {
    userId,
    realmId: 'realm-alpha',
    username,
    enabled: true,
    state: 'active',
    realmRoles: [],
    requiredActions: [],
    attributes: {},
    providerCompatibility: createCompatibility(),
    ...overrides
  }
}

function createIamRole(roleName: string, overrides: Record<string, unknown> = {}) {
  return {
    realmId: 'realm-alpha',
    roleName,
    composite: false,
    compositeRoles: [],
    attributes: {},
    providerCompatibility: createCompatibility(),
    ...overrides
  }
}

function createJsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body
  } as Response
}
