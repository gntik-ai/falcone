import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import ConsolePlanCatalogPage from '../src/pages/consolePlanCatalog'
import { ConsoleContextProvider } from '../src/shell/context'
import { App } from '../src/App'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-plan-catalog-page.json'
import en from '../src/locales/en/pages.console-plan-catalog-page.json'
import { catalogPlans, catalogResponse, isPlansQuery } from './parity/pages/console-plan-catalog-page.manifest'
import { listPlans } from '../src/pages/consolePlanCatalog/api'
import { login, renderWithSession, strictFetch, tenantUrl } from './shell-support'
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { installSession } from './browser-session.mjs'

const initial = '/v1/plans?page=1&pageSize=20'
const url = (status = 'all', page = 1, pageSize = 20) => `/v1/plans?${status === 'all' ? '' : `status=${status}&`}page=${page}&pageSize=${pageSize}`
let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const calls = () => requests.mock.mock.calls.filter(([path]) => String(path).startsWith('/v1/plans'))
function setup(variant = '45-mixed', extra: Record<string, unknown> = {}) {
  const queries = ['all', 'draft', 'active', 'deprecated', 'archived'].flatMap((status) => [1, 2, 3].flatMap((page) => [20, 50, 100].map((size) => url(status, page, size))))
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] }, ...Object.fromEntries(queries.map((path) => [`GET ${path}`, () => {
    const response = catalogResponse(variant, new URL(path, 'http://localhost'))
    if (response.network) throw new TypeError('Synthetic network failure')
    return Response.json(response.body, { status: response.status })
  }])), ...extra })
}
function open(role = 'superadmin') {
  login([role])
  return renderWithSession(<ConsoleContextProvider><ConsolePlanCatalogPage /></ConsoleContextProvider>, { route: '/console/plans' })
}
const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
async function ready() { await screen.findByRole('link', { name: 'synthetic-plan-1' }) }
async function select(label: string, option: string) {
  const trigger = screen.getByRole('combobox', { name: label })
  trigger.focus(); fireEvent.click(trigger)
  const item = await screen.findByRole('option', { name: option })
  fireEvent.pointerDown(item); fireEvent.click(item)
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return trigger
}

test.each(['es', 'en'] as const)('renders localized rows, plural count, footer and missing values in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  setup(); open(); await ready()
  expect(calls().map(([path]) => path)).toEqual([initial])
  expect(rows()).toHaveLength(20)
  expect(screen.getByRole('heading', { level: 1, name: copy.title })).toBeVisible()
  expect(screen.getByRole('link', { name: i18n.t('openPlan', { ns: 'pages.console-plan-catalog-page', name: 'Synthetic Plan 1' }) })).toHaveAttribute('href', '/console/plans/synthetic-plan-1')
  expect(within(rows()[0]).getAllByRole('cell')[3]).toHaveTextContent('0')
  expect(within(rows()[0]).getAllByRole('cell')[4]).toHaveTextContent('—')
  expect(rows()[1].querySelector('time')).toHaveAttribute('datetime', '2026-06-01T12:00:00.000Z')
  expect(screen.getByText(locale === 'es' ? '45 planes' : '45 plans')).toHaveAttribute('aria-live', 'polite')
  expect(screen.getByText(locale === 'es' ? '1-20 de 45 · 3 páginas' : '1-20 of 45 · 3 pages')).toBeVisible()
  expect(screen.getByRole('combobox', { name: copy.filter })).toBeVisible()
})

test.each(['es', 'en'] as const)('uses the singular count for one plan in %s', async (locale) => {
  await i18n.changeLanguage(locale); setup('single'); open(); await ready()
  expect(screen.getByText('1 plan')).toHaveAttribute('aria-live', 'polite')
  expect(rows()).toHaveLength(1)
})

