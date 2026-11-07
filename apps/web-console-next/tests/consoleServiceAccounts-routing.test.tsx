import { StrictMode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'
import { pendingConsoleRoutes } from '../src/shell/routes'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { list, mixed, base } from './parity/pages/console-service-accounts-page.manifest'
import { buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import es from '../src/locales/es/pages.console-service-accounts-page.json'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const setup = (overrides = {}) => {
  login(['tenant_owner'], ['synthetic-tenant'])
  requests = strictFetch({
    'GET /v1/tenants/synthetic-tenant': { tenant: buildTenantCollectionFixture().items[0] }, [`GET ${tenantUrl}`]: buildTenantCollectionFixture(),
    [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(), [`GET ${base()}`]: list(mixed), ...overrides,
  })
}

test('the route is flagged migrated and the shell navigates client-side to it under /next', async () => {
  setup()
  expect(pendingConsoleRoutes.find((route) => route.path === 'service-accounts')?.migrated).toBe(true)
  expect(isMigratedRoute('/console/service-accounts')).toBe(true)
  const view = render(<StrictMode><MemoryRouter basename="/next" initialEntries={['/next/console/overview']}><App /></MemoryRouter></StrictMode>)
  const links = await screen.findAllByRole('link', { name: 'Cuentas de servicio' })
  expect(links[0]).toHaveAttribute('href', '/next/console/service-accounts')
  fireEvent.click(links[0])
  await screen.findByRole('table', { name: es.table.caption }, { timeout: 5000 })
  const sent = requests.mock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${String(url)}`)
  expect(sent.filter((entry) => entry.includes('/service-accounts'))).toEqual([`GET ${base()}`])
  view.unmount()
})

test('a list 401 refreshes once, then clears the session and redirects to login with the page return intent', async () => {
  let refreshes = 0
  setup({
    [`GET ${base()}`]: () => Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': () => { refreshes++; return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }) },
    'GET /v1/auth/signups/policy': { selfServiceEnabled: false, mode: 'invitation' },
  })
  render(<MemoryRouter initialEntries={['/console/service-accounts']}><App /></MemoryRouter>)
  await screen.findByLabelText('Usuario', {}, { timeout: 5000 })
  expect(refreshes).toBe(1)
  expect(readProtectedRouteIntent()).toBe('/console/service-accounts')
})
