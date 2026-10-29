import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { ConsoleContextProvider } from '../src/shell/context'
import { ProtectedRoute } from '../src/shell/session'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import ConsoleTenantsPage from '../src/pages/consoleTenants'
import es from '../src/locales/es/pages.console-tenants-page.json'
import { login, strictFetch, tenantUrl } from './shell-support'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const refresh = '/v1/auth/login-sessions/synthetic-session/refresh'
const plans = '/v1/plans?status=active&page=1&pageSize=100'
const quotas = '/v1/metrics/tenants/platform/quotas'
const overview = '/v1/metrics/tenants/platform/overview'
const error = (status: number) => Response.json({ code: `HTTP_${status}` }, { status })
function open() {
  login()
  render(<MemoryRouter initialEntries={['/console/tenants']}><Routes>
    <Route path="/console/tenants" element={<ProtectedRoute><ConsoleContextProvider><ConsoleTenantsPage /></ConsoleContextProvider></ProtectedRoute>} />
    <Route path={consoleAuthConfig.loginPath} element={<h1>Login destination</h1>} />
  </Routes></MemoryRouter>)
}
async function select(label: string, option: string) {
  await waitFor(() => expect(screen.getByRole('combobox', { name: label })).toBeEnabled())
  fireEvent.click(screen.getByRole('combobox', { name: label }))
  const item = await screen.findByRole('option', { name: option })
  fireEvent.pointerDown(item); fireEvent.click(item)
}
test.each([tenantUrl, plans, quotas, overview, '/v1/tenants'])('failed refresh after a 401 at %s redirects with the return path and never replays a create', async (path) => {
  requests = strictFetch({
    [`GET ${tenantUrl}`]: path === tenantUrl ? () => error(401) : { items: [], page: { after: null } },
    [`GET ${plans}`]: path === plans ? () => error(401) : { items: [{ id: 'p1', displayName: 'Starter', slug: 'starter' }] },
    [`GET ${quotas}`]: path === quotas ? () => error(401) : {},
    [`GET ${overview}`]: path === overview ? () => error(401) : {},
    [`POST ${refresh}`]: () => error(401),
    'POST /v1/tenants': () => error(401),
  })
  open()
  if ([plans, '/v1/tenants'].includes(path)) {
    fireEvent.click(await screen.findByRole('button', { name: es.create }))
    if (path === '/v1/tenants') {
      fireEvent.change(screen.getByLabelText(es.name), { target: { value: 'Organization' } })
      fireEvent.click(screen.getByRole('button', { name: es.next })); await select(es.planId, 'Starter (starter)')
      fireEvent.click(screen.getByRole('button', { name: es.next })); await select(es.region, es.euWest)
      fireEvent.click(screen.getByRole('button', { name: es.next })); fireEvent.click(screen.getByRole('button', { name: es.createTenant }))
    }
  }
  await screen.findByRole('heading', { name: 'Login destination' })
  await waitFor(() => expect(readProtectedRouteIntent()).toBe('/console/tenants'))
  expect(requests.mock.mock.calls.filter(([url]) => url === refresh)).toHaveLength(1)
  expect(requests.mock.mock.calls.filter(([url, init]) => url === '/v1/tenants' && init?.method === 'POST')).toHaveLength(path === '/v1/tenants' ? 1 : 0)
})
