import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { LiveAnnouncer } from '@gntik-ai/ui'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import ConsolePlanCreatePage from '../src/pages/consolePlanCreate'
import { ConsoleContextProvider } from '../src/shell/context'
import { App } from '../src/App'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-plan-create-page.json'
import en from '../src/locales/en/pages.console-plan-create-page.json'
import { login, renderWithSession, strictFetch, tenantUrl } from './shell-support'

const path = '/v1/plans'
const refresh = '/v1/auth/login-sessions/synthetic-session/refresh'
const body = { slug: 'starter-2026', displayName: 'Starter', description: '  Optional text  ', capabilities: {}, quotaDimensions: {} }
let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const calls = () => requests.mock.mock.calls.filter(([url]) => url === path)
function mock(response: unknown = { id: 'p1' }) {
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] }, [`POST ${path}`]: response })
}
function open(role = 'superadmin') {
  login([role])
  return renderWithSession(<StrictMode><LiveAnnouncer><ConsoleContextProvider><ConsolePlanCreatePage /></ConsoleContextProvider></LiveAnnouncer></StrictMode>, { route: '/console/plans/new' })
}
async function fill(copy = es) {
  await screen.findByLabelText(copy.slug, { exact: true })
  fireEvent.change(screen.getByLabelText(copy.slug, { exact: true }), { target: { value: body.slug } })
  fireEvent.change(screen.getByLabelText(copy.displayName, { exact: true }), { target: { value: '  Starter  ' } })
  fireEvent.change(screen.getByLabelText(copy.description, { exact: true }), { target: { value: body.description } })
}
const submit = (copy = es) => fireEvent.click(screen.getByRole('button', { name: copy.create }))
const errorResponse = (status: number, extra = {}) => Response.json({ code: `HTTP_${status}`, message: 'PRIVATE_MARKER', detail: { marker: 'PRIVATE_MARKER' }, ...extra }, { status })

test.each(['es', 'en'] as const)('pristine fields, first-run focus and catalog links in %s without a page request', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  mock(); open()
  await screen.findByLabelText(copy.slug, { exact: true })
  expect(screen.getByRole('heading', { level: 1, name: copy.title })).toBeVisible()
  expect(screen.getByRole('heading', { name: copy.firstTitle })).toBeVisible()
  for (const key of ['stepSlug', 'stepName', 'stepDescription', 'stepLimits'] as const) expect(screen.getByText(copy[key])).toBeVisible()
  for (const label of [copy.slug, copy.displayName, copy.description]) expect(screen.getByLabelText(label, { exact: true })).toHaveValue('')
  expect(screen.getByRole('link', { name: copy.discard })).toHaveAttribute('href', '/console/plans')
  expect(screen.getByRole('link', { name: copy.catalog })).toHaveAttribute('href', '/console/plans')
  fireEvent.click(screen.getByRole('button', { name: copy.start }))
  expect(screen.getByLabelText(copy.slug, { exact: true })).toHaveFocus()
  expect(calls()).toHaveLength(0)
  expect(requests.mock).toHaveBeenCalledTimes(1)
  await fill(copy)
  expect(screen.queryByRole('heading', { name: copy.firstTitle })).not.toBeInTheDocument()
})

test.each([
  ['Bad Slug', 'Starter', true, false],
  ['starter-2026', '   ', false, true],
  ['', '', true, true],
  ['ab', 'Starter', true, false],
  ['a', 'Starter', false, false],
  ['a'.repeat(63), 'Starter', false, false],
  ['a'.repeat(64), 'Starter', true, false],
  ['starter-', 'Starter', true, false],
] as const)('legacy validation and focus for slug %s and name %s', async (slug, name, slugError, nameError) => {
  mock(); open()
  const slugField = await screen.findByLabelText(es.slug, { exact: true })
  const nameField = screen.getByLabelText(es.displayName, { exact: true })
  fireEvent.change(slugField, { target: { value: slug } })
  fireEvent.change(nameField, { target: { value: name } })
  submit()
  if (!slugError && !nameError) { await waitFor(() => expect(calls()).toHaveLength(1)); return }
  const summary = within(screen.getByTestId('validation-summary')).getByRole('region')
  expect(summary).toHaveTextContent(es.validationTitle)
  expect(within(summary).queryAllByText(new RegExp(es.invalidSlug))).toHaveLength(slugError ? 1 : 0)
  if (nameError && !slugError) expect(nameField).toHaveFocus()
  else expect(summary).toHaveFocus()
  expect(calls()).toHaveLength(0)
  for (const [field, invalid] of [[slugField, slugError], [nameField, nameError]] as const) {
    if (invalid) { expect(field).toHaveAttribute('aria-invalid', 'true'); expect(field).toHaveAttribute('aria-describedby') }
  }
  fireEvent.click(within(summary).getAllByRole('link')[0])
  expect(slugError ? slugField : nameField).toHaveFocus()
  nameField.focus()
  fireEvent.change(nameField, { target: { value: 'Starter' } })
  expect(nameField).toHaveFocus()
  expect(screen.queryByText(es.requiredName)).not.toBeInTheDocument()
  expect(nameField).not.toHaveAttribute('aria-invalid', 'true')
})

