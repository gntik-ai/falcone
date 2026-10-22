import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter, NavLink, useNavigate } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import ConsoleRuntimePage from '../src/pages/consoleRuntime'
import { ConsoleContextProvider } from '../src/shell/context'
import { App } from '../src/App'
import { login, renderWithSession, strictFetch, tenantUrl } from './shell-support'
import { ready as parityReady, runtimePath, runtimeFixtures } from './parity/pages/consoleRuntime.manifest'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-runtime-page.json'
import en from '../src/locales/en/pages.console-runtime-page.json'

// Keep the legacy unit fixture's version; parity fixtures deliberately use 1.15.
const ready = { ...parityReady, version: '1.22.1' }
let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const runtimeCalls = () => requests.mock.mock.calls.filter(([path]) => path === runtimePath)
function mock(response: unknown = ready) {
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] }, [`GET ${runtimePath}`]: response })
}
function open(role = 'platform_auditor', strict = false) {
  login([role])
  const page = <ConsoleContextProvider><ConsoleRuntimePage /></ConsoleContextProvider>
  return renderWithSession(strict ? <StrictMode>{page}</StrictMode> : page, { route: '/console/runtime' })
}
const settled = () => screen.findByText('platform')

test('ports legacy hierarchy, values, read-only links and the identical GET', async () => {
  mock(); open(); await settled()
  expect(screen.getByRole('heading', { name: es.title })).toBeVisible()
  expect(screen.getByText('1.22.1')).toBeVisible()
  expect(screen.getByRole('link', { name: es.inspectFunctions })).toHaveAttribute('href', '/console/functions')
  expect(screen.getByRole('link', { name: es.inspectHostedMcp })).toHaveAttribute('href', '/console')
  expect(Array.from(document.querySelectorAll('dt')).map((node) => node.textContent)).toEqual(Object.values(es.fields))
  expect(screen.getByLabelText('Estado del runtime: Listo')).toBeVisible()
  expect(runtimeCalls()).toHaveLength(1)
  expect(runtimeCalls()[0][1]).toMatchObject({ method: 'GET', body: undefined })
})

test.each(['superadmin', 'platform_admin', 'platform_operator', 'platform_auditor'])('observer %s loads once, rechecks once and switches tabs without fetching', async (role) => {
  mock(); open(role, true); await settled()
  expect(runtimeCalls()).toHaveLength(1)
  const check = screen.getByRole('button', { name: es.recheck })
  check.focus(); fireEvent.click(check)
  await waitFor(() => expect(check).not.toBeDisabled())
  expect(runtimeCalls()).toHaveLength(2)
  expect(check).toHaveFocus()
  fireEvent.click(screen.getByRole('tab', { name: es.history }))
  expect(screen.getByRole('list', { name: es.history }).children).toHaveLength(1)
  expect(screen.queryByText('Por')).not.toBeInTheDocument()
  expect(runtimeCalls()).toHaveLength(2)
})

test.each(['es', 'en'] as const)('all denial roles receive translated shell status and zero runtime calls in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  for (const role of ['member', 'tenant_admin', 'tenant_owner']) {
    mock(); const view = open(role)
    expect(await screen.findByRole('heading', { name: copy.denialTitle })).toBeVisible()
    expect(screen.getByText(copy.denialDescription)).toBeVisible()
    expect(runtimeCalls()).toHaveLength(0)
    view.unmount()
  }
})

test.each([
  ['knative-degraded', 'Degradado', 'Gestionado por la plataforma', 'warning'],
  ['knative-unverified', 'Sin verificar', 'Gestionado por la plataforma', 'neutral'],
  ['knative-disabled', 'Deshabilitado', 'Deshabilitado', 'neutral'],
  ['knative-unavailable-external', 'No disponible', 'Runtime externo', 'warning'],
  ['knative-unknown-values', 'Estado no disponible', 'Modo no verificado', 'neutral'],
] as const)('legacy labels, notes, dependency state and announcement: %s', async (variant, state, mode, tone) => {
  const fixture = runtimeFixtures[variant]
  mock(fixture.body); open()
  const tag = await screen.findByLabelText(`Estado del runtime: ${state}`)
  expect(tag.className).toContain(tone === 'neutral' ? 'bg-muted' : `bg-${tone}`)
  expect(screen.getAllByText(mode).length).toBeGreaterThan(0)
  expect(screen.getAllByText(`${state}. No hay acciones de mutación desde esta vista.`)).toHaveLength(2)
  const actionable = variant === 'knative-degraded' || variant === 'knative-unavailable-external'
  expect(Boolean(screen.queryByText(es.unavailableNote))).toBe(actionable)
  expect(Boolean(screen.queryByText(es.advisory))).toBe(actionable)
  expect(Boolean(screen.queryByText(es.disabledNote))).toBe(variant === 'knative-disabled')
  expect(Boolean(screen.queryByText(es.unverifiedNote))).toBe(variant === 'knative-unverified')
  expect(screen.queryByText('WEBHOOK_NOT_READY')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Editar|Desplegar|Habilitar|Deshabilitar/ })).not.toBeInTheDocument()
  if (variant === 'knative-unknown-values') {
    expect(screen.getByText(es.missingOwner)).toBeVisible()
    expect(screen.getByText(es.missingVersion)).toBeVisible()
  }
  const announced = variant === 'knative-unknown-values' ? 'disponible' : state
  await waitFor(() => expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(`Estado actualizado: ${announced}.`))
  fireEvent.click(screen.getByRole('tab', { name: es.history }))
  expect(within(screen.getByRole('list', { name: es.history })).getByText(state)).toBeVisible()
})

