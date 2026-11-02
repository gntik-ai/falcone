import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import Page from '../src/pages/consoleTenantPlanOverview'
import { entitlementsMixed, entitlementsNoCapabilities, entitlementsNoLimits } from './parity/pages/console-tenant-plan-overview-page.manifest'
import { login, renderWithSession, strictFetch } from './shell-support'
import { ProtectedRoute } from '../src/shell/session'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-tenant-plan-overview-page.json'
import en from '../src/locales/en/pages.console-tenant-plan-overview-page.json'

const path = '/v1/tenant/plan/effective-entitlements?include=consumption'
const refresh = '/v1/auth/login-sessions/synthetic-session/refresh'
let requests: ReturnType<typeof strictFetch>
beforeEach(async () => { await i18n.changeLanguage('es') })
afterEach(() => requests?.verify())
const calls = () => requests.mock.mock.calls.filter(([url]) => url === path)
const fail = (status: number, extra = {}) => Response.json({ code: `HTTP_${status}`, message: 'PRIVATE_MARKER', ...extra }, { status })
const network = () => Promise.reject(new TypeError('Synthetic network failure'))
function Location() { return <output aria-label="Location">{useLocation().pathname}</output> }
function open(response: unknown = entitlementsMixed, roles = ['tenant_owner'], tenants: string[] = ['synthetic-tenant']) {
  login(roles, tenants)
  requests = strictFetch({ [`GET ${path}`]: response })
  return renderWithSession(<Routes>
    <Route path="/console/my-plan" element={<Page />} />
    <Route path="/console/plans" element={<h1>Plans destination</h1>} />
  </Routes>, { route: '/console/my-plan' })
}
const surface = () => document.querySelector('.my-plan') as HTMLElement
const row = (name: string) => within(screen.getByRole('table')).getByText(name, { exact: true }).closest('tr') as HTMLElement

test.each(['es', 'en'] as const)('renders the mixed fixture with plan, callout, limits and capabilities in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  open()
  expect(await screen.findByRole('heading', { level: 1, name: copy.title })).toBeVisible()
  expect(screen.getByText('synthetic-pro')).toBeVisible()
  expect(screen.getByText(copy.status.active)).toBeVisible()
  expect(await screen.findByRole('alert')).toHaveTextContent(locale === 'es' ? '1 dimensión está actualmente por encima del límite.' : '1 dimension is currently over its limit.')
  const table = screen.getByRole('table')
  expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([copy.dimension, copy.limit, copy.origin, copy.consumption, copy.state])
  for (const dimension of entitlementsMixed.quantitativeLimits!) expect(within(table).getByText(dimension.displayLabel!, { exact: true })).toBeVisible()
  // Unlimited, unknown usage and every usage status come from the legacy labels.
  expect(within(row('Synthetic Requests')).getByText(`${new Intl.NumberFormat(locale).format(1234)} / ${copy.unlimited}`)).toBeVisible()
  expect(within(row('Synthetic Buckets')).getAllByText(copy.noData).length).toBeGreaterThan(0)
  for (const [name, status] of [['Synthetic Workspaces', 'within_limit'], ['Synthetic Storage', 'approaching_limit'], ['Synthetic Functions', 'at_limit'], ['Synthetic Databases', 'over_limit'], ['Synthetic Buckets', 'unknown']] as const) {
    expect(within(row(name)).getByRole('group', { name: copy.usageStatusName.replace('{dimension}', name).replace('{status}', copy.usage[status]) })).toBeVisible()
  }
  expect(within(row('Synthetic Databases')).getByRole('meter', { name: copy.usageName.replace('{dimension}', 'Synthetic Databases') })).toHaveAttribute('aria-valuetext', locale === 'es' ? '3 de 2, por encima del límite' : '3 of 2, over the limit')
  expect(within(table).getAllByText(copy.originPlan)).toHaveLength(6)
  expect(screen.getByText('Synthetic SSO')).toBeVisible()
  expect(screen.getByRole('group', { name: copy.capability.enabled.replace('{capability}', 'Synthetic SSO') })).toHaveTextContent(copy.enabled)
  expect(screen.getByRole('group', { name: copy.capability.disabled.replace('{capability}', 'Synthetic Audit export') })).toHaveTextContent(copy.disabled)
  // No billing chrome and no kit sample data.
  expect(surface()).not.toHaveTextContent(/\$|€|renew|renov|monthly|mensual|annual|anual|Acme|Recent activity/i)
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  expect(calls()).toHaveLength(1)
  expect(requests.mock.mock.calls).toHaveLength(1)
  expect(calls()[0][1]).toMatchObject({ method: 'GET' })
  expect(calls()[0][1]?.body).toBeUndefined()
})

