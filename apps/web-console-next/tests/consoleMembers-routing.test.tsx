import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { collection, firstUsers, invitationsPath, roles, rolesGet, tenant, tenantId, users, workspace } from './parity/pages/console-members-page.manifest'
import es from '../src/locales/es/pages.console-members-page.json'
let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
function setup(overrides = {}) {
  login(['tenant_owner'], [tenantId])
  requests = strictFetch({ [`GET /v1/tenants/${tenantId}`]: { tenant }, [`GET ${workspaceUrl(tenantId)}`]: { items: [workspace] }, [`GET ${firstUsers}`]: collection(users), [`GET ${rolesGet}`]: collection(roles), [`GET ${invitationsPath}`]: { items: [] }, ...overrides })
}
test('navigates client-side through the shell members link under /next and loads only the page request list', async () => {
  setup()
  const view = render(<StrictMode><MemoryRouter basename="/next" initialEntries={['/next/console/overview']}><App /></MemoryRouter></StrictMode>)
  const links = await screen.findAllByRole('link', { name: 'Miembros' }); expect(links[0]).toHaveAttribute('href', '/next/console/members')
  fireEvent.click(links[0]); await screen.findByRole('table', { name: es.usersTable }, { timeout: 5000 })
  const sent = requests.mock.mock.calls.map(([url]) => String(url))
  const shellReads = new Set([`/v1/tenants/${tenantId}`, workspaceUrl(tenantId)])
  expect(sent.filter((url) => !shellReads.has(url)).sort()).toEqual([firstUsers, rolesGet, invitationsPath].sort())
  for (const [, init] of requests.mock.mock.calls) {
    expect(init?.method ?? 'GET').toBe('GET'); expect(init?.body).toBeUndefined()
  }
  view.unmount()
})
test('IAM 401 refreshes once then clears the session and redirects to login with members return intent', async () => {
  let refreshes = 0
  setup({ [`GET ${firstUsers}`]: () => Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }), 'POST /v1/auth/login-sessions/synthetic-session/refresh': () => { refreshes++; return Response.json(buildConsoleRefreshSessionFixture()) }, 'GET /v1/auth/signups/policy': { selfServiceEnabled: false, mode: 'invitation' } })
  render(<MemoryRouter initialEntries={['/console/members']}><App /></MemoryRouter>)
  await screen.findByLabelText('Usuario', {}, { timeout: 5000 })
  expect(refreshes).toBe(1); expect(readProtectedRouteIntent()).toBe('/console/members')
  expect(requests.mock.mock.calls.filter(([url]) => url === firstUsers)).toHaveLength(2)
})
