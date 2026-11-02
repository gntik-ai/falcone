import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import PlanOverviewPage from '../src/pages/consoleTenantPlanOverview'
import { entitlementsMixed, entitlementsNoCapabilities, entitlementsNoLimits, overviewUrl } from './parity/pages/console-tenant-plan-overview-page.manifest'
import { login, renderWithSession, strictFetch } from './shell-support'
import { ProtectedRoute } from '../src/shell/session'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-tenant-plan-overview-page.json'
import en from '../src/locales/en/pages.console-tenant-plan-overview-page.json'

const refresh = '/v1/auth/login-sessions/synthetic-session/refresh'
let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const calls = () => requests.mock.mock.calls.filter(([url]) => String(url).startsWith('/v1/tenant/plan'))
function Location() { return <output aria-label="Location">{useLocation().pathname}</output> }
function open(response: unknown = entitlementsMixed, roles = ['tenant_owner'], tenants = ['synthetic-tenant']) {
  login(roles, tenants)
  requests = strictFetch({ [`GET ${overviewUrl}`]: response })
  return renderWithSession(<><Location /><Routes>
    <Route path="/console/my-plan" element={<PlanOverviewPage />} />
    <Route path="/console/plans" element={<h1>Plans destination</h1>} />
    <Route path="/console/overview" element={<h1>Overview destination</h1>} />
  </Routes></>, { route: '/console/my-plan' })
}
const fail = (status: number, extra = {}) => Response.json({ code: `HTTP_${status}`, message: 'PRIVATE_MARKER', correlationId: 'PRIVATE_CORRELATION', ...extra }, { status })
const copyFor = (locale: 'es' | 'en') => locale === 'es' ? es : en

test.each(['es', 'en'] as const)('renders the plan, callout, limits and capabilities with one own-tenant request in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = copyFor(locale)
  open()
  expect(await screen.findByRole('heading', { level: 1, name: copy.title })).toBeVisible()
  expect(await screen.findByText('synthetic-pro')).toBeVisible()
  expect(screen.getByLabelText(copy.planStatusName.replace('{status}', copy.status.active))).toBeVisible()
  const callout = screen.getByText(locale === 'es' ? '1 dimensión está actualmente por encima del límite.' : '1 dimension is currently over its limit.')
  expect(callout).toBeVisible()
  const table = screen.getByRole('table', { name: copy.limitsTitle })
  expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([copy.dimension, copy.limit, copy.origin, copy.consumption, copy.state])
  expect(within(table).getAllByRole('row')).toHaveLength(7)
  expect(within(table).getByText('Synthetic Workspaces')).toBeVisible()
  expect(within(table).getAllByText(copy.unlimitedUsage.replace('{used}', '1234'))).toHaveLength(1)
  expect(within(table).getAllByText(copy.unlimited)).toHaveLength(1)
  expect(within(table).getAllByText(copy.noData)).toHaveLength(1)
  expect(within(table).getAllByRole('meter')).toHaveLength(4)
  expect(within(table).getAllByRole('meter')[0]).toHaveAccessibleName(copy.usageName.replace('{dimension}', 'Synthetic Workspaces'))
  for (const [key, label] of [['within_limit', 'Synthetic Workspaces'], ['approaching_limit', 'Synthetic Functions'], ['at_limit', 'Synthetic Buckets'], ['over_limit', 'Synthetic Databases'], ['unknown', 'Synthetic Topics']] as const) {
    const name = copy.usageStatusName.replace('{dimension}', label).replace('{status}', copy.usage[key])
    expect(within(table).getByLabelText(name)).toHaveTextContent(copy.usage[key])
  }
  expect(screen.getByLabelText(copy.capabilityEnabledName.replace('{capability}', 'Synthetic Realtime'))).toHaveTextContent(copy.capabilityEnabled)
  expect(screen.getByLabelText(copy.capabilityDisabledName.replace('{capability}', 'Synthetic SSO'))).toHaveTextContent(copy.capabilityDisabled)
  expect(screen.getAllByText(copy.capabilityOrigin).length).toBeGreaterThanOrEqual(2)
  for (const absent of [/precio|price/i, /renov|renewal/i, /ciclo|cycle/i]) expect(document.body).not.toHaveTextContent(absent)
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  expect(calls()).toHaveLength(1)
  expect(calls()[0][0]).toBe('/v1/tenant/plan/effective-entitlements?include=consumption')
  expect(calls()[0][1]).toMatchObject({ method: 'GET' })
  expect(calls()[0][1]?.body).toBeUndefined()
  expect(requests.mock.mock.calls.some(([url]) => String(url).startsWith('/v1/tenants/'))).toBe(false)
})

