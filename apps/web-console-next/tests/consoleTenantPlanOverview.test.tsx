import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import PlanOverview from '../src/pages/consoleTenantPlanOverview'
import { App } from '../src/App'
import * as legacy from '../../web-console/src/services/planManagementApi'
import { getEffectiveEntitlements } from '../src/pages/consoleTenantPlanOverview/api'
import { ProtectedRoute } from '../src/shell/session'
import { Shell } from '../src/shell/Shell'
import { login, renderWithSession, strictFetch, tenantUrl } from './shell-support'
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { installSession } from './browser-session.mjs'
import { myPlanMixed, myPlanUrl } from './parity/pages/console-tenant-plan-overview-page.manifest'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-tenant-plan-overview-page.json'
import en from '../src/locales/en/pages.console-tenant-plan-overview-page.json'

let requests: ReturnType<typeof strictFetch>
const calls = () => requests.mock.mock.calls.filter(([url]) => url === myPlanUrl)
const fail = (status: number, extra = {}) => Response.json({ code: `HTTP_${status}`, message: 'PRIVATE_MARKER', correlationId: 'PRIVATE_CORRELATION', ...extra }, { status })
afterEach(() => {
  requests?.verify()
  for (const [, init] of calls()) { expect(init?.method).toBe('GET'); expect(init?.body).toBeUndefined() }
})
function open(response: unknown = myPlanMixed, role = 'tenant_owner', tenants = ['synthetic-tenant']) {
  login([role], tenants)
  requests = strictFetch({ [`GET ${myPlanUrl}`]: response })
  return renderWithSession(<PlanOverview />, { route: '/console/my-plan' })
}

test.each(['es', 'en'] as const)('renders every legacy field, usage state and accessible name with exactly one own-tenant request in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  open()
  const table = await screen.findByRole('table', { name: copy.tableTitle })
  expect(within(table).getAllByRole('columnheader')).toHaveLength(5)
  expect(within(table).getAllByRole('row')).toHaveLength(8)
  expect(screen.getByText('synthetic-growth')).toBeVisible()
  expect(screen.getByText(copy.planStatuses.active)).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent(locale === 'es' ? '1 dimensión está actualmente por encima del límite.' : '1 dimension is currently over the limit.')
  expect(within(table).getAllByText(copy.unlimited, { exact: true })).toHaveLength(2)
  expect(within(table).getAllByText(copy.noData)).toHaveLength(2)
  expect(within(table).getAllByRole('meter')).toHaveLength(4)
  expect(within(table).getByRole('meter', { name: copy.usageName.replace('{dimension}', 'Synthetic requests') })).toHaveAttribute('aria-valuetext', locale === 'es' ? '25 de 10, por encima del límite' : '25 of 10, over the limit')
  for (const row of myPlanMixed.quantitativeLimits!) expect(within(table).getByLabelText(copy.statusName.replace('{dimension}', row.displayLabel ?? row.dimensionKey).replace('{status}', copy.usage[row.usageStatus]), { exact: true })).toBeVisible()
  for (const capability of myPlanMixed.capabilities) {
    const name = copy.capabilityName.replace('{capability}', capability.displayLabel!).replace('{state}', capability.enabled ? copy.enabledName : copy.disabledName)
    expect(screen.getByLabelText(name)).toHaveTextContent(capability.enabled ? copy.enabled : copy.disabled)
  }
  expect(document.body).not.toHaveTextContent(/Monthly|Annual|Acme|PRIVATE_MARKER|synthetic-unavailable/)
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  expect(calls()).toHaveLength(1)
})