test('shows the plain no-plan text and no status tag when the plan fields are absent', async () => {
  open({ tenantId: 'synthetic-tenant', quantitativeLimits: [], capabilities: [] })
  expect(await screen.findByText(es.noPlan)).toBeVisible()
  expect(screen.queryByText(es.status.active)).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test.each([[1, '1 dimensión está actualmente por encima del límite.'], [2, '2 dimensiones están actualmente por encima del límite.']])('over-limit callout counts %s dimension(s) with singular and plural copy', async (count, text) => {
  open({ ...entitlementsMixed, quantitativeLimits: Array.from({ length: count }, (_, index) => ({ dimensionKey: `d${index}`, displayLabel: `Dim ${index}`, effectiveValue: 1, currentUsage: 2, usageStatus: 'over_limit' as const })) })
  expect(await screen.findByRole('alert')).toHaveTextContent(text)
})

test('hides the callout at zero over-limit dimensions', async () => {
  open({ ...entitlementsMixed, quantitativeLimits: entitlementsMixed.quantitativeLimits!.filter((item) => item.usageStatus !== 'over_limit') })
  await screen.findByRole('table')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test.each([['absent', { ...entitlementsMixed, quantitativeLimits: undefined }], ['empty', entitlementsNoLimits]])('%s limits render Sin cuotas while the rest stays rendered', async (_name, body) => {
  open(body)
  expect(await screen.findByRole('heading', { name: es.noLimits })).toBeVisible()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(screen.getByText('synthetic-pro')).toBeVisible()
  expect(screen.getByText('Synthetic SSO')).toBeVisible()
})

test('missing effectiveValue renders Sin límite and an unknown usage enum falls back to Desconocido', async () => {
  open({ ...entitlementsMixed, quantitativeLimits: [{ dimensionKey: 'max_x', effectiveValue: null, currentUsage: 3, usageStatus: 'surprise' as never }], capabilities: [] })
  const table = await screen.findByRole('table')
  expect(within(table).getByText('max_x')).toBeVisible()
  expect(within(table).getByText(es.unlimited)).toBeVisible()
  expect(within(table).getByRole('group', { name: 'max_x: estado Desconocido' })).toBeVisible()
})

test('empty capabilities show the translated copy while the plan, callout and limits stay rendered', async () => {
  open(entitlementsNoCapabilities)
  expect(await screen.findByRole('heading', { name: es.noCapabilities })).toBeVisible()
  expect(screen.getByText('synthetic-pro')).toBeVisible()
  expect(screen.getByRole('alert')).toBeVisible()
  expect(screen.getByRole('table')).toBeVisible()
  expect(screen.getAllByRole('tab')).toHaveLength(2)
})

test('Historial renders the empty-history state without a request, and the tabs move with the arrow keys', async () => {
  open()
  const summary = await screen.findByRole('tab', { name: es.tabSummary })
  expect(summary).toHaveAttribute('aria-selected', 'true')
  summary.focus()
  fireEvent.keyDown(summary, { key: 'ArrowRight' })
  const history = screen.getByRole('tab', { name: es.tabHistory })
  await waitFor(() => expect(history).toHaveAttribute('aria-selected', 'true'))
  expect(history).toHaveFocus()
  expect(await screen.findByRole('heading', { name: es.historyEmptyTitle })).toBeVisible()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  fireEvent.keyDown(history, { key: 'ArrowLeft' })
  await waitFor(() => expect(summary).toHaveAttribute('aria-selected', 'true'))
  expect(requests.mock.mock.calls).toHaveLength(1)
})

test('shows skeletons while the request is pending and no table before it resolves', async () => {
  let release!: (response: Response) => void
  login(['tenant_owner'], ['synthetic-tenant'])
  requests = strictFetch({ [`GET ${path}`]: () => new Promise<Response>((resolve) => { release = resolve }) })
  renderWithSession(<Page />, { route: '/console/my-plan' })
  expect(await screen.findByRole('status', { name: es.loading })).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByRole('heading', { level: 1, name: es.title })).toBeVisible()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  await act(async () => release(Response.json(entitlementsMixed)))
  expect(await screen.findByRole('table')).toBeVisible()
})

test('tenantless superadmin gets the catalogue action and no request; it navigates with heading focus state', async () => {
  login(['superadmin'], [])
  requests = strictFetch({})
  renderWithSession(<><Location /><Routes>
    <Route path="/console/my-plan" element={<Page />} />
    <Route path="/console/plans" element={<h1>Plans destination</h1>} />
  </Routes></>, { route: '/console/my-plan' })
  expect(await screen.findByRole('heading', { name: es.tenantlessTitle })).toBeVisible()
  expect(screen.getByText(/Abre el catálogo de planes/)).toBeVisible()
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: es.openCatalog }))
  expect(await screen.findByRole('heading', { name: 'Plans destination' })).toBeVisible()
  expect(screen.getByLabelText('Location')).toHaveTextContent('/console/plans')
  expect(requests.mock).not.toHaveBeenCalled()
})

test.each(['platform_operator', 'platform_admin'])('tenantless %s sees the description without an action and sends no request', async (role) => {
  login([role], [])
  requests = strictFetch({})
  renderWithSession(<Page />, { route: '/console/my-plan' })
  expect(await screen.findByRole('heading', { name: es.tenantlessTitle })).toBeVisible()
  expect(screen.getByText(/derechos de la organización se revisan desde páginas específicas/)).toBeVisible()
  expect(surface().querySelector('button, a')).toBeNull()
  expect(requests.mock).not.toHaveBeenCalled()
})