test('loading has the named skeleton and read-only note', async () => {
  let resolve!: (response: Response) => void
  const response = new Promise<Response>((done) => { resolve = done })
  mock(() => response)
  open()
  expect(screen.getByText(es.loading)).toBeInTheDocument()
  expect(screen.getByText(es.loadingNote)).toBeVisible()
  await act(async () => { resolve(Response.json(ready)) })
  await settled()
})

test('history is empty only without a transition, and sends no request', async () => {
  mock({ ...ready, lastTransitionAt: null }); open(); await settled()
  fireEvent.click(screen.getByRole('tab', { name: es.history }))
  expect(screen.getByRole('heading', { name: es.missingTransition })).toBeVisible()
  expect(screen.queryByRole('list')).not.toBeInTheDocument()
  expect(runtimeCalls()).toHaveLength(1)
})

test.each([403, 404])('endpoint %s shows back link and no request-access or retry action', async (status) => {
  mock(() => Response.json({ code: 'FAIL', message: 'secret internal message' }, { status }))
  open()
  expect(await screen.findByRole('heading', { name: status === 403 ? es.noAccess : es.notFound })).toBeVisible()
  expect(screen.getByRole('link', { name: es.back })).toHaveAttribute('href', '/console/overview')
  expect(screen.queryByRole('button', { name: /Solicitar|Reintentar/ })).not.toBeInTheDocument()
  expect(screen.queryByText('secret internal message')).not.toBeInTheDocument()
})

test('failed retry retains focus, recovery moves focus to recheck, and request id is preserved', async () => {
  let count = 0
  mock(() => ++count < 3 ? Response.json({ code: 'HTTP_500', message: 'never show this', requestId: 'synthetic-runtime-request' }, { status: 500 }) : Response.json(ready))
  open()
  const retry = await screen.findByRole('button', { name: es.retry })
  expect(screen.getByText('synthetic-runtime-request')).toBeVisible()
  retry.focus(); fireEvent.click(retry)
  await waitFor(() => expect(screen.getByRole('button', { name: es.retry })).toHaveFocus())
  await waitFor(() => expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(es.errorAnnouncement))
  fireEvent.click(retry)
  await settled()
  expect(screen.getByRole('button', { name: es.recheck })).toHaveFocus()
  expect(runtimeCalls()).toHaveLength(3)
  expect(screen.queryByText('never show this')).not.toBeInTheDocument()
})

test('network failure clears the previous status and offers retry', async () => {
  let count = 0
  mock(() => { if (++count === 1) return Response.json(ready); throw new TypeError('offline') })
  open(); await settled()
  fireEvent.click(screen.getByRole('button', { name: es.recheck }))
  expect(await screen.findByRole('button', { name: es.retry })).toBeVisible()
  expect(screen.queryByLabelText('Estado del runtime: Listo')).not.toBeInTheDocument()
  expect(screen.queryByText('platform')).not.toBeInTheDocument()
  expect(runtimeCalls()).toHaveLength(2)
})

test.each(['es', 'en'] as const)('document title and its restoration follow locale %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  mock(); const view = open(); await settled()
  expect(document.title).toBe(copy.documentTitle)
  fireEvent.click(screen.getByRole('tab', { name: copy.history }))
  const date = screen.getByRole('list', { name: copy.history }).querySelector('time')
  expect(date).toHaveAttribute('dateTime', new Date(ready.lastTransitionAt).toISOString())
  view.unmount()
  expect(document.title).toBe(copy.consoleTitle)
})

test.each(['rejected', 'refresh-ok', 'after-refresh'])('401 session flow: %s', async (variant) => {
  login(['platform_auditor'])
  let count = 0
  requests = strictFetch({
    [`GET ${tenantUrl}`]: { items: [] },
    [`GET ${runtimePath}`]: () => ++count === 2 && variant === 'refresh-ok' ? Response.json(ready) : Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': () => variant === 'rejected' ? Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }) : Response.json(buildConsoleRefreshSessionFixture()),
  })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/runtime']}><App /></MemoryRouter>)
  if (variant === 'refresh-ok') await settled()
  else {
    expect(await screen.findByRole('heading', { name: 'Acceso' })).toBeVisible()
    expect(readProtectedRouteIntent()).toBe('/next/console/runtime')
  }
  expect(screen.queryByRole('heading', { name: es.errorTitle })).not.toBeInTheDocument()
  expect(runtimeCalls()).toHaveLength(variant === 'rejected' ? 1 : 2)
  expect(requests.mock.mock.calls.filter(([path]) => String(path).endsWith('/refresh'))).toHaveLength(1)
})

function NavigationControls() {
  const navigate = useNavigate()
  return <><NavLink to="/console/runtime">Runtime link fixture</NavLink><button onClick={() => navigate('/console/runtime')}>Runtime navigate fixture</button><button onClick={() => navigate('/console/overview')}>Overview fixture</button></>
}
test('NavLink and navigate enter the lazy runtime page without losing the shell', async () => {
  login(['platform_auditor']); mock()
  render(<MemoryRouter initialEntries={['/console/overview']}><NavigationControls /><App /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Resumen' })
  fireEvent.click(screen.getByRole('link', { name: 'Runtime link fixture' }))
  await settled()
  expect(runtimeCalls()).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Overview fixture' }))
  await screen.findByRole('heading', { name: 'Resumen' })
  fireEvent.click(screen.getByRole('button', { name: 'Runtime navigate fixture' }))
  await settled()
  expect(runtimeCalls()).toHaveLength(2)
  expect(screen.getByRole('navigation', { name: 'Navegación de consola' })).toBeVisible()
})
