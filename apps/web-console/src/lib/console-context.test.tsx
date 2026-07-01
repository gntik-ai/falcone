import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ConsoleContextProvider,
  clearPersistedConsoleContext,
  persistConsoleContextSelection,
  readPersistedConsoleContext,
  useConsoleContext
} from './console-context'

import {
  clearConsoleShellSession,
  persistConsoleShellSession,
  type ConsoleShellSession
} from '@/lib/console-session'

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

describe('console-context', () => {
  afterEach(() => {
    cleanup()
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    clearPersistedConsoleContext()
    clearConsoleShellSession()
    window.localStorage?.clear()
  })

  it('ignora snapshots inválidos del storage', () => {
    window.localStorage.setItem('in-falcone.console-active-context', '{not-json')

    expect(readPersistedConsoleContext(baseSession.principal?.userId ?? null)).toBeNull()
    expect(window.localStorage.getItem('in-falcone.console-active-context')).toBeNull()
  })

  it('ignora snapshots de otro usuario', () => {
    persistConsoleContextSelection('usr_otro', 'ten_beta', 'wrk_beta')

    expect(readPersistedConsoleContext(baseSession.principal?.userId ?? null)).toBeNull()
  })

  it('restaura tenant y workspace persistidos cuando siguen accesibles', async () => {
    stubContextApi({
      tenants: [
        createTenant('ten_alpha', 'Tenant Alpha'),
        createTenant('ten_beta', 'Tenant Beta')
      ],
      workspacesByTenant: {
        ten_beta: [createWorkspace('wrk_beta', 'ten_beta', 'Workspace Beta')]
      }
    })
    persistConsoleContextSelection('usr_abc123', 'ten_beta', 'wrk_beta')

    renderContextProbe()

    await waitFor(() => {
      expect(screen.getByTestId('active-tenant')).toHaveTextContent('ten_beta')
      expect(screen.getByTestId('active-workspace')).toHaveTextContent('wrk_beta')
    })
  })

  it('limpia el contexto persistido cuando el tenant ya no es accesible', async () => {
    stubContextApi({
      tenants: [
        createTenant('ten_alpha', 'Tenant Alpha'),
        createTenant('ten_gamma', 'Tenant Gamma')
      ]
    })
    persistConsoleContextSelection('usr_abc123', 'ten_beta', 'wrk_beta')

    renderContextProbe()

    await waitFor(() => {
      expect(screen.getByTestId('active-tenant')).toHaveTextContent('none')
      expect(readPersistedConsoleContext('usr_abc123')).toBeNull()
    })
  })

  it('autoselecciona tenant y workspace cuando solo existe una opción', async () => {
    stubContextApi({
      tenants: [createTenant('ten_alpha', 'Tenant Alpha')],
      workspacesByTenant: {
        ten_alpha: [createWorkspace('wrk_alpha', 'ten_alpha', 'Workspace Alpha')]
      }
    })

    renderContextProbe()

    await waitFor(() => {
      expect(screen.getByTestId('active-tenant')).toHaveTextContent('ten_alpha')
      expect(screen.getByTestId('active-workspace')).toHaveTextContent('wrk_alpha')
    })
  })

  it('no autoselecciona tenant cuando hay múltiples opciones sin contexto previo', async () => {
    stubContextApi({
      tenants: [
        createTenant('ten_alpha', 'Tenant Alpha'),
        createTenant('ten_beta', 'Tenant Beta')
      ]
    })

    renderContextProbe()

    await waitFor(() => {
      expect(screen.getByTestId('active-tenant')).toHaveTextContent('none')
      expect(screen.getByTestId('tenants-count')).toHaveTextContent('2')
    })
  })

  it('superadmin: resolves capabilities through the active tenant route, never the self-tenant route', async () => {
    const superadminSession: ConsoleShellSession = {
      ...baseSession,
      principal: {
        ...baseSession.principal!,
        platformRoles: ['superadmin'],
        tenantIds: [],
        workspaceIds: []
      }
    }
    stubContextApi({
      tenants: [createTenant('ten_alpha', 'Tenant Alpha')]
    })

    renderContextProbe(superadminSession)

    await waitFor(() => {
      expect(screen.getByTestId('active-tenant')).toHaveTextContent('ten_alpha')
      expect(fetchPathnames()).toContain('/v1/tenants/ten_alpha/effective-capabilities')
    })

    expect(fetchPathnames()).not.toContain('/v1/tenant/effective-capabilities')
  })

  it('al cambiar de tenant limpia el workspace previo', async () => {
    stubContextApi({
      tenants: [
        createTenant('ten_alpha', 'Tenant Alpha'),
        createTenant('ten_beta', 'Tenant Beta')
      ],
      workspacesByTenant: {
        ten_alpha: [createWorkspace('wrk_alpha', 'ten_alpha', 'Workspace Alpha')],
        ten_beta: [
          createWorkspace('wrk_beta_1', 'ten_beta', 'Workspace Beta 1'),
          createWorkspace('wrk_beta_2', 'ten_beta', 'Workspace Beta 2')
        ]
      }
    })
    persistConsoleContextSelection('usr_abc123', 'ten_alpha', 'wrk_alpha')
    const user = userEvent.setup()

    renderContextProbe()

    await waitFor(() => {
      expect(screen.getByTestId('active-tenant')).toHaveTextContent('ten_alpha')
      expect(screen.getByTestId('active-workspace')).toHaveTextContent('wrk_alpha')
    })

    await user.click(screen.getByRole('button', { name: /seleccionar tenant beta/i }))

    await waitFor(() => {
      expect(screen.getByTestId('active-tenant')).toHaveTextContent('ten_beta')
      expect(screen.getByTestId('active-workspace')).toHaveTextContent('none')
    })

    expect(readPersistedConsoleContext('usr_abc123')).toMatchObject({
      tenantId: 'ten_beta',
      workspaceId: null
    })
  })

  it('enriquece el tenant activo con gobernanza, cuotas e inventario y expone alertas operativas', async () => {
    stubContextApi({
      tenants: [
        createTenant('ten_alpha', 'Tenant Alpha', {
          governance: { governanceStatus: 'warning' },
          identityContext: { consoleUserRealm: 'realm-alpha' },
          quotaProfile: {
            governanceStatus: 'warning',
            limits: [
              {
                metricKey: 'storage_gb',
                scope: 'tenant',
                used: 80,
                limit: 100,
                remaining: 20,
                unit: 'GB'
              },
              {
                metricKey: 'invocations_per_minute',
                scope: 'workspace',
                used: 1000,
                limit: 1000,
                remaining: 0,
                unit: 'rpm'
              }
            ]
          },
          inventorySummary: {
            tenantId: 'ten_alpha',
            workspaceCount: 2,
            applicationCount: 6,
            managedResourceCount: 12,
            serviceAccountCount: 3,
            workspaces: [
              {
                workspaceId: 'wrk_alpha',
                workspaceSlug: 'workspace-alpha',
                environment: 'sandbox',
                state: 'active',
                applicationCount: 4,
                serviceAccountCount: 2,
                managedResourceCount: 8
              }
            ]
          }
        })
      ],
      workspacesByTenant: {
        ten_alpha: [
          createWorkspace('wrk_alpha', 'ten_alpha', 'Workspace Alpha', {
            provisioning: { status: 'partially_failed' }
          })
        ]
      }
    })

    renderContextProbe()

    await waitFor(() => {
      expect(screen.getByTestId('tenant-governance')).toHaveTextContent('warning')
      expect(screen.getByTestId('tenant-console-user-realm')).toHaveTextContent('realm-alpha')
      expect(screen.getByTestId('tenant-quota-warning')).toHaveTextContent('1')
      expect(screen.getByTestId('tenant-quota-blocked')).toHaveTextContent('1')
      expect(screen.getByTestId('tenant-inventory-applications')).toHaveTextContent('6')
      expect(screen.getByTestId('workspace-provisioning')).toHaveTextContent('partially_failed')
      expect(screen.getByTestId('operational-alerts-count')).toHaveTextContent('3')
    })
  })

  it('expone consoleUserRealm cuando el tenant tiene identityContext', async () => {
    stubContextApi({
      tenants: [createTenant('ten_alpha', 'Tenant Alpha', { identityContext: { consoleUserRealm: 'realm-alpha' } })],
      workspacesByTenant: {
        ten_alpha: [createWorkspace('wrk_alpha', 'ten_alpha', 'Workspace Alpha')]
      }
    })

    renderContextProbe()

    await waitFor(() => {
      expect(screen.getByTestId('tenant-console-user-realm')).toHaveTextContent('realm-alpha')
    })
  })

  it('expone consoleUserRealm como none cuando falta identityContext o el campo consoleUserRealm', async () => {
    stubContextApi({
      tenants: [createTenant('ten_alpha', 'Tenant Alpha', { identityContext: {} })],
      workspacesByTenant: {
        ten_alpha: [createWorkspace('wrk_alpha', 'ten_alpha', 'Workspace Alpha')]
      }
    })

    renderContextProbe()

    await waitFor(() => {
      expect(screen.getByTestId('tenant-console-user-realm')).toHaveTextContent('none')
    })
  })

  it('actualiza consoleUserRealm al cambiar el tenant activo', async () => {
    stubContextApi({
      tenants: [
        createTenant('ten_alpha', 'Tenant Alpha', { identityContext: { consoleUserRealm: 'realm-alpha' } }),
        createTenant('ten_beta', 'Tenant Beta', { identityContext: { consoleUserRealm: 'realm-beta' } })
      ],
      workspacesByTenant: {
        ten_alpha: [createWorkspace('wrk_alpha', 'ten_alpha', 'Workspace Alpha')],
        ten_beta: [createWorkspace('wrk_beta', 'ten_beta', 'Workspace Beta')]
      }
    })
    persistConsoleContextSelection('usr_abc123', 'ten_alpha', 'wrk_alpha')
    const user = userEvent.setup()

    renderContextProbe()

    await waitFor(() => {
      expect(screen.getByTestId('tenant-console-user-realm')).toHaveTextContent('realm-alpha')
    })

    await user.click(screen.getByRole('button', { name: /seleccionar tenant beta/i }))

    await waitFor(() => {
      expect(screen.getByTestId('active-tenant')).toHaveTextContent('ten_beta')
      expect(screen.getByTestId('tenant-console-user-realm')).toHaveTextContent('realm-beta')
    })
  })

  describe('tenant operator (tenant_owner) — own-scope bootstrap', () => {
    // NOTE: do NOT stub `localStorage` via vi.stubGlobal here. jsdom already provides a real
    // localStorage (cleared between tests by the outer afterEach), and the production storage
    // helpers guard `!window.localStorage`. vi.stubGlobal('localStorage', …) +
    // vi.unstubAllGlobals() is a brittle workaround for Node 22+'s experimental global
    // localStorage (a LOCAL artifact; CI runs Node 20) and risks corrupting the shared
    // localStorage for later files.
    const operatorSession: ConsoleShellSession = {
      sessionId: 'ses_operator_001',
      authenticationState: 'active',
      statusView: 'login',
      issuedAt: '2099-03-28T18:00:00.000Z',
      expiresAt: '2099-03-28T20:00:00.000Z',
      refreshExpiresAt: '2099-03-29T18:00:00.000Z',
      tokenSet: {
        accessToken: 'access-token-operator-001',
        refreshToken: 'refresh-token-operator-001',
        tokenType: 'Bearer',
        expiresIn: 3600,
        refreshExpiresIn: 7200,
        scope: 'openid profile email',
        expiresAt: '2099-03-28T20:00:00.000Z',
        refreshExpiresAt: '2099-03-29T18:00:00.000Z'
      },
      principal: {
        userId: 'usr_operator_001',
        username: 'acme-ops',
        displayName: 'Acme Operator',
        primaryEmail: 'ops@acme.example',
        state: 'active',
        platformRoles: ['tenant_owner'],
        tenantIds: ['ten_acme']
      } as NonNullable<ConsoleShellSession['principal']>
    }

    it('operator: bootstraps tenant context from own-scope GET /v1/tenants/{id} instead of superadmin collection', async () => {
      stubContextApiWithOperatorScope({
        tenantsByid: {
          ten_acme: createTenant('ten_acme', 'Acme Corp', { identityContext: { consoleUserRealm: 'ten_acme' } })
        },
        workspacesByTenant: {
          ten_acme: [createWorkspace('wrk_acme_dev', 'ten_acme', 'Dev Workspace')]
        }
      })

      renderContextProbe(operatorSession)

      await waitFor(() => {
        expect(screen.getByTestId('active-tenant')).toHaveTextContent('ten_acme')
        expect(screen.getByTestId('tenants-count')).toHaveTextContent('1')
      })
    })

    it('operator: does NOT call superadmin GET /v1/tenants collection', async () => {
      stubContextApiWithOperatorScope({
        tenantsByid: {
          ten_acme: createTenant('ten_acme', 'Acme Corp')
        },
        workspacesByTenant: {}
      })

      renderContextProbe(operatorSession)

      await waitFor(() => {
        expect(screen.getByTestId('active-tenant')).toHaveTextContent('ten_acme')
      })

      const collectionCalls = fetchMock.mock.calls.filter((call) => {
        const requestUrl = typeof call[0] === 'string' ? call[0] : call[0] instanceof URL ? call[0].toString() : (call[0] as Request).url
        const parsed = new URL(requestUrl, 'http://localhost')
        return parsed.pathname === '/v1/tenants' && !parsed.pathname.match(/\/v1\/tenants\/[^/]+$/)
      })

      expect(collectionCalls).toHaveLength(0)
    })

    it('operator: autoselects own tenant and loads workspaces', async () => {
      stubContextApiWithOperatorScope({
        tenantsByid: {
          ten_acme: createTenant('ten_acme', 'Acme Corp')
        },
        workspacesByTenant: {
          ten_acme: [createWorkspace('wrk_acme_dev', 'ten_acme', 'Dev Workspace')]
        }
      })

      renderContextProbe(operatorSession)

      await waitFor(() => {
        expect(screen.getByTestId('active-tenant')).toHaveTextContent('ten_acme')
        expect(screen.getByTestId('active-workspace')).toHaveTextContent('wrk_acme_dev')
      })
    })
  })
})

