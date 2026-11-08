import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import i18n from '../src/i18n'
import { applicationsGet, portal, realmGet, requestId } from './parity/pages/console-auth-page.manifest'
import { applicationReads, calls, copy, failure, fill, open, pageCalls, ready, realmKey, writes, type Locale } from './consoleAuth-support'

let requests: ReturnType<typeof open>['requests']
const locales: Locale[] = ['es', 'en']
beforeEach(() => { vi.stubGlobal('PointerEvent', MouseEvent) })
afterEach(() => requests?.verify())
const start = async (locale: Locale, options: Parameters<typeof open>[0] = {}) => {
  await i18n.changeLanguage(locale)
  ;({ requests } = open(options))
}
const reads = (path: string) => pageCalls(requests).filter(({ method, path: sent }) => method === 'GET' && sent.startsWith(path))

test.each(locales)('loads exactly the five legacy reads and renders the realm and applications in %s', async (locale) => {
  const c = copy[locale]
  await start(locale)
  const grid = await ready(locale)
  expect(screen.getByRole('heading', { level: 1, name: c.title })).toBeVisible()
  // Header meta carries the organization, realm and workspace.
  expect(screen.getByText('Synthetic Tenant')).toBeVisible()
  expect(screen.getByText('synthetic-auth-realm')).toBeVisible()
  const kpis = screen.getByLabelText(c.kpi.label)
  expect(kpis).toHaveTextContent('3'); expect(kpis).toHaveTextContent('2')
  const scopes = await screen.findByRole('table', { name: c.scopes.table })
  expect(within(scopes).getByText('profile')).toBeVisible()
  const clients = await screen.findByRole('table', { name: c.clients.table })
  expect(within(clients).getByText('partner-api')).toBeVisible()
  expect(within(clients).getByText(c.enums.provisioning)).toBeVisible()
  // Soft-deleted applications are excluded; providers list every provider with its application.
  expect(within(grid).getByText('Portal Clientes')).toBeVisible()
  expect(within(grid).queryByText('Legacy Portal')).toBeNull()
  const providers = screen.getByRole('table', { name: c.providers.table })
  expect(within(providers).getByText('Corp OIDC')).toBeVisible()
  expect(within(providers).getByText('Portal Clientes')).toBeVisible()
  const sent = pageCalls(requests).map(({ method, path }) => `${method} ${path}`).sort()
  expect(sent).toEqual([
    'GET /v1/iam/realms/synthetic-auth-realm/clients?page[size]=100', 'GET /v1/iam/realms/synthetic-auth-realm/roles?page[size]=100',
    'GET /v1/iam/realms/synthetic-auth-realm/scopes?page[size]=100', 'GET /v1/iam/realms/synthetic-auth-realm/users?page[size]=100', `GET ${applicationsGet}`,
  ].sort())
  expect(calls(requests).filter(({ path }) => path.startsWith('/v1/metrics/'))).toEqual([])
  expect(realmGet('users')).toContain('page%5Bsize%5D=100')
})

test.each(locales)('selecting a client row drives the connection snippets without any request in %s', async (locale) => {
  const c = copy[locale]
  await start(locale)
  await ready(locale)
  const clients = await screen.findByRole('table', { name: c.clients.table })
  expect(screen.getByRole('heading', { name: c.snippets.title })).toBeVisible()
  expect(document.body.textContent).toContain("client_id=console-web")
  const before = pageCalls(requests).length
  fireEvent.click(within(clients).getByRole('button', { name: 'partner-api' }))
  expect(document.body.textContent).toContain('client_id=partner-api')
  expect(document.body.textContent).toContain('client_secret=<CLIENT_SECRET>')
  expect(screen.getByText(c.snippets.disabledNote)).toBeVisible()
  expect(screen.getByText(fill(c.snippets.stateNote, { state: 'provisioning' }))).toBeVisible()
  expect(pageCalls(requests)).toHaveLength(before)
})

test('without a tenant the page shows the empty message and sends nothing', async () => {
  await start('es', { shell: { tenants: false } })
  expect(await screen.findByRole('heading', { level: 1, name: copy.es.title })).toBeVisible()
  expect(await screen.findByText(copy.es.empty.noTenant)).toBeVisible()
  expect(pageCalls(requests)).toEqual([])
})

test('a tenant without a console realm shows the legacy message and sends nothing', async () => {
  await start('es', { shell: { realm: false } })
  expect(await screen.findByText(copy.es.empty.noRealm)).toBeVisible()
  expect(pageCalls(requests)).toEqual([])
})

test('without a workspace the realm loads and applications show the reason with a disabled create', async () => {
  await start('es', { shell: { workspaces: false } })
  expect(await screen.findByText(copy.es.apps.selectWorkspace)).toBeVisible()
  await screen.findByRole('table', { name: copy.es.clients.table })
  expect(screen.getByRole('button', { name: copy.es.apps.createExternal })).toHaveAttribute('aria-disabled', 'true')
  expect(applicationReads(requests)).toEqual([])
})

