import { StrictMode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { adaGroups, adaId, adaRoles, firstUsers, groups3, groupsPath, listOf, realmId, roles4, rolesPath, tenant, userPath, users23 } from './parity/pages/console-iam-access-page.manifest'
import es from '../src/locales/es/pages.console-iam-access-page.json'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const shell = { [`GET ${tenantUrl}`]: { items: [tenant], page: { after: null } }, [`GET ${workspaceUrl(realmId)}`]: { items: [], page: { after: null } } }
const pageRoutes = { [`GET ${firstUsers}`]: listOf(users23), [`GET ${rolesPath}`]: listOf(roles4), [`GET ${groupsPath}`]: listOf(groups3), [`GET ${userPath(adaId)}/roles`]: listOf(adaRoles), [`GET ${userPath(adaId)}/groups`]: listOf(adaGroups) }
const sentPaths = () => requests.mock.mock.calls.map(([url]) => String(url))

test('navigates client-side through the shell link under /next and sends only the page request list', async () => {
  login(['superadmin']); requests = strictFetch({ ...shell, ...pageRoutes })
  const view = render(<StrictMode><MemoryRouter basename="/next" initialEntries={['/next/console/overview']}><App /></MemoryRouter></StrictMode>)
  const links = await screen.findAllByRole('link', { name: 'Acceso IAM' })
  expect(links[0]).toHaveAttribute('href', '/next/console/iam-access')
  fireEvent.click(links[0])
  await screen.findByRole('table', { name: es.users.tableLabel }, { timeout: 5000 })
  expect(screen.getByRole('heading', { name: es.title })).toBeVisible()
  const bootstrap = new Set([tenantUrl, workspaceUrl(realmId)])
  expect(sentPaths().filter((url) => !bootstrap.has(url)).sort()).toEqual([firstUsers, groupsPath, rolesPath].sort())
  for (const [, init] of requests.mock.mock.calls) { expect(init?.method ?? 'GET').toBe('GET'); expect(init?.body).toBeUndefined() }
  view.unmount()
})

test.each([['tenant_owner'], ['platform_auditor'], []])('%s sees access denied and sends no IAM request', async (...roles) => {
  login(roles); requests = strictFetch({ ...shell })
  render(<MemoryRouter initialEntries={['/console/iam-access']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Acceso denegado' }, { timeout: 5000 })).toBeVisible()
  expect(sentPaths().filter((url) => url.startsWith('/v1/iam/'))).toEqual([])
})

test('a 401 refreshes once, then clears the session and redirects to login with the return intent', async () => {
  let refreshes = 0
  login(['superadmin'])
  requests = strictFetch({ ...shell, ...pageRoutes, [`GET ${firstUsers}`]: () => Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': () => { refreshes += 1; return Response.json(buildConsoleRefreshSessionFixture()) }, 'GET /v1/auth/signups/policy': { selfServiceEnabled: false, mode: 'invitation' } })
  render(<MemoryRouter initialEntries={['/console/iam-access']}><App /></MemoryRouter>)
  await screen.findByLabelText('Usuario', {}, { timeout: 5000 })
  expect(refreshes).toBe(1); expect(readProtectedRouteIntent()).toBe('/console/iam-access')
  expect(sentPaths().filter((url) => url === firstUsers)).toHaveLength(2)
})