function ContextProbe() {
  const context = useConsoleContext()

  return (
    <div>
      <div data-testid="active-tenant">{context.activeTenantId ?? 'none'}</div>
      <div data-testid="active-workspace">{context.activeWorkspaceId ?? 'none'}</div>
      <div data-testid="tenants-count">{context.tenants.length}</div>
      <div data-testid="tenant-governance">{context.activeTenant?.governanceStatus ?? 'none'}</div>
      <div data-testid="tenant-console-user-realm">{context.activeTenant?.consoleUserRealm ?? 'none'}</div>
      <div data-testid="tenant-quota-warning">{context.activeTenant?.quotaSummary?.totals.warning ?? '0'}</div>
      <div data-testid="tenant-quota-blocked">{context.activeTenant?.quotaSummary?.totals.blocked ?? '0'}</div>
      <div data-testid="tenant-inventory-applications">{context.activeTenant?.inventorySummary?.applicationCount ?? '0'}</div>
      <div data-testid="workspace-provisioning">{context.activeWorkspace?.provisioningStatus ?? 'none'}</div>
      <div data-testid="operational-alerts-count">{context.operationalAlerts.length}</div>
      <button type="button" onClick={() => context.selectTenant('ten_beta')}>
        Seleccionar tenant beta
      </button>
    </div>
  )
}