test.each(['es', 'en'] as const)('history switches by keyboard without requests and summary returns in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  open()
  await screen.findByRole('table')
  const tab = screen.getByRole('tab', { name: copy.tabSummary })
  tab.focus(); fireEvent.keyDown(tab, { key: 'ArrowRight' })
  await waitFor(() => expect(screen.getByRole('tab', { name: copy.tabHistory })).toHaveAttribute('aria-selected', 'true'))
  expect(screen.getByRole('heading', { name: copy.historyTitle })).toBeVisible()
  expect(screen.getByText(copy.historyDescription)).toBeVisible()
  const history = screen.getByRole('tab', { name: copy.tabHistory })
  fireEvent.keyDown(history, { key: 'ArrowLeft' })
  await screen.findByRole('table')
  expect(calls()).toHaveLength(1)
})

test.each([undefined, []])('absent or empty quotas preserve the plan and capabilities', async (quantitativeLimits) => {
  open({ ...myPlanMixed, quantitativeLimits })
  expect(await screen.findByRole('heading', { name: es.noLimits })).toBeVisible()
  expect(screen.getByText(es.noLimitsDescription)).toBeVisible()
  expect(screen.getByText('synthetic-growth')).toBeVisible()
  expect(screen.getByText('Synthetic realtime')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(calls()).toHaveLength(1)
})

test('empty capabilities preserve the plan, callout, quotas and tabs', async () => {
  open({ ...myPlanMixed, capabilities: [] })
  await screen.findByRole('table')
  expect(screen.getByText(es.noCapabilities)).toBeVisible()
  expect(screen.getByText('synthetic-growth')).toBeVisible()
  expect(screen.getByRole('alert')).toBeVisible()
  expect(screen.getAllByRole('tab')).toHaveLength(2)
  expect(calls()).toHaveLength(1)
})

test('absent plan has muted fallback and no status tag', async () => {
  open({ ...myPlanMixed, planSlug: undefined, planStatus: undefined })
  await screen.findByRole('table')
  expect(screen.getByText(es.noPlan)).toHaveClass('text-muted-foreground')
  expect(screen.queryByText(es.planStatuses.active)).not.toBeInTheDocument()
  expect(calls()).toHaveLength(1)
})

test.each([0, 1, 2])('over-limit callout counts %s dimensions', async (count) => {
  open({ ...myPlanMixed, quantitativeLimits: Array.from({ length: count }, (_, index) => ({ dimensionKey: `synthetic-${index}`, usageStatus: 'over_limit' })) })
  await screen.findByRole('tab', { name: es.tabSummary })
  if (count === 0) expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  else expect(screen.getByRole('alert')).toHaveTextContent(count === 1 ? '1 dimensión está actualmente por encima del límite.' : '2 dimensiones están actualmente por encima del límite.')
  expect(calls()).toHaveLength(1)
})

test('zero limit clamps the meter while preserving raw usage and accessible copy', async () => {
  open({ ...myPlanMixed, quantitativeLimits: [{ dimensionKey: 'synthetic-zero', effectiveValue: 0, currentUsage: 9, usageStatus: 'over_limit' }] })
  const meter = await screen.findByRole('meter')
  expect(meter).toHaveAttribute('aria-valuenow', '100')
  expect(meter).toHaveAttribute('aria-valuetext', '9 usado con límite cero')
  expect(screen.getByText('9 / 0')).toBeVisible()
  expect(calls()).toHaveLength(1)
})

test.each(['superadmin', 'platform_admin', 'platform_operator'])('tenantless %s issues no page read and only superadmin gets catalogue', async (role) => {
  open(myPlanMixed, role, [])
  expect(await screen.findByRole('heading', { name: es.tenantlessTitle })).toBeVisible()
  expect(screen.getByText(role === 'superadmin' ? es.tenantlessAdminDescription : es.tenantlessDescription)).toBeVisible()
  expect(screen.queryAllByRole('link', { name: es.catalogue })).toHaveLength(role === 'superadmin' ? 1 : 0)
  expect(calls()).toHaveLength(0)
})

test.each(['/', '/next'])('tenant viewer reaches the migrated router without a guard denial under %s', async (base) => {
  login(['tenant_viewer'], ['synthetic-tenant'])
  requests = strictFetch({ [`GET ${myPlanUrl}`]: myPlanMixed, [`GET ${tenantUrl}`]: { items: [] } })
  render(<MemoryRouter basename={base} initialEntries={[`${base === '/' ? '' : base}/console/my-plan`]}><App /></MemoryRouter>)
  await screen.findByRole('table', {}, { timeout: 5000 })
  expect(calls()).toHaveLength(1)
})

test('the new and legacy clients send identical method, query, headers and payload', async () => {
  login(['tenant_owner'], ['synthetic-tenant'])
  requests = strictFetch({ [`GET ${myPlanUrl}`]: myPlanMixed })
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')
  await legacy.getEffectiveEntitlements(undefined, { includeConsumption: true })
  await getEffectiveEntitlements()
  expect(calls()).toHaveLength(2)
  const normalize = ([url, init]: typeof requests.mock.mock.calls[number]) => ({ url, method: init?.method, body: init?.body, headers: [...new Headers(init?.headers).entries()] })
  expect(normalize(calls()[1])).toEqual(normalize(calls()[0]))
})

test('tenantless catalogue navigation focuses its destination heading', async () => {
  login(['superadmin'], [])
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  renderWithSession(<Routes><Route path="/console" element={<Shell />}>
    <Route path="my-plan" element={<PlanOverview />} />
    <Route path="plans" element={<h1>Catalogue destination</h1>} />
  </Route></Routes>, { route: '/console/my-plan' })
  const action = await screen.findByRole('link', { name: es.catalogue })
  action.focus(); fireEvent.click(action)
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Catalogue destination' })).toHaveFocus())
  expect(calls()).toHaveLength(0)
})

test('loading has separate skeletons for plan, quotas and capabilities', async () => {
  let release!: () => void
  open(async () => { await new Promise<void>((resolve) => { release = resolve }); return Response.json(myPlanMixed) })
  expect(screen.getByRole('status', { name: es.loading })).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByRole('status', { name: es.loading }).querySelectorAll('[aria-hidden="true"] [role="status"]')).toHaveLength(3)
  expect(screen.queryByText('synthetic-growth')).not.toBeInTheDocument()
  await waitFor(() => expect(release).toBeTypeOf('function'))
  await act(async () => release())
  await screen.findByRole('table')
  expect(calls()).toHaveLength(1)
})

