import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import { appRoutes, pendingRouteElement } from '../src/router'
import { pendingConsoleRoutes } from '../src/shell/routes'
import { isMigratedRoute } from '../src/shell/navigation'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { databasePath, record, provisioned, rotated, rotationPath } from './parity/pages/console-workspace-database-page.manifest'
import i18n from '../src/i18n'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const shell = () => ({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), 'GET /v1/tenants/synthetic-tenant': buildTenantCollectionFixture().items[0], [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(), 'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture() })
const dbCalls = () => requests.mock.mock.calls.filter(([path]) => path === databasePath || path === rotationPath || String(path).endsWith('/refresh')).map(([path, init]) => ({ method: init?.method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined }))
function Where() { return <output aria-label="Current location">{useLocation().pathname}</output> }
function open(path = '/console/database') { return render(<MemoryRouter initialEntries={[path]}><Where /><App /></MemoryRouter>) }

test.each(['tenant_viewer', 'tenant_owner', 'superadmin'])('authenticated %s reaches the migrated database without a guard', async (role) => {
  login([role], ['synthetic-tenant']); requests = strictFetch({ ...shell(), [`GET ${databasePath}`]: { database: record } }); open()
  expect(await screen.findByText(record.database_name, {}, { timeout: 10000 })).toBeVisible()
  expect(dbCalls()).toEqual([{ method: 'GET', path: databasePath, body: undefined }]); expect(isMigratedRoute('/console/database')).toBe(true)
})
test('sidebar arrival stays in-app and sends one read', async () => {
  login(); requests = strictFetch({ ...shell(), 'GET /v1/postgres/databases?page%5Bsize%5D=100': { items: [], page: {} }, [`GET ${databasePath}`]: { database: record } }); open('/console/postgres')
  const link = await screen.findByRole('link', { name: 'DB del área de trabajo' }, { timeout: 10000 })
  expect(link.getAttribute('href')).toBe('/console/database'); fireEvent.click(link)
  await screen.findByText(record.database_name); expect(screen.getByLabelText('Current location')).toHaveTextContent('/console/database'); expect(dbCalls()).toHaveLength(1)
})
test.each([false, true])('401 refresh rejected=%s logs exactly the initial read, refresh and permitted replay', async (rejected) => {
  const initial = login(); let count = 0
  const fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal
  const refreshPath = '/v1/auth/login-sessions/synthetic-session/refresh'
  requests = strictFetch({ ...shell(), [`GET ${databasePath}`]: () => ++count === 1 ? Response.json({}, { status: 401 }) : Response.json({ database: record }),
    [`POST ${refreshPath}`]: () => rejected ? Response.json({}, { status: 400 }) : Response.json(fresh) })
  open()
  if (rejected) {
    await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, { timeout: 10000 })
    expect(screen.getByLabelText('Current location')).toHaveTextContent('/login'); expect(readProtectedRouteIntent()).toBe('/console/database')
  } else await screen.findByText(record.database_name, {}, { timeout: 10000 })
  expect(dbCalls()).toEqual([{ method: 'GET', path: databasePath, body: undefined }, { method: 'POST', path: refreshPath, body: { refreshToken: initial.tokenSet?.refreshToken } }, ...(rejected ? [] : [{ method: 'GET', path: databasePath, body: undefined }])])
  if (!rejected) {
    const reads = requests.mock.mock.calls.filter(([path]) => path === databasePath)
    expect(new Headers(reads[1][1]?.headers).get('Authorization')).toBe(`Bearer ${fresh.tokenSet?.accessToken}`)
  }
})
test.each(['provision', 'rotate'])('401 %s has exactly one replay after refresh and no duplicate mutation', async (op) => {
  const initial = login(), fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal
  let posts = 0
  const path = op === 'provision' ? databasePath : rotationPath
  requests = strictFetch({ ...shell(), [`GET ${databasePath}`]: () => op === 'provision' ? Response.json({}, { status: 404 }) : Response.json({ database: record }),
    [`POST ${path}`]: () => ++posts === 1 ? Response.json({}, { status: 401 }) : Response.json(op === 'provision' ? provisioned : rotated),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': fresh })
  open()
  if (op === 'provision') fireEvent.click(await screen.findByRole('button', { name: 'Aprovisionar base de datos' }, { timeout: 10000 }))
  else {
    fireEvent.click(await screen.findByRole('button', { name: 'Rotar credencial' }, { timeout: 10000 }))
    const dialog = screen.getByRole('alertdialog')
    fireEvent.change(within(dialog).getByLabelText('Escribe el nombre de la base de datos para confirmar'), { target: { value: record.database_name } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar rotación' }))
  }
  await screen.findByTestId('database-password')
  expect(dbCalls().map(({ method, path }) => `${method} ${path}`)).toEqual([`GET ${databasePath}`, `POST ${path}`, 'POST /v1/auth/login-sessions/synthetic-session/refresh', `POST ${path}`])
  expect(dbCalls().filter((call) => call.path === path && call.method === 'POST').every(({ body }) => JSON.stringify(body) === '{}')).toBe(true)
})
test('rolling back the route flag makes navigation pending and sends no database request', async () => {
  login(); requests = strictFetch(shell())
  const children = appRoutes.find(({ path }) => path === '/console')!.children!
  const page = children.find(({ path }) => path === 'database')!, flag = pendingConsoleRoutes.find(({ path }) => path === 'database')!
  const element = page.element, migrated = flag.migrated
  page.element = pendingRouteElement(); flag.migrated = false
  try { open(); await screen.findByRole('heading', { name: 'Página pendiente' }, { timeout: 10000 }); expect(dbCalls()).toEqual([]); expect(isMigratedRoute('/console/database')).toBe(false) }
  finally { page.element = element; flag.migrated = migrated }
})
for (const locale of ['es', 'en']) test(`real workspace retry in ${locale} reloads exactly once without an early database read`, async () => {
  await i18n.changeLanguage(locale); login(); let count = 0
  requests = strictFetch({ ...shell(), [`GET ${workspaceUrl('synthetic-tenant')}`]: () => ++count === 1 ? Response.json({}, { status: 500 }) : Response.json(buildWorkspaceCollectionFixture()), [`GET ${databasePath}`]: { database: record } })
  open(); await screen.findByTestId('workspace-database-page', {}, { timeout: 10000 })
  const surface = screen.getByTestId('workspace-database-page')
  const alert = await within(surface).findByRole('alert')
  const retry = within(alert).getByRole('button', { name: locale === 'es' ? 'Reintentar' : 'Retry' })
  expect(dbCalls()).toEqual([]); fireEvent.click(retry); await screen.findByText(record.database_name)
  expect(count).toBe(2); expect(dbCalls()).toHaveLength(1)
})