test('an empty realm and workspace show their own no-results states', async () => {
  await start('es', { routes: {
    [realmKey('scopes')]: { items: [] }, [realmKey('clients')]: { items: [] }, [`GET ${applicationsGet}`]: { items: [] },
  } })
  expect(await screen.findByText(copy.es.scopes.empty)).toBeVisible()
  expect(screen.getByText(copy.es.clients.empty)).toBeVisible()
  expect(await screen.findByText(copy.es.apps.empty)).toBeVisible()
  expect(screen.getByText(copy.es.providers.empty)).toBeVisible()
  expect(screen.queryByRole('heading', { name: copy.es.snippets.title })).toBeNull()
})

test('an application without providers shows the empty provider panel', async () => {
  await start('es', { routes: { [`GET ${applicationsGet}`]: { items: [{ ...portal, federatedProviders: [] }] } } })
  await ready()
  expect(screen.getByText(copy.es.providers.empty)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: fill(copy.es.apps.providersNamed, { name: 'Portal Clientes' }) }))
  expect(await screen.findByText(copy.es.panel.empty)).toBeVisible()
})

test('a retryable users failure shows the status, the request id and a working Reintentar for that section only', async () => {
  let attempts = 0
  await start('es', { routes: { [realmKey('users')]: () => { attempts += 1; return attempts === 1 ? failure(500)() : Response.json({ items: [{}] }) } } })
  const panel = await screen.findByTestId('auth-section-users-error')
  expect(panel).toHaveTextContent('500'); expect(panel).toHaveTextContent(requestId)
  expect(screen.queryByText('synthetic-backend-message')).toBeNull()
  fireEvent.click(within(panel).getByRole('button', { name: copy.es.failure.retry }))
  await waitFor(() => expect(screen.queryByTestId('auth-section-users-error')).toBeNull())
  expect(reads('/v1/iam/realms/synthetic-auth-realm/users')).toHaveLength(2)
  expect(reads('/v1/iam/realms/synthetic-auth-realm/roles')).toHaveLength(1)
  expect(reads('/v1/iam/realms/synthetic-auth-realm/scopes')).toHaveLength(1)
  expect(reads('/v1/iam/realms/synthetic-auth-realm/clients')).toHaveLength(1)
  expect(applicationReads(requests)).toHaveLength(1)
})

test('a non-retryable scopes failure has no Reintentar and the other sections stay usable', async () => {
  await start('es', { routes: { [realmKey('scopes')]: failure(400) } })
  const panel = await screen.findByTestId('auth-section-scopes-error')
  expect(within(panel).queryByRole('button', { name: copy.es.failure.retry })).toBeNull()
  expect(within(panel).getByText(copy.es.failure.noRetry)).toBeVisible()
  expect(await screen.findByRole('table', { name: copy.es.clients.table })).toBeVisible()
  expect(await ready()).toBeVisible()
})

test.each(locales)('a 403 on clients and applications shows only the localized no-access text in %s', async (locale) => {
  const c = copy[locale]
  await start(locale, { routes: { [realmKey('clients')]: failure(403), [`GET ${applicationsGet}`]: failure(403) } })
  expect(await within(await screen.findByTestId('auth-section-clients-error')).findByText(c.errors.noAccess)).toBeVisible()
  expect(await within(await screen.findByTestId('auth-applications-error')).findByText(c.errors.noAccess)).toBeVisible()
  expect(screen.queryByText('synthetic-backend-message')).toBeNull()
  expect(await screen.findByRole('table', { name: c.scopes.table })).toBeVisible()
})

test('a realm 404 and a workspace 404 render not-found states with their links back', async () => {
  await start('es', { routes: { [realmKey('roles')]: failure(404), [`GET ${applicationsGet}`]: failure(404) } })
  const realm = await screen.findByTestId('auth-section-roles-error')
  expect(within(realm).getByRole('link', { name: copy.es.failure.backOverview })).toHaveAttribute('href', '/console/overview')
  const apps = await screen.findByTestId('auth-applications-error')
  expect(within(apps).getByRole('link', { name: copy.es.failure.backWorkspaces })).toHaveAttribute('href', '/console/workspaces')
})

test('an applications 400 offers Reintentar and one click sends exactly one applications read', async () => {
  let attempts = 0
  await start('es', { routes: { [`GET ${applicationsGet}`]: () => { attempts += 1; return attempts === 1 ? failure(400)() : Response.json({ items: [portal] }) } } })
  const panel = await screen.findByTestId('auth-applications-error')
  const before = pageCalls(requests).length
  fireEvent.click(within(panel).getByRole('button', { name: copy.es.failure.retry }))
  await ready()
  expect(pageCalls(requests).slice(before).map(({ method, path }) => `${method} ${path}`)).toEqual([`GET ${applicationsGet}`])
})

test('an applications network failure shows the panel and no stale rows', async () => {
  await start('es', { routes: { [`GET ${applicationsGet}`]: () => { throw new TypeError('network') } } })
  const panel = await screen.findByTestId('auth-applications-error')
  expect(within(panel).getByRole('button', { name: copy.es.failure.retry })).toBeVisible()
  expect(screen.queryByText('Portal Clientes')).toBeNull()
  expect(writes(requests)).toEqual([])
})

test('Abrir miembros is a link and sends no request', async () => {
  await start('es')
  await ready()
  const before = pageCalls(requests).length
  expect(screen.getByRole('link', { name: copy.es.openMembers })).toHaveAttribute('href', '/console/members')
  expect(pageCalls(requests)).toHaveLength(before)
})