test.each(['tenant_owner', 'member', 'platform_admin', 'platform_auditor'])('superadmin guard denies %s without a POST', async (role) => {
  mock(); open(role)
  expect(await screen.findByText('403')).toBeVisible()
  expect(screen.queryByLabelText(es.slug, { exact: true })).not.toBeInTheDocument()
  expect(calls()).toHaveLength(0)
})

test('shell loading skeleton has a localized status and no page request', async () => {
  let release!: (response: Response) => void
  requests = strictFetch({ [`GET ${tenantUrl}`]: () => new Promise<Response>((resolve) => { release = resolve }) })
  open()
  const status = await screen.findByRole('status', { name: es.loading })
  expect(status).toHaveTextContent(es.loading)
  expect(screen.queryByLabelText(es.slug, { exact: true })).not.toBeInTheDocument()
  await act(async () => release(Response.json({ items: [] })))
  await screen.findByLabelText(es.slug, { exact: true })
  expect(calls()).toHaveLength(0)
})

test('saving disables submit, marks it busy and blocks repeated submits with the exact legacy body', async () => {
  let release!: (response: Response) => void
  mock(() => new Promise<Response>((resolve) => { release = resolve })); open(); await fill(); submit()
  await waitFor(() => expect(calls()).toHaveLength(1))
  const button = screen.getByRole('button', { name: es.saving })
  expect(button).toHaveAttribute('aria-disabled', 'true')
  expect(button).toHaveAttribute('aria-busy', 'true')
  fireEvent.submit(document.getElementById('plan-create-form')!)
  expect(calls()).toHaveLength(1)
  expect(JSON.parse(String(calls()[0][1]?.body))).toEqual(body)
  await act(async () => release(errorResponse(500)))
  await screen.findByRole('heading', { name: es.errorTitle })
})

test.each([500, 'network'] as const)('only explicit retry resends after %s, with the identical body and retained focus', async (kind) => {
  mock(() => { if (kind === 'network') throw new TypeError('PRIVATE_MARKER'); return errorResponse(500, { requestId: 'req_synthetic' }) })
  open(); await fill(); submit()
  await screen.findByRole('heading', { name: es.errorTitle })
  await waitFor(() => expect(screen.getByTestId('error-panel')).toHaveFocus())
  expect(screen.getByRole('button', { name: es.create })).toBeDisabled()
  if (kind === 'network') {
    expect(screen.getByText(es.outcomeUnknown)).toBeVisible()
    expect(screen.getByRole('link', { name: es.back })).toHaveAttribute('href', '/console/plans')
  }
  vi.useFakeTimers()
  try { await act(async () => { await vi.advanceTimersByTimeAsync(5000) }) }
  finally { vi.useRealTimers() }
  expect(calls()).toHaveLength(1)
  const retry = screen.getByRole('button', { name: es.retry })
  retry.focus(); fireEvent.click(retry)
  await waitFor(() => expect(calls()).toHaveLength(2))
  await waitFor(() => expect(retry).toHaveFocus())
  expect(JSON.parse(String(calls()[1][1]?.body))).toEqual(JSON.parse(String(calls()[0][1]?.body)))
  expect(document.body).not.toHaveTextContent('PRIVATE_MARKER')
  const description = screen.getByLabelText(es.description, { exact: true })
  fireEvent.change(description, { target: { value: 'Edited' } })
  expect(screen.getByRole('button', { name: es.create })).toBeEnabled()
  expect(screen.queryByRole('button', { name: es.retry })).not.toBeInTheDocument()
})