test('no plan renders muted Sin plan asignado and no status tag', async () => {
  open({ tenantId: 'synthetic-tenant', quantitativeLimits: [], capabilities: [] })
  expect(await screen.findByText(es.noPlan)).toBeVisible()
  expect(screen.queryByLabelText(/Estado del plan:/)).not.toBeInTheDocument()
})

test.each([[0, 0], [1, 1], [3, 3]])('the over-limit callout shows for %s over-limit dimensions only when above zero', async (count) => {
  const limits = Array.from({ length: 4 }, (_, index) => ({ dimensionKey: `dim_${index}`, displayLabel: `Dim ${index}`, effectiveValue: 10, currentUsage: index < count ? 11 : 1, usageStatus: index < count ? 'over_limit' : 'within_limit' }))
  open({ ...entitlementsMixed, quantitativeLimits: limits })
  await screen.findByRole('table')
  const text = count === 1 ? '1 dimensión está actualmente por encima del límite.' : `${count} dimensiones están actualmente por encima del límite.`
  if (count === 0) expect(screen.queryByText(/por encima del límite\.$/)).not.toBeInTheDocument()
  else expect(screen.getByText(text)).toBeVisible()
})

test('missing effectiveValue renders Sin límite and unknown usage Datos no disponibles', async () => {
  open({ ...entitlementsMixed, quantitativeLimits: [{ dimensionKey: 'x', usageStatus: 'unknown' }] })
  const table = await screen.findByRole('table')
  expect(within(table).getByText('x')).toBeVisible()
  expect(within(table).getByText(es.unlimited)).toBeVisible()
  expect(within(table).getByText(es.unlimitedUsage.replace('{used}', es.dash))).toBeVisible()
  expect(within(table).getByText(es.noData)).toBeVisible()
  expect(within(table).queryByRole('meter')).not.toBeInTheDocument()
})

test('empty or absent limits show Sin cuotas', async () => {
  const page = open(entitlementsNoLimits)
  expect(await screen.findByRole('heading', { name: es.noLimits })).toBeVisible()
  expect(screen.getByText(es.noLimitsDescription)).toBeVisible()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  page.unmount()
  open({ tenantId: 'synthetic-tenant', planSlug: 'synthetic-pro' })
  expect(await screen.findByRole('heading', { name: es.noLimits })).toBeVisible()
  expect(screen.getByText(es.noCapabilities)).toBeVisible()
})

test('empty capabilities keep the plan, callout and limits rendered', async () => {
  open(entitlementsNoCapabilities)
  expect(await screen.findByText(es.noCapabilities)).toBeVisible()
  expect(screen.getByText('synthetic-pro')).toBeVisible()
  expect(screen.getByRole('table')).toBeVisible()
  expect(screen.getByText('1 dimensión está actualmente por encima del límite.')).toBeVisible()
  expect(screen.getAllByRole('tab')).toHaveLength(2)
})

test.each(['es', 'en'] as const)('Historial is an explicit empty state, sends no request and tabs move with arrow keys in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = copyFor(locale)
  open()
  await screen.findByRole('table')
  const summary = screen.getByRole('tab', { name: copy.tabSummary })
  summary.focus()
  fireEvent.keyDown(summary, { key: 'ArrowRight' })
  const history = screen.getByRole('tab', { name: copy.tabHistory })
  await waitFor(() => expect(history).toHaveAttribute('aria-selected', 'true'))
  expect(screen.getByRole('region', { name: copy.historyLabel })).toHaveTextContent(copy.historyEmptyTitle)
  expect(screen.getByText(copy.historyEmptyDescription)).toBeVisible()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(calls()).toHaveLength(1)
  expect(requests.mock.mock.calls).toHaveLength(1)
})

test.each([['superadmin', true], ['platform_admin', false], ['platform_operator', false]] as const)('tenantless %s makes no request; the catalog action is superadmin only', async (role, action) => {
  open(entitlementsMixed, [role], [])
  expect(await screen.findByRole('heading', { name: es.tenantlessTitle })).toBeVisible()
  expect(screen.getByText(action ? es.tenantlessDescriptionCatalog : es.tenantlessDescription)).toBeVisible()
  const button = screen.queryByRole('button', { name: es.openCatalog })
  if (!action) expect(button).not.toBeInTheDocument()
  else {
    fireEvent.click(button!)
    expect(await screen.findByRole('heading', { name: 'Plans destination' })).toBeVisible()
  }
  expect(requests.mock.mock.calls).toHaveLength(0)
})