test.each(['es', 'en'] as const)('403 denies access; 404 returns to overview in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  const page = open(() => fail(403))
  expect(await screen.findByRole('heading', { name: copy.noAccess })).toBeVisible()
  expect(screen.getByText(copy.noAccessDescription)).toBeVisible()
  expect(screen.queryByRole('button', { name: copy.retry })).not.toBeInTheDocument()
  expect(calls()).toHaveLength(1)
  page.unmount()
  open(() => fail(404))
  expect(await screen.findByRole('heading', { name: copy.notFound })).toBeVisible()
  expect(screen.getByText(copy.notFoundDescription)).toBeVisible()
  expect(screen.getByRole('link', { name: copy.back })).toHaveAttribute('href', '/console/overview')
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(calls()).toHaveLength(1)
})

test.each(['es', 'en'] as const)('500 retry is identical, retains pending focus and focuses heading on success in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  let release!: () => void
  let count = 0
  open(async () => {
    if (++count === 2) await new Promise<void>((resolve) => { release = resolve })
    return count < 3 ? fail(500, { requestId: 'req_synthetic_my_plan_500' }) : Response.json(myPlanMixed)
  })
  const retry = await screen.findByRole('button', { name: copy.retry })
  expect(screen.getByText('req_synthetic_my_plan_500')).toBeVisible()
  expect(document.body).not.toHaveTextContent(/PRIVATE_MARKER|PRIVATE_CORRELATION|synthetic-growth/)
  retry.focus(); fireEvent.click(retry)
  expect(await screen.findByRole('button', { name: copy.retrying })).toBe(retry)
  await waitFor(() => expect(retry).toHaveFocus())
  fireEvent.click(retry)
  await waitFor(() => expect(release).toBeTypeOf('function'))
  expect(calls()).toHaveLength(2)
  await act(async () => release())
  await waitFor(() => expect(screen.getByRole('button', { name: copy.retry })).toHaveFocus())
  fireEvent.click(retry)
  await screen.findByRole('table')
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
  expect(calls()).toHaveLength(3)
})