test('pages on the server, resets filter and page size, omits all, and retains control focus', async () => {
  setup(); open(); await ready()
  const next = screen.getByRole('button', { name: es.next }); next.focus(); fireEvent.click(next)
  await screen.findByRole('link', { name: 'synthetic-plan-21' })
  expect(calls().at(-1)?.[0]).toBe(url('all', 2))
  expect(next).toHaveFocus()
  fireEvent.click(next); await screen.findByRole('link', { name: 'synthetic-plan-41' })
  expect(screen.getByRole('button', { name: 'Página 3' })).toHaveFocus()
  const filter = await select(es.filter, es.status.active)
  await screen.findByRole('link', { name: 'synthetic-plan-2' })
  expect(calls().at(-1)?.[0]).toBe(url('active'))
  expect(filter).toHaveFocus()
  await select(es.filter, es.status.all); await ready()
  expect(calls().at(-1)?.[0]).toBe(initial)
  fireEvent.click(screen.getByRole('button', { name: 'Página 2' })); await screen.findByRole('link', { name: 'synthetic-plan-21' })
  await select(es.rowsPerPage, '50'); await ready()
  expect(calls().at(-1)?.[0]).toBe(url('all', 1, 50)); expect(rows()).toHaveLength(45)
  await select(es.rowsPerPage, '100'); await ready()
  expect(calls().at(-1)?.[0]).toBe(url('all', 1, 100))
  for (const [, init] of calls()) { expect(init?.method).toBe('GET'); expect(init?.body).toBeUndefined() }
})

test('keeps filtered empty results recoverable and returns focus to the filter', async () => {
  setup('45-mixed', { [`GET ${url('archived')}`]: { items: [], total: 0, page: 1, pageSize: 20 } })
  open(); await ready(); await select(es.filter, es.status.archived)
  expect(await screen.findByRole('heading', { name: 'No hay planes con estado Archivado' })).toBeVisible()
  expect(screen.getAllByRole('button', { name: es.create }).at(-1)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: es.clear })); await ready()
  expect(calls().at(-1)?.[0]).toBe(initial)
  expect(screen.getByRole('combobox', { name: es.filter })).toHaveFocus()
})

test('returns focus to page one when Previous becomes disabled', async () => {
  setup(); open(); await ready()
  fireEvent.click(screen.getByRole('button', { name: 'Página 2' }))
  await screen.findByRole('link', { name: 'synthetic-plan-21' })
  const previous = screen.getByRole('button', { name: es.previous })
  previous.focus(); fireEvent.click(previous); await ready()
  expect(previous).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Página 1' })).toHaveFocus()
})

test('renders the first-run empty state with the create action', async () => {
  setup('empty'); open()
  expect(await screen.findByRole('heading', { name: es.empty })).toBeVisible()
  expect(screen.getByText(es.emptyDescription)).toBeVisible()
  expect(screen.getAllByRole('button', { name: es.create }).at(-1)).toBeVisible()
})

test.each(['403', '404', '500', 'network'])('renders safe in-page %s feedback without stale rows', async (variant) => {
  setup(variant); open()
  const title = variant === '403' ? es.noAccess : variant === '404' ? es.notFound : es.errorTitle
  expect(await screen.findByRole('heading', { name: title })).toBeVisible()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  if (variant === '500') expect(screen.getByText('req_synthetic_catalog_500')).toBeVisible()
  if (variant === '404') expect(screen.getByRole('link', { name: es.overview })).toHaveAttribute('href', '/console/overview')
  expect(screen.queryByRole('button', { name: es.retry }) !== null).toBe(['500', 'network'].includes(variant))
  expect(screen.queryByText('Request access')).not.toBeInTheDocument()
})

test('labels the skeleton, discards old rows, retries the exact current query and focuses the recovered caption', async () => {
  let release!: (response: Response) => void
  let count = 0
  setup('45-mixed', { [`GET ${url('active', 1, 50)}`]: () => {
    if (++count === 1) return new Promise<Response>((resolve) => { release = resolve })
    return Response.json(catalogResponse('active-only', new URL(url('active', 1, 50), 'http://localhost')).body)
  } })
  open(); await ready(); await select(es.filter, es.status.active)
  await screen.findByRole('link', { name: 'synthetic-plan-2' })
  await select(es.rowsPerPage, '50')
  expect(screen.getByRole('status', { name: es.loading })).toBeVisible()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  await act(async () => release(Response.json({ code: 'HTTP_500', requestId: 'req_synthetic' }, { status: 500 })))
  fireEvent.click(await screen.findByRole('button', { name: es.retry }))
  await screen.findByRole('link', { name: 'synthetic-plan-2' })
  expect(calls().slice(-2).map(([path]) => path)).toEqual([url('active', 1, 50), url('active', 1, 50)])
  expect(document.querySelector('caption')).toHaveFocus()
})