test.each([403, 404, 400, 409, 500])('maps %s without disclosing transport text and keeps values', async (status) => {
  mock(() => errorResponse(status, { requestId: 'req_synthetic' })); open(); await fill(); submit()
  await screen.findByTestId('error-panel')
  expect(screen.getByLabelText(es.slug, { exact: true })).toHaveValue(body.slug)
  expect(screen.getByLabelText(es.displayName, { exact: true })).toHaveValue('  Starter  ')
  expect(screen.getByLabelText(es.description, { exact: true })).toHaveValue(body.description)
  expect(document.body).not.toHaveTextContent('PRIVATE_MARKER')
  expect(screen.queryByText(es.success)).not.toBeInTheDocument()
  expect(calls()).toHaveLength(1)
  if (status === 403 || status === 404) {
    expect(screen.getByRole('heading', { name: status === 403 ? es.noAccess : es.notFound })).toBeVisible()
    expect(screen.getByRole('link', { name: es.back })).toHaveAttribute('href', '/console/plans')
    expect(screen.queryByRole('button', { name: es.retry })).not.toBeInTheDocument()
    if (status === 403) {
      expect(screen.getByLabelText(es.slug, { exact: true })).toHaveAttribute('readonly')
      fireEvent.change(screen.getByLabelText(es.slug, { exact: true }), { target: { value: 'other' } })
      expect(screen.getByLabelText(es.slug, { exact: true })).toHaveValue(body.slug)
      fireEvent.submit(document.getElementById('plan-create-form')!)
      expect(calls()).toHaveLength(1)
    }
  } else {
    expect(screen.getByText(status === 400 ? es.badRequest : status === 409 ? es.conflict : es.errorMessage)).toBeVisible()
    expect(screen.getByText('req_synthetic')).toBeVisible()
    fireEvent.click(screen.getByText(es.details))
    expect(await screen.findByText(`HTTP_${status}`)).toBeVisible()
    expect(document.body).not.toHaveTextContent('PRIVATE_MARKER')
  }
})

test('correlation ID is the request ID fallback and can be copied', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  mock(() => errorResponse(500, { correlationId: 'corr_synthetic' })); open(); await fill(); submit()
  expect(await screen.findByText('corr_synthetic')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: es.copyRequestId }))
  expect(writeText).toHaveBeenCalledWith('corr_synthetic')
})

function Location() { return <output data-testid="location">{useLocation().pathname}</output> }
test.each(['success', 'retry', '401-success', '401-rejected'])('real lazy route, basename, navigation and shared session flow: %s', async (variant) => {
  const initialSession = login()
  const refreshedSession = buildConsoleRefreshSessionFixture()
  refreshedSession.principal = initialSession.principal
  let count = 0
  requests = strictFetch({
    [`GET ${tenantUrl}`]: { items: [] },
    'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture(),
    [`POST ${path}`]: () => {
      count++
      if (variant.startsWith('401') && count === 1) return errorResponse(401)
      if (variant === 'retry' && count === 1) return errorResponse(500)
      return Response.json({ id: 'p1' })
    },
    [`POST ${refresh}`]: () => variant === '401-rejected' ? errorResponse(401) : Response.json(refreshedSession),
  })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/plans/new']}><Location /><App /></MemoryRouter>)
  await fill(); submit()
  if (variant === 'retry') fireEvent.click(await screen.findByRole('button', { name: es.retry }))
  const target = variant === '401-rejected' ? '/login' : '/console/plans/p1'
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(target), { timeout: 3000 })
  if (variant === '401-rejected') expect(readProtectedRouteIntent()).toBe('/next/console/plans/new')
  else await waitFor(() => expect(document.querySelector('[data-live-announcer="assertive"]')).toHaveTextContent(es.success))
  expect(calls()).toHaveLength(['retry', '401-success'].includes(variant) ? 2 : 1)
  for (const [, init] of calls()) expect(JSON.parse(String(init?.body))).toEqual(body)
  expect(requests.mock.mock.calls.filter(([url]) => url === refresh)).toHaveLength(variant.startsWith('401') ? 1 : 0)
})