function renderContextProbe(session: ConsoleShellSession | null = baseSession) {
  vi.stubGlobal('fetch', fetchMock)

  if (session) {
    persistConsoleShellSession(session as never)
  } else {
    clearConsoleShellSession()
  }

  return render(
    <ConsoleContextProvider session={session}>
      <ContextProbe />
    </ConsoleContextProvider>
  )
}

function stubContextApi({
  tenants = [],
  workspacesByTenant = {}
}: {
  tenants?: Array<ReturnType<typeof createTenant>>
  workspacesByTenant?: Record<string, Array<ReturnType<typeof createWorkspace>>>
}) {
  fetchMock.mockImplementation(async (input) => {
    const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const parsedUrl = new URL(requestUrl, 'http://localhost')

    if (parsedUrl.pathname === '/v1/tenants') {
      return createJsonResponse(200, { items: tenants, page: {} })
    }

    if (parsedUrl.pathname === '/v1/workspaces') {
      const tenantId = parsedUrl.searchParams.get('filter[tenantId]') ?? ''
      return createJsonResponse(200, { items: workspacesByTenant[tenantId] ?? [], page: {} })
    }

    return createJsonResponse(404, { message: 'Not found' })
  })
}

function stubContextApiWithOperatorScope({
  tenantsByid = {},
  workspacesByTenant = {}
}: {
  tenantsByid?: Record<string, ReturnType<typeof createTenant>>
  workspacesByTenant?: Record<string, Array<ReturnType<typeof createWorkspace>>>
}) {
  fetchMock.mockImplementation(async (input) => {
    const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const parsedUrl = new URL(requestUrl, 'http://localhost')

    // Singular tenant fetch: GET /v1/tenants/{tenantId}
    const singularTenantMatch = parsedUrl.pathname.match(/^\/v1\/tenants\/([^/]+)$/)
    if (singularTenantMatch) {
      const tenantId = singularTenantMatch[1]
      const tenant = tenantsByid[tenantId]
      if (tenant) {
        return createJsonResponse(200, { tenant, ...tenant })
      }
      return createJsonResponse(404, { code: 'TENANT_NOT_FOUND', message: `tenant ${tenantId} not found` })
    }

    // Superadmin collection — operators should NOT call this; return 403 to make failures visible
    if (parsedUrl.pathname === '/v1/tenants') {
      return createJsonResponse(403, { code: 'FORBIDDEN', message: 'requires superadmin' })
    }

    if (parsedUrl.pathname === '/v1/workspaces') {
      const tenantId = parsedUrl.searchParams.get('filter[tenantId]') ?? ''
      return createJsonResponse(200, { items: workspacesByTenant[tenantId] ?? [], page: {} })
    }

    return createJsonResponse(404, { message: 'Not found' })
  })
}

function createTenant(
  tenantId: string,
  displayName: string,
  overrides: Record<string, unknown> = {}
) {
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
      workspaceCount: 1,
      applicationCount: 1,
      managedResourceCount: 1,
      serviceAccountCount: 1,
      workspaces: []
    },
    ...overrides
  }
}

function createWorkspace(
  workspaceId: string,
  tenantId: string,
  displayName: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    workspaceId,
    tenantId,
    displayName,
    slug: displayName.toLowerCase().replace(/\s+/g, '-'),
    environment: 'sandbox',
    state: 'active',
    provisioning: {
      status: 'completed'
    },
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

function fetchPathnames() {
  return fetchMock.mock.calls.map((call) => {
    const requestUrl = typeof call[0] === 'string' ? call[0] : call[0] instanceof URL ? call[0].toString() : (call[0] as Request).url
    return new URL(requestUrl, 'http://localhost').pathname
  })
}