test('network failure shows translated retry without stale data or private exception copy', async () => {
  open(() => { throw new TypeError('PRIVATE_MARKER') })
  await screen.findByRole('button', { name: es.retry })
  expect(screen.getByText(es.networkDescription)).toBeVisible()
  expect(screen.queryByText('synthetic-growth')).not.toBeInTheDocument()
  expect(screen.queryByText(es.requestId)).not.toBeInTheDocument()
  expect(document.body).not.toHaveTextContent('PRIVATE_MARKER')
  expect(calls()).toHaveLength(1)
})

function Location() { return <output aria-label="Location">{useLocation().pathname}</output> }
test.each([false, true])('401 uses one shared refresh; rejected=%s preserves route intent', async (rejected) => {
  login(['tenant_owner'], ['synthetic-tenant'])
  let count = 0
  const refresh = '/v1/auth/login-sessions/synthetic-session/refresh'
  requests = strictFetch({
    [`GET ${myPlanUrl}`]: () => ++count === 1 ? fail(401) : Response.json(myPlanMixed),
    [`POST ${refresh}`]: () => rejected ? fail(401) : Response.json(buildConsoleRefreshSessionFixture()),
  })
  render(<MemoryRouter initialEntries={['/console/my-plan']}><Routes>
    <Route path="/console/my-plan" element={<ProtectedRoute><PlanOverview /></ProtectedRoute>} />
    <Route path="/login" element={<Location />} />
  </Routes></MemoryRouter>)
  if (rejected) {
    await waitFor(() => expect(readProtectedRouteIntent()).toBe('/console/my-plan'))
    expect(screen.getByLabelText('Location')).toHaveTextContent('/login')
    expect(calls()).toHaveLength(1)
  } else {
    await screen.findByRole('table')
    expect(calls()).toHaveLength(2)
    expect(new Headers(calls()[1][1]?.headers).get('Authorization')).toBe('Bearer synthetic-refreshed-access-token')
  }
  const refreshCalls = requests.mock.mock.calls.filter(([url]) => url === refresh)
  expect(refreshCalls).toHaveLength(1)
  expect(JSON.parse(String(refreshCalls[0][1]?.body))).toEqual({ refreshToken: 'synthetic-refresh-token' })
})

test('CSP helper accepts only the exact GET consumption query and rejects all variants', async () => {
  requests = strictFetch({})
  let handle!: (route: unknown) => Promise<void>
  const unmatched = await installSession({ addInitScript: vi.fn(), route: vi.fn((_pattern, callback) => { handle = callback }) })
  const invalid = [myPlanUrl + '&extra=1', myPlanUrl + '&include=consumption', '/v1/tenant/plan/effective-entitlements', '/v1/tenant/plan/effective-entitlements?include=other', '/v1/tenants/synthetic-tenant/plan/effective-entitlements?include=consumption', '/v1/tenant/plan/allocation-summary?extra=1']
  for (const [method, path] of [['GET', myPlanUrl], ...invalid.map((path) => ['GET', path]), ['POST', myPlanUrl]]) {
    const route = { request: () => ({ method: () => method, url: () => `http://localhost${path}`, postDataJSON: () => undefined }), fulfill: vi.fn(), abort: vi.fn() }
    await handle(route)
    const accepted = method === 'GET' && path === myPlanUrl
    expect(route.fulfill).toHaveBeenCalledTimes(accepted ? 1 : 0)
    expect(route.abort).toHaveBeenCalledTimes(accepted ? 0 : 1)
  }
  expect(unmatched).toEqual([...invalid.map((path) => `GET ${path}`), `POST ${myPlanUrl}`])
})