test.each(['es', 'en'] as const)('403 shows the in-page no-access state; 404 returns to the overview in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = copyFor(locale)
  const page = open(() => fail(403))
  expect(await screen.findByRole('heading', { name: copy.noAccess })).toBeVisible()
  expect(screen.getByText(copy.noAccessDescription)).toBeVisible()
  expect(screen.queryByRole('button', { name: copy.retry })).not.toBeInTheDocument()
  expect(document.body).not.toHaveTextContent('PRIVATE_MARKER')
  page.unmount()
  open(() => fail(404))
  expect(await screen.findByRole('heading', { name: copy.notFound })).toBeVisible()
  const back = screen.getByRole('link', { name: copy.backToOverview })
  expect(back).toHaveAttribute('href', '/console/overview')
  expect(screen.queryByRole('button', { name: copy.retry })).not.toBeInTheDocument()
  fireEvent.click(back)
  expect(await screen.findByRole('heading', { name: 'Overview destination' })).toBeVisible()
})

test.each(['es', 'en'] as const)('500 shows the error panel with the request id; retry keeps focus and resends in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = copyFor(locale)
  let release!: () => void
  let count = 0
  open(async () => {
    count++
    if (count === 2) await new Promise<void>((resolve) => { release = resolve })
    return count < 3 ? fail(500, { requestId: 'req_synthetic_plan_500' }) : Response.json(entitlementsMixed)
  })
  const retry = await screen.findByRole('button', { name: copy.retry })
  expect(screen.getByRole('heading', { name: copy.errorTitle })).toBeVisible()
  expect(screen.getByText('req_synthetic_plan_500')).toBeVisible()
  expect(document.body).not.toHaveTextContent('PRIVATE_CORRELATION')
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  retry.focus(); fireEvent.click(retry)
  await screen.findByRole('button', { name: copy.retrying })
  await waitFor(() => expect(retry).toHaveFocus())
  fireEvent.click(retry)
  await waitFor(() => expect(release).toBeTypeOf('function'))
  expect(calls()).toHaveLength(2)
  await act(async () => release())
  await waitFor(() => expect(screen.getByRole('button', { name: copy.retry })).toHaveFocus())
  fireEvent.click(screen.getByRole('button', { name: copy.retry }))
  await screen.findByRole('table')
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
  expect(calls()).toHaveLength(3)
})

test('network rejection shows the error panel without a request id or stale data', async () => {
  open(() => { throw new TypeError('PRIVATE_MARKER') })
  expect(await screen.findByRole('button', { name: es.retry })).toBeVisible()
  expect(screen.getByRole('heading', { name: es.errorTitle })).toBeVisible()
  expect(screen.getByText(es.networkDescription)).toBeVisible()
  expect(screen.queryByText(es.requestId)).not.toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(document.body).not.toHaveTextContent('PRIVATE_MARKER')
})

test('loading shows skeletons before the summary', async () => {
  let release!: () => void
  open(async () => { await new Promise<void>((resolve) => { release = resolve }); return Response.json(entitlementsMixed) })
  expect(screen.getByRole('status', { name: es.loading })).toBeVisible()
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  await waitFor(() => expect(release).toBeTypeOf('function'))
  await act(async () => release())
  expect(await screen.findByRole('table')).toBeVisible()
})

test.each([false, true])('401 refresh rejected=%s uses the shared transport and login intent', async (rejected) => {
  login(['tenant_owner'], ['synthetic-tenant'])
  let count = 0
  requests = strictFetch({
    [`GET ${overviewUrl}`]: () => ++count === 1 ? fail(401) : Response.json(entitlementsMixed),
    [`POST ${refresh}`]: () => rejected ? fail(401) : Response.json(buildConsoleRefreshSessionFixture()),
  })
  render(<MemoryRouter initialEntries={['/console/my-plan']}><Routes>
    <Route path="/console/my-plan" element={<ProtectedRoute><PlanOverviewPage /></ProtectedRoute>} />
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
  }
  const refreshCalls = requests.mock.mock.calls.filter(([url]) => url === refresh)
  expect(refreshCalls).toHaveLength(1)
  expect(JSON.parse(String(refreshCalls[0][1]?.body))).toEqual({ refreshToken: 'synthetic-refresh-token' })
})
