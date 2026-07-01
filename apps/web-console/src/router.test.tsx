import { cleanup, render, screen } from '@testing-library/react'
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appRoutes } from './router'

const { consoleAuthPageRenderMock, consoleIamAccessPageRenderMock, readConsoleShellSessionMock } = vi.hoisted(() => ({
  consoleAuthPageRenderMock: vi.fn(),
  consoleIamAccessPageRenderMock: vi.fn(),
  readConsoleShellSessionMock: vi.fn()
}))

vi.mock('@/components/auth/ProtectedRoute', () => ({ ProtectedRoute: () => <Outlet /> }))
vi.mock('@/layouts/ConsoleShellLayout', () => ({ ConsoleShellLayout: () => <Outlet /> }))
vi.mock('@/pages/ConsoleAuthPage', () => ({
  ConsoleAuthPage: () => {
    consoleAuthPageRenderMock()
    return <h1>Auth IAM</h1>
  }
}))
vi.mock('@/pages/ConsoleIamAccessPage', () => ({
  ConsoleIamAccessPage: () => {
    consoleIamAccessPageRenderMock()
    return <h1>IAM Access</h1>
  }
}))
vi.mock('@/pages/ConsoleObservabilityPage', () => ({ ConsoleObservabilityPage: () => <h1>Observability Real</h1> }))
vi.mock('@/pages/ConsoleServiceAccountsPage', () => ({ ConsoleServiceAccountsPage: () => <h1>Service Accounts Real</h1> }))
vi.mock('@/pages/ConsoleQuotasPage', () => ({ ConsoleQuotasPage: () => <h1>Quotas Real</h1> }))
vi.mock('@/pages/ConsoleTenantsPage', () => ({ ConsoleTenantsPage: () => <h1>Gestión de tenants</h1> }))
vi.mock('@/pages/ConsoleWorkspacesPage', () => ({ ConsoleWorkspacesPage: () => <h1>Gestión de workspaces</h1> }))
vi.mock('@/pages/ConsoleRealtimePage', () => ({ ConsoleRealtimePage: () => <h1>Realtime workspace</h1> }))
vi.mock('@/pages/ConsolePlanCatalogPage', () => ({ ConsolePlanCatalogPage: () => <h1>Plan catalog</h1> }))
vi.mock('@/pages/ConsolePlanCreatePage', () => ({ ConsolePlanCreatePage: () => <h1>Create plan</h1> }))
vi.mock('@/pages/ConsolePlanDetailPage', () => ({ ConsolePlanDetailPage: () => <h1>Plan detail</h1> }))
vi.mock('@/pages/ConsoleTenantPlanPage', () => ({ ConsoleTenantPlanPage: () => <h1>Tenant plan admin</h1> }))
vi.mock('@/pages/ConsoleTenantPlanOverviewPage', () => ({ ConsoleTenantPlanOverviewPage: () => <h1>My plan</h1> }))
vi.mock('@/lib/console-session', () => ({ readConsoleShellSession: readConsoleShellSessionMock }))

beforeEach(() => {
  readConsoleShellSessionMock.mockReturnValue(createRouterSession(['superadmin']))
  consoleAuthPageRenderMock.mockClear()
  consoleIamAccessPageRenderMock.mockClear()
})

afterEach(() => {
  cleanup()
  readConsoleShellSessionMock.mockReset()
})

describe('router', () => {
  it('renderiza la página de bienvenida en la ruta raíz', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] })
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('heading', { level: 1, name: /in falcone console/i })).toBeInTheDocument()
  })

  it('renderiza tenants y workspaces con páginas reales', async () => {
    const tenantsRouter = createMemoryRouter(appRoutes, { initialEntries: ['/console/tenants'] })
    render(<RouterProvider router={tenantsRouter} />)
    expect(await screen.findByRole('heading', { name: /gestión de tenants/i })).toBeInTheDocument()

    cleanup()
    const workspacesRouter = createMemoryRouter(appRoutes, { initialEntries: ['/console/workspaces'] })
    render(<RouterProvider router={workspacesRouter} />)
    expect(await screen.findByRole('heading', { name: /gestión de workspaces/i })).toBeInTheDocument()

    cleanup()
    const realtimeRouter = createMemoryRouter(appRoutes, { initialEntries: ['/console/workspaces/ws_1/realtime'] })
    render(<RouterProvider router={realtimeRouter} />)
    expect(await screen.findByRole('heading', { name: /realtime workspace/i })).toBeInTheDocument()
  })

  it('[#726] renderiza /password-recovery como ruta pública real, no como NotFound', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/password-recovery'] })
    render(<RouterProvider router={router} />)

    expect(
      await screen.findByRole('heading', { name: /recupera el acceso a in falcone console/i })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /enviar instrucciones/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /volver a login/i })).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('heading', { name: /página no encontrada/i })).not.toBeInTheDocument()
  })
})


it('renderiza plan catalog para superadmin', async () => {
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/console/plans'] })
  render(<RouterProvider router={router} />)
  expect(await screen.findByRole('heading', { name: /plan catalog/i })).toBeInTheDocument()
})

it('[#740] redirige tenant_owner desde /console/auth sin renderizar Auth', async () => {
  readConsoleShellSessionMock.mockReturnValue(createRouterSession(['tenant_owner'], { tenantIds: ['ten_alpha'] }))

  const router = createMemoryRouter(appRoutes, { initialEntries: ['/console/auth'] })
  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { name: /my plan/i })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /auth iam/i })).not.toBeInTheDocument()
  expect(consoleAuthPageRenderMock).not.toHaveBeenCalled()
})

it('[#740] permite que superadmin abra /console/auth', async () => {
  readConsoleShellSessionMock.mockReturnValue(createRouterSession(['superadmin']))

  const router = createMemoryRouter(appRoutes, { initialEntries: ['/console/auth'] })
  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { name: /auth iam/i })).toBeInTheDocument()
  expect(consoleAuthPageRenderMock).toHaveBeenCalled()
})

it('[#740] redirige tenant_owner desde /console/iam-access sin renderizar IAM Access', async () => {
  readConsoleShellSessionMock.mockReturnValue(createRouterSession(['tenant_owner'], { tenantIds: ['ten_alpha'] }))

  const router = createMemoryRouter(appRoutes, { initialEntries: ['/console/iam-access'] })
  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { name: /my plan/i })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /iam access/i })).not.toBeInTheDocument()
  expect(consoleIamAccessPageRenderMock).not.toHaveBeenCalled()
})

it('[#740] permite que superadmin abra /console/iam-access', async () => {
  readConsoleShellSessionMock.mockReturnValue(createRouterSession(['superadmin']))

  const router = createMemoryRouter(appRoutes, { initialEntries: ['/console/iam-access'] })
  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { name: /iam access/i })).toBeInTheDocument()
  expect(consoleIamAccessPageRenderMock).toHaveBeenCalled()
})

function createRouterSession(
  platformRoles: string[],
  principalOverrides: Record<string, unknown> = {}
) {
  return {
    principal: {
      platformRoles,
      ...principalOverrides
    }
  }
}