test('ignores late responses after a filter changes', async () => {
  let release!: (response: Response) => void
  setup('45-mixed', { [`GET ${initial}`]: () => new Promise<Response>((resolve) => { release = resolve }) })
  open(); await screen.findByRole('status', { name: es.loading })
  await select(es.filter, es.status.active); await screen.findByRole('link', { name: 'synthetic-plan-2' })
  await act(async () => release(Response.json(catalogResponse('45-mixed').body)))
  expect(screen.queryByRole('link', { name: 'synthetic-plan-1' })).not.toBeInTheDocument()
})

test('retains legacy plans-envelope normalization and metadata defaults through the shared transport', async () => {
  login(); setup('45-mixed', { [`GET ${initial}`]: { plans: catalogPlans.slice(0, 1) } })
  expect(await listPlans({ status: 'all', page: 1, pageSize: 20 })).toEqual({ items: catalogPlans.slice(0, 1), total: 1, page: 1, pageSize: 20 })
})

test.each(['tenant_owner', 'platform_auditor', 'member'])('denies %s before any list request', async (role) => {
  setup(); login([role])
  render(<MemoryRouter initialEntries={['/console/plans']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Acceso denegado' })).toBeVisible()
  expect(calls()).toHaveLength(0)
})

test.each(['slug', 'open', 'create'])('navigates with the %s action', async (action) => {
  setup(); login()
  renderWithSession(<ConsoleContextProvider><Routes><Route path="/console/plans" element={<ConsolePlanCatalogPage />} /><Route path="/console/plans/:planId" element={<h1>Opened plan</h1>} /><Route path="/console/plans/new" element={<h1>New plan</h1>} /></Routes></ConsoleContextProvider>, { route: '/console/plans' })
  await ready()
  if (action === 'create') fireEvent.click(screen.getAllByRole('button', { name: es.create })[0])
  else fireEvent.click(screen.getByRole('link', { name: action === 'slug' ? 'synthetic-plan-1' : 'Abrir plan Synthetic Plan 1' }))
  expect(await screen.findByRole('heading', { name: action === 'create' ? 'New plan' : 'Opened plan' })).toBeVisible()
})

test.each([false, true])('refreshes once after a 401 and redirects on persistent rejection: %s', async (reject) => {
  const initialSession = login()
  const fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initialSession.principal
  let count = 0
  setup('45-mixed', {
    [`GET ${initial}`]: () => ++count === 1 || reject ? Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }) : Response.json(catalogResponse('single').body),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': () => Response.json(fresh),
    'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture(),
  })
  render(<MemoryRouter initialEntries={['/console/plans']}><App /></MemoryRouter>)
  if (reject) {
    expect(await screen.findByRole('heading', { name: 'Accede a In Falcone Console' })).toBeVisible()
    expect(readProtectedRouteIntent()).toBe('/console/plans')
  } else await ready()
  expect(calls()).toHaveLength(2)
  expect(requests.mock.mock.calls.filter(([path]) => String(path).endsWith('/refresh'))).toHaveLength(1)
})

test('CSP harness accepts only the catalog GET query keys and preserves strict query rejection elsewhere', async () => {
  let handle!: (route: unknown) => Promise<void>
  const unmatched = await installSession({ addInitScript: vi.fn(), route: vi.fn((_pattern, callback) => { handle = callback }) })
  const valid = [initial, url('active'), url('all', 2), url('all', 1, 50)]
  const invalid = ['/v1/plans', '/v1/plans?page=1&pageSize=20&foo=1', '/v1/platform/runtime/knative?page=1', '/v1/plans?page=1', '/v1/plans?pageSize=20', '/v1/plans/?page=1&pageSize=20']
  for (const [method, path] of [...valid.map((path) => ['GET', path]), ...invalid.map((path) => ['GET', path]), ['POST', initial]]) {
    const route = { request: () => ({ method: () => method, url: () => `http://localhost${path}`, postDataJSON: () => undefined }), fulfill: vi.fn(), abort: vi.fn() }
    await handle(route)
    const accepted = method === 'GET' && valid.includes(path)
    expect(isPlansQuery(method, new URL(path, 'http://localhost'))).toBe(accepted)
    expect(route.fulfill).toHaveBeenCalledTimes(accepted ? 1 : 0)
    expect(route.abort).toHaveBeenCalledTimes(accepted ? 0 : 1)
  }
  expect(unmatched).toEqual([...invalid.map((path) => `GET ${path}`), `POST ${initial}`])
})
