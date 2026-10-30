import { buildConsoleSignupPolicyFixture } from '@in-falcone/console-api/fixtures'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { overviewTenant } from './parity/fixtures/overview'
import { isMigratedRoute } from '../src/shell/navigation'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const storedContext = (tenantId: string) => localStorage.setItem('in-falcone.console-active-context', JSON.stringify({ userId: 'synthetic-user', tenantId, workspaceId: null, updatedAt: '2026-06-01T12:00:00Z' }))
function open() { return render(<StrictMode><MemoryRouter initialEntries={['/console/overview']}><App /></MemoryRouter></StrictMode>) }

test.each(['superadmin', 'tenant_owner', 'tenant_viewer'])('allows authenticated %s with exactly the shell GET method, query and no body', async (role) => {
  login([role], ['synthetic-tenant'])
  const path = role === 'tenant_owner' ? '/v1/tenants/synthetic-tenant' : tenantUrl
  requests = strictFetch({ [`GET ${path}`]: role === 'tenant_owner' ? overviewTenant : { items: [overviewTenant] }, [`GET ${workspaceUrl('synthetic-tenant')}`]: { items: [] } })
  open()
  await screen.findByTestId('console-tenant-inventory-summary')
  expect(requests.mock.mock.calls.map(([path, init]) => ({ method: init?.method, path, body: init?.body }))).toEqual([
    { method: 'GET', path, body: undefined }, { method: 'GET', path: workspaceUrl('synthetic-tenant'), body: undefined },
  ])
  expect(isMigratedRoute('/console/overview')).toBe(true)
  expect(isMigratedRoute('/console/functions-registry')).toBe(true)
  expect(isMigratedRoute('/console/flows')).toBe(true)
  for (const path of ['workspaces', 'members', 'my-plan']) expect(isMigratedRoute(`/console/${path}`)).toBe(false)
})

test.each([1, 2])('an invalid stored tenant resolves only through the shell with %s accessible tenants', async (size) => {
  login(); storedContext('synthetic-removed')
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: size === 1 ? [overviewTenant] : [overviewTenant, { ...overviewTenant, tenantId: 'synthetic-other' }] }, [`GET ${workspaceUrl('synthetic-tenant')}`]: { items: [] } })
  open()
  if (size === 1) await screen.findByTestId('console-tenant-inventory-summary')
  else {
    expect(await screen.findByRole('heading', { name: 'Selecciona una organizacion' })).toBeVisible()
    expect(screen.queryByTestId('console-tenant-inventory-summary')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar organización' }))
    expect(screen.getByRole('combobox', { name: 'Organización activa' })).toHaveFocus()
  }
  expect(requests.mock).toHaveBeenCalledTimes(size === 1 ? 2 : 1)
})

test('switching to a tenant without summaries never retains the prior tenant inventory', async () => {
  login(); storedContext('synthetic-tenant')
  requests = strictFetch({
    [`GET ${tenantUrl}`]: { items: [overviewTenant, { ...overviewTenant, tenantId: 'synthetic-other', displayName: 'Synthetic Other', quotaProfile: undefined, inventorySummary: undefined }] },
    [`GET ${workspaceUrl('synthetic-tenant')}`]: { items: [] }, [`GET ${workspaceUrl('synthetic-other')}`]: { items: [] },
  })
  open(); await screen.findByTestId('console-tenant-inventory-summary')
  fireEvent.change(screen.getByRole('combobox', { name: 'Organización activa' }), { target: { value: 'synthetic-other' } })
  expect(await screen.findByRole('heading', { name: 'Sin inventario' })).toBeVisible()
  expect(screen.queryByText('12.345')).not.toBeInTheDocument()
  expect(requests.mock).toHaveBeenCalledTimes(3)
})

test.each([403, 500, 'network'] as const)('a tenant switch clears populated summaries while loading and after a shell %s failure', async (status) => {
  login(); storedContext('synthetic-tenant')
  let complete!: (response: Response) => void
  let fail!: (error: Error) => void
  const pending = new Promise<Response>((resolve, reject) => { complete = resolve; fail = reject })
  requests = strictFetch({
    [`GET ${tenantUrl}`]: { items: [overviewTenant, { ...overviewTenant, tenantId: 'synthetic-other', displayName: 'Synthetic Other' }] },
    [`GET ${workspaceUrl('synthetic-tenant')}`]: { items: [] },
    [`GET ${workspaceUrl('synthetic-other')}`]: () => pending,
  })
  open(); await screen.findByTestId('console-tenant-inventory-summary')
  fireEvent.change(screen.getByRole('combobox', { name: 'Organización activa' }), { target: { value: 'synthetic-other' } })
  expect(await screen.findByRole('status', { name: 'Cargando resumen de cuotas.' })).toBeVisible()
  expect(screen.getByRole('status', { name: 'Cargando inventario.' })).toBeVisible()
  for (const kind of ['quota', 'inventory']) expect(screen.queryByTestId(`console-tenant-${kind}-summary`)).not.toBeInTheDocument()
  if (status === 'network') fail(new TypeError('Synthetic network failure'))
  else complete(Response.json({}, { status }))
  expect(await screen.findByRole('heading', { name: status === 403 ? 'Sin acceso a los resúmenes' : 'No se pudieron cargar los resúmenes' })).toBeVisible()
  for (const kind of ['quota', 'inventory']) expect(screen.queryByTestId(`console-tenant-${kind}-summary`)).not.toBeInTheDocument()
  expect(screen.queryByText('12.345')).not.toBeInTheDocument()
  for (const path of ['workspaces', 'members', 'flows', 'my-plan']) expect(document.querySelector(`.console-overview a[href="/console/${path}"]`)).toBeVisible()
  expect(requests.mock.mock.calls.map(([path, init]) => ({ method: init?.method, path, body: init?.body }))).toEqual([
    { method: 'GET', path: tenantUrl, body: undefined },
    { method: 'GET', path: workspaceUrl('synthetic-tenant'), body: undefined },
    { method: 'GET', path: workspaceUrl('synthetic-other'), body: undefined },
  ])
})

test.each(['rejected', 'after-refresh', 'refresh-ok'])('delegates 401 refresh and login redirect to the shell: %s', async (variant) => {
  login(['tenant_owner'], ['synthetic-tenant'])
  let attempt = 0
  requests = strictFetch({ 'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture(),
    'GET /v1/tenants/synthetic-tenant': () => ++attempt === 2 && variant === 'refresh-ok' ? Response.json(overviewTenant) : Response.json({}, { status: 401 }),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': () => variant === 'rejected' ? Response.json({}, { status: 401 }) : Response.json(buildConsoleRefreshSessionFixture()),
    [`GET ${workspaceUrl('synthetic-tenant')}`]: { items: [] },
  })
  open()
  if (variant === 'refresh-ok') await screen.findByTestId('console-tenant-inventory-summary')
  else {
    expect(await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, { timeout: 3000 })).toBeVisible()
    expect(readProtectedRouteIntent()).toBe('/console/overview')
  }
  await waitFor(() => expect(requests.mock.mock.calls.filter(([path]) => String(path).endsWith('/refresh'))).toHaveLength(1))
  const refresh = requests.mock.mock.calls.find(([path]) => String(path).endsWith('/refresh'))!
  expect(refresh[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ refreshToken: 'synthetic-refresh-token' }) })
  expect(attempt).toBe(variant === 'rejected' ? 1 : 2)
})