test('a superadmin that has a tenant still loads the own-tenant plan', async () => {
  open(entitlementsMixed, ['superadmin'], ['synthetic-tenant'])
  expect(await screen.findByText('synthetic-pro')).toBeVisible()
  expect(calls()).toHaveLength(1)
})

test('403 renders the no-access state without retry', async () => {
  open(() => fail(403))
  expect(await screen.findByRole('heading', { name: es.noAccessTitle })).toBeVisible()
  expect(screen.queryByRole('button', { name: es.retry })).not.toBeInTheDocument()
  expect(surface()).not.toHaveTextContent('PRIVATE_MARKER')
})

test('404 renders not-found with a link back to the overview', async () => {
  open(() => fail(404))
  expect(await screen.findByRole('heading', { name: es.notFoundTitle })).toBeVisible()
  expect(screen.getByRole('link', { name: es.backToOverview })).toHaveAttribute('href', '/console/overview')
})

test('500 renders the error panel with the request id; Reintentar keeps focus while loading, then focuses the heading', async () => {
  let release!: (response: Response) => void
  let count = 0
  open(() => ++count === 1 ? fail(500, { requestId: 'req_500' }) : new Promise<Response>((resolve) => { release = resolve }))
  expect(await screen.findByRole('heading', { name: es.errorTitle })).toBeVisible()
  expect(screen.getByText('req_500')).toBeVisible()
  expect(surface()).not.toHaveTextContent('PRIVATE_MARKER')
  const retry = screen.getByRole('button', { name: es.retry })
  retry.focus()
  fireEvent.click(retry)
  const retrying = await screen.findByRole('button', { name: es.retrying })
  expect(retrying).toHaveFocus()
  expect(retrying).toHaveAttribute('aria-busy', 'true')
  fireEvent.click(retrying)
  await act(async () => release(Response.json(entitlementsMixed)))
  expect(await screen.findByRole('table')).toBeVisible()
  expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
  expect(calls()).toHaveLength(2)
})

test('a network error renders the error panel with retry, no request id and no summary', async () => {
  open(network)
  expect(await screen.findByRole('heading', { name: es.errorTitle })).toBeVisible()
  expect(screen.getByText(es.networkMessage)).toBeVisible()
  expect(screen.getByRole('button', { name: es.retry })).toBeVisible()
  expect(screen.queryByText(es.requestId)).not.toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(screen.queryByText('synthetic-pro')).not.toBeInTheDocument()
})

test('Reintentar after a failure clears the failed view and recovers', async () => {
  let count = 0
  open(() => ++count === 1 ? network() : Response.json(entitlementsMixed))
  fireEvent.click(await screen.findByRole('button', { name: es.retry }))
  expect(await screen.findByText('synthetic-pro')).toBeVisible()
  expect(screen.queryByRole('heading', { name: es.errorTitle })).not.toBeInTheDocument()
})

test.each([false, true])('401 refresh rejected=%s uses the shared transport and login intent', async (rejected) => {
  login(['tenant_owner'], ['synthetic-tenant'])
  let count = 0
  requests = strictFetch({
    [`GET ${path}`]: () => ++count === 1 ? fail(401) : Response.json(entitlementsMixed),
    [`POST ${refresh}`]: () => rejected ? fail(401) : Response.json(buildConsoleRefreshSessionFixture()),
  })
  render(<MemoryRouter initialEntries={['/console/my-plan']}><Routes>
    <Route path="/console/my-plan" element={<ProtectedRoute><Page /></ProtectedRoute>} />
    <Route path="/login" element={<Location />} />
  </Routes></MemoryRouter>)
  if (rejected) {
    await waitFor(() => expect(readProtectedRouteIntent()).toBe('/console/my-plan'))
    expect(screen.getByLabelText('Location')).toHaveTextContent('/login')
    expect(calls()).toHaveLength(1)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  } else {
    await screen.findByRole('table')
    expect(calls()).toHaveLength(2)
    expect(new Headers(calls()[1][1]?.headers).get('Authorization')).toBe('Bearer synthetic-refreshed-access-token')
    expect(new Headers(calls()[0][1]?.headers).get('Authorization')).toBe('Bearer synthetic-access-token')
  }
  const refreshCalls = requests.mock.mock.calls.filter(([url]) => url === refresh)
  expect(refreshCalls).toHaveLength(1)
  expect(JSON.parse(String(refreshCalls[0][1]?.body))).toEqual({ refreshToken: 'synthetic-refresh-token' })
})

test('both catalogs define the same keys', () => {
  const keys = (value: object, prefix = ''): string[] => Object.entries(value).flatMap(([key, child]) => typeof child === 'string' ? [prefix + key] : keys(child, `${prefix}${key}.`))
  expect(keys(es).sort()).toEqual(keys(en).sort())
})
