import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { buildConsoleLoginSessionFixture, buildConsoleSignupPolicyFixture } from '@in-falcone/console-api/fixtures'
import { persistConsoleShellSession, readConsoleShellSession, storeProtectedRouteIntent } from '@in-falcone/console-api/session'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import LoginPage from '../src/pages/login'
import RecoveryPage from '../src/pages/recovery'
import { App } from '../src/App'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.login-page.json'
import en from '../src/locales/en/pages.login-page.json'
import welcomeManifest from './parity/pages/welcome.manifest'
import { createEndpointRegistry } from './parity/endpoint-registry'
import { endpoints, responseFor } from './parity/fixtures/shell'
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { installSession } from './browser-session.mjs'

const policyPath = '/v1/auth/signups/policy'
const loginPath = '/v1/auth/login-sessions'
const statusPath = '/v1/auth/status-views/pending_activation'
const refreshPath = '/v1/auth/login-sessions/synthetic-session/refresh'
const fetchMock = vi.fn<typeof fetch>()
const policy = () => ({ ...buildConsoleSignupPolicyFixture(), selfServiceEnabled: true })
const session = () => buildConsoleLoginSessionFixture()
const statusView = { statusView: 'pending_activation', title: 'RAW_SERVER_TITLE', message: 'RAW_SERVER_MESSAGE', allowedActions: [] }
const response = (status: number, body: unknown) => Response.json(body, { status })
const failure = (status: number, requestId?: string) => response(status, { status, code: status === 409 ? 'PENDING_ACTIVATION' : `HTTP_${status}`, detail: status === 409 ? { statusView: 'pending_activation' } : undefined, requestId, message: 'RAW_SERVER_MESSAGE' })
type Handler = () => Response | Promise<Response>
function install(routes: Record<string, Handler> = {}) {
  fetchMock.mockImplementation(async (path) => {
    const handler = routes[String(path)]
    if (handler) return handler()
    if (path === policyPath) return response(200, policy())
    throw new Error(`Unmatched request ${path}`)
  })
  vi.stubGlobal('fetch', fetchMock)
}
function open(entry = '/login', basename = '/', app = false) {
  const router = createMemoryRouter([
    { path: '/login', element: app ? <App /> : <LoginPage /> },
    { path: '/password-recovery', element: <RecoveryPage /> },
    { path: '/console/*', element: <h1>Protected destination</h1> },
  ], { basename, initialEntries: [entry] })
  const page = render(<StrictMode><RouterProvider router={router} /></StrictMode>)
  return { ...page, router }
}
async function ready(copy = es) { return screen.findByRole('link', { name: copy.labels.signup }) }
function fill(copy = es, secret = 'Abcd1234') {
  fireEvent.change(screen.getByLabelText(copy.labels.username), { target: { value: '  operations  ' } })
  fireEvent.change(screen.getByLabelText(copy.labels.password, { selector: 'input' }), { target: { value: secret } })
}
function submit(copy = es) { fireEvent.click(screen.getByRole('button', { name: copy.labels.submit })) }
const calls = (path: string) => fetchMock.mock.calls.filter(([url]) => url === path)
function assertRequest(path: string, method: string, body?: unknown, count = 1) {
  expect(calls(path)).toHaveLength(count)
  for (const [, init] of calls(path)) {
    expect(init?.method).toBe(method)
    expect(init?.body === undefined ? undefined : JSON.parse(String(init.body))).toEqual(body)
    expect(new Headers(init?.headers).get('Authorization')).toBeNull()
  }
}
beforeEach(() => { install(); vi.stubGlobal('PointerEvent', MouseEvent) })
afterEach(() => { fetchMock.mockReset(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

test('welcome destinations share the login policy fixture without endpoint collisions', () => {
  const registry = createEndpointRegistry(endpoints,
    (name, variant, role) => responseFor(name, variant as Parameters<typeof responseFor>[1], role), welcomeManifest.endpoints)
  expect(registry.find('GET', policyPath)).toBe('signupPolicy')
  expect(registry.responseFor('signupPolicy', 'tenant_owner')).toEqual({ status: 200, body: buildConsoleSignupPolicyFixture() })
})

test('CSP sessions serve the public login policy and reject other methods, paths and queries', async () => {
  const page = { addInitScript: vi.fn(), route: vi.fn() }
  const unmatched = await installSession(page)
  const handle = page.route.mock.calls[0][1]
  for (const [method, path] of [
    ['GET', policyPath], ['POST', policyPath], ['GET', `${policyPath}/unexpected`], ['GET', `${policyPath}?unexpected=true`],
  ]) {
    const route = {
      request: () => ({ url: () => `http://localhost${path}`, method: () => method, postDataJSON: () => undefined }),
      fulfill: vi.fn(), abort: vi.fn(),
    }
    await handle(route)
    if (method === 'GET' && path === policyPath) {
      expect(route.fulfill).toHaveBeenCalledExactlyOnceWith({ status: 200, json: buildConsoleSignupPolicyFixture() })
      expect(route.abort).not.toHaveBeenCalled()
      expect(unmatched).toEqual([])
    } else {
      expect(route.fulfill).not.toHaveBeenCalled()
      expect(route.abort).toHaveBeenCalledExactlyOnceWith()
    }
  }
  expect(unmatched).toEqual([`POST ${policyPath}`, `GET ${policyPath}/unexpected`, `GET ${policyPath}?unexpected=true`])
})

for (const locale of ['es', 'en'] as const) describe(`login legacy cases in ${locale}`, () => {
  const copy = locale === 'es' ? es : en
  beforeEach(async () => { await i18n.changeLanguage(locale) })
  test('renders the form, secondary actions and session protection', async () => {
    open(); await ready(copy)
    expect(screen.getByRole('heading', { level: 1, name: copy.title })).toBeVisible()
    expect(screen.getByLabelText(copy.labels.username)).toHaveFocus()
    expect(screen.getByRole('checkbox', { name: copy.labels.rememberMe })).toBeVisible()
    expect(screen.getByText(copy.sessionProtection)).toBeVisible()
    expect(screen.getByRole('link', { name: copy.labels.passwordRecovery })).toHaveAttribute('href', '/password-recovery')
  })
  test('owns the auth frame, single main and logo, and document title', async () => {
    render(<StrictMode><MemoryRouter initialEntries={['/login']}><App /></MemoryRouter></StrictMode>); await ready(copy)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('img', { name: copy.logo })).toHaveLength(1)
    expect(document.title).toBe(copy.documentTitle)
  })
  test('does not render scaffolding or kit sample data', async () => {
    open(); await ready(copy)
    expect(document.body.textContent).not.toMatch(/EP-\d+|US-UI|\/v1\/|Realm|Client ID|Acme|req_8f2c41d07a9b|SSO|Google|GitHub/)
  })
  test('navigates to the existing recovery route without a document load', async () => {
    const { router } = open(); await ready(copy)
    fireEvent.click(screen.getByRole('link', { name: copy.labels.passwordRecovery }))
    expect(await screen.findByRole('heading', { name: locale === 'es' ? 'Recupera el acceso a In Falcone Console' : 'Recover access to In Falcone Console' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/password-recovery')
  })
  test('preserves organization and workspace in enabled signup', async () => {
    open('/login?tenant=tenant_example&workspaceId=workspace_example'); await ready(copy)
    expect(screen.getByRole('link', { name: copy.labels.signup })).toHaveAttribute('href', '/signup?tenantId=tenant_example&workspaceId=workspace_example')
    expect(screen.getByText(copy.contextBoth.replace('{tenantId}', 'tenant_example').replace('{workspaceId}', 'workspace_example'))).toBeVisible()
  })
  test.each(['invitation', 'self_service'])('renders disabled %s signup without any action', async (mode) => {
    install({ [policyPath]: () => response(200, { ...policy(), selfServiceEnabled: false, mode, message: 'RAW_SERVER_POLICY' }) })
    open()
    expect(await screen.findByText(copy.signupDisabledTitle)).toBeVisible()
    expect(screen.getByText(mode === 'invitation' ? copy.invitationOnly : copy.labels.signupDisabled)).toBeVisible()
    const aside = within(screen.getByRole('region', { name: copy.asideTitle }))
    expect(aside.queryAllByRole('button', { hidden: true })).toHaveLength(0)
    expect(aside.queryAllByRole('link', { hidden: true })).toHaveLength(0)
    expect(screen.getByRole('button', { name: copy.labels.submit })).toBeEnabled()
    expect(screen.queryByRole('link', { name: copy.labels.signup })).toBeNull()
    expect(screen.queryByText('RAW_SERVER_POLICY')).toBeNull()
  })
  test('submits trimmed credentials, rememberMe and restores the stored protected destination', async () => {
    install({ [loginPath]: () => response(200, session()) })
    storeProtectedRouteIntent('/console/settings?x=1#h')
    const { router } = open(); await ready(copy); fill(copy)
    fireEvent.click(screen.getByRole('checkbox', { name: copy.labels.rememberMe })); submit(copy)
    await screen.findByText('Protected destination')
    expect(router.state.location).toMatchObject({ pathname: '/console/settings', search: '?x=1', hash: '#h' })
    assertRequest(loginPath, 'POST', { username: 'operations', password: 'Abcd1234', rememberMe: true })
    expect(readConsoleShellSession()?.sessionId).toBe(session().sessionId)
  })
  test('sends and persists tenant context from the query', async () => {
    install({ [loginPath]: () => response(200, session()) })
    open('/login?tenantId=tenant_example'); await ready(copy); fill(copy); submit(copy)
    await screen.findByText('Protected destination')
    assertRequest(loginPath, 'POST', { username: 'operations', password: 'Abcd1234', rememberMe: false, tenantId: 'tenant_example' })
    expect(readConsoleShellSession()?.tenantId).toBe('tenant_example')
  })
  test('defaults read-only sessions to observability', async () => {
    const value = session(); value.principal!.platformRoles = ['tenant_viewer']
    install({ [loginPath]: () => response(200, value) })
    const { router } = open(); await ready(copy); fill(copy); submit(copy)
    await screen.findByText('Protected destination')
    expect(router.state.location.pathname).toBe('/console/observability')
  })
  test('defaults operator sessions to overview', async () => {
    install({ [loginPath]: () => response(200, session()) })
    const { router } = open(); await ready(copy); fill(copy); submit(copy)
    await screen.findByText('Protected destination')
    expect(router.state.location.pathname).toBe('/console/overview')
  })
  test('shows namespace credential feedback on 401 with invalid fields and password focus', async () => {
    install({ [loginPath]: () => failure(401) }); open(); await ready(copy); fill(copy); submit(copy)
    await waitFor(() => expect(within(screen.getByRole('alert')).getByText(copy.credentialTitle)).toBeVisible())
    for (const label of [copy.labels.username, copy.labels.password]) {
      expect(screen.getByLabelText(label, { selector: 'input' })).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByLabelText(label, { selector: 'input' })).toHaveAttribute('aria-describedby', expect.stringContaining('login-feedback'))
    }
    expect(screen.getByLabelText(copy.labels.password, { selector: 'input' })).toHaveFocus()
    expect(screen.getByText(copy.credentialMessage)).toBeVisible()
    expect(screen.getByText('RAW_SERVER_MESSAGE')).not.toBeVisible()
    expect(document.getElementById('login-feedback')).not.toHaveTextContent('RAW_SERVER_MESSAGE')
  })
  test('keeps operational 503 separate from credential feedback', async () => {
    install({ [loginPath]: () => failure(503) }); open(); await ready(copy); fill(copy); submit(copy)
    expect(await screen.findByRole('heading', { name: copy.loginErrorTitle })).toBeVisible()
    expect(screen.queryByText(copy.credentialTitle)).toBeNull()
  })
  test('consumes and translates the stored auth hint', async () => {
    sessionStorage.setItem('in-falcone.console-auth-status-hint', JSON.stringify({ statusView: 'login', title: 'RAW_HINT', message: 'RAW_HINT_MESSAGE' }))
    open(); await ready(copy)
    expect(screen.getByText(copy.expiredHintTitle)).toBeVisible()
    expect(screen.getByText(copy.expiredHintMessage)).toBeVisible()
    expect(sessionStorage.getItem('in-falcone.console-auth-status-hint')).toBeNull()
  })
  test('redirects an existing usable session without login', async () => {
    persistConsoleShellSession(session()); const { router } = open()
    await screen.findByText('Protected destination')
    expect(router.state.location.pathname).toBe('/console/overview')
    expect(calls(loginPath)).toHaveLength(0)
  })
  test('does not impose a password minimum exceeding the server policy', async () => {
    open(); await ready(copy)
    expect(screen.getByLabelText(copy.labels.password, { selector: 'input' })).not.toHaveAttribute('minlength')
    expect(screen.getByLabelText(copy.labels.password, { selector: 'input' })).toHaveAttribute('maxlength', '256')
    expect(screen.getByLabelText(copy.labels.username)).toHaveAttribute('maxlength', '120')
  })
  test('accepts an eight-character policy-valid password', async () => {
    install({ [loginPath]: () => response(200, session()) }); open(); await ready(copy); fill(copy); submit(copy)
    await screen.findByText('Protected destination')
    assertRequest(loginPath, 'POST', { username: 'operations', password: 'Abcd1234', rememberMe: false })
  })
  test('disables native validation', async () => {
    open(); await ready(copy)
    expect(screen.getByLabelText(copy.labels.username).closest('form')).toHaveAttribute('novalidate')
  })
  test('validates empty fields before requests and focuses the first invalid field', async () => {
    open(); await ready(copy); submit(copy)
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([copy.labels.requiredField, copy.labels.requiredField])
    expect(screen.getByLabelText(copy.labels.username)).toHaveFocus()
    expect(screen.getByLabelText(copy.labels.username)).toHaveAttribute('aria-describedby', expect.stringContaining('login-username-required'))
    assertRequest(policyPath, 'GET'); expect(calls(loginPath)).toHaveLength(0)
  })
  test('treats whitespace-only usernames as empty', async () => {
    open(); await ready(copy); fill(copy)
    fireEvent.change(screen.getByLabelText(copy.labels.username), { target: { value: '   ' } }); submit(copy)
    expect(screen.getByRole('alert')).toHaveTextContent(copy.labels.requiredField)
    expect(screen.getByLabelText(copy.labels.username)).toHaveFocus()
    expect(calls(loginPath)).toHaveLength(0)
  })
  test('clears only the edited field validation', async () => {
    open(); await ready(copy); submit(copy)
    fireEvent.change(screen.getByLabelText(copy.labels.username), { target: { value: 'operations' } })
    expect(screen.getByLabelText(copy.labels.username)).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  test.each([400, 403, 422])('maps submitted %s feedback and isolates raw details', async (code) => {
    install({ [loginPath]: () => response(code, { status: code, code: 'INVALID_CREDENTIALS', message: 'RAW_SERVER_MESSAGE' }) })
    open(); await ready(copy); fill(copy); submit(copy)
    await waitFor(() => expect(within(screen.getByRole('alert')).getByText(copy.credentialTitle)).toBeVisible())
    expect(screen.getByText(code === 403 ? copy.deniedMessage : copy.credentialMessage)).toBeVisible()
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive')
    expect(screen.getByLabelText(copy.labels.password, { selector: 'input' })).toHaveFocus()
    expect(screen.getByText('RAW_SERVER_MESSAGE')).not.toBeVisible()
    expect(document.getElementById('login-feedback')).not.toHaveTextContent('RAW_SERVER_MESSAGE')
    fireEvent.click(screen.getByText(copy.details)); expect(screen.getByText('RAW_SERVER_MESSAGE')).toBeVisible()
  })
  test.each([401, 403, 404, 500, 0])('keeps the form usable when public policy fails with %s', async (code) => {
    install({ [policyPath]: () => code ? failure(code, code === 500 ? 'policy-request-id' : undefined) : Promise.reject(new TypeError('Network failure')) })
    const { router } = open()
    await screen.findByRole('heading', { name: code === 403 ? copy.policyDeniedTitle : code === 404 ? copy.policyMissingTitle : code ? copy.policyErrorTitle : copy.networkTitle })
    expect(screen.queryByText(copy.signupDisabledTitle)).toBeNull()
    expect(screen.queryByRole('link', { name: copy.labels.signup })).toBeNull()
    expect(screen.getByRole('button', { name: copy.labels.submit })).toBeEnabled()
    expect(screen.getByLabelText(copy.labels.username)).toHaveFocus()
    if ([403, 404].includes(code)) {
      fireEvent.click(screen.getByRole('button', { name: copy.returnToForm }))
      expect(screen.getByLabelText(copy.labels.username)).toHaveFocus()
    }
    if (code === 500) expect(screen.getByText('policy-request-id')).toBeVisible()
    expect(router.state.location.pathname).toBe('/login')
    assertRequest(policyPath, 'GET'); expect(calls(refreshPath)).toHaveLength(0); expect(calls(loginPath)).toHaveLength(0)
  })
  test.each([401, 403, 404, 500, 0])('preserves inferred status after 409 and maps a status read failure %s', async (code) => {
    install({ [loginPath]: () => failure(409), [statusPath]: () => code ? failure(code, code === 500 ? 'status-request-id' : undefined) : Promise.reject(new TypeError('Network failure')) })
    open(); await ready(copy); fill(copy); submit(copy)
    await screen.findByRole('heading', { name: code === 403 ? copy.statusDeniedTitle : code === 404 ? copy.statusMissingTitle : code ? copy.statusErrorTitle : copy.networkTitle })
    expect(screen.getByText(copy.statuses.pending_activation.title)).toBeVisible()
    if (![403, 404].includes(code)) expect(screen.getByRole('link', { name: copy.actions.view_pending_activation })).toHaveAttribute('href', '/signup/pending-activation')
    else {
      expect(screen.queryByRole('link', { name: copy.actions.view_pending_activation })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: copy.returnToForm }))
      expect(screen.getByLabelText(copy.labels.username)).toHaveFocus()
    }
    if (code === 500) expect(screen.getByText('status-request-id')).toBeVisible()
    assertRequest(statusPath, 'GET'); expect(calls(refreshPath)).toHaveLength(0); expect(calls(loginPath)).toHaveLength(1)
  })
  test.each([500, 0])('shows login service error %s and retries the same payload', async (code) => {
    let attempt = 0
    install({ [loginPath]: () => ++attempt === 1 ? code ? failure(code, 'login-request-id') : Promise.reject(new TypeError('Network failure')) : response(200, session()) })
    open(); await ready(copy); fill(copy); submit(copy)
    await screen.findByRole('heading', { name: code ? copy.loginErrorTitle : copy.networkTitle })
    expect(screen.queryByText(copy.credentialTitle)).toBeNull()
    if (code) expect(screen.getByText('login-request-id')).toBeVisible()
    expect(readConsoleShellSession()).toBeNull()
    fireEvent.change(screen.getByLabelText(copy.labels.username), { target: { value: 'edited-user' } })
    fireEvent.change(screen.getByLabelText(copy.labels.password, { selector: 'input' }), { target: { value: 'edited-password' } })
    fireEvent.click(screen.getByRole('button', { name: copy.retry }))
    await screen.findByText('Protected destination')
    assertRequest(loginPath, 'POST', { username: 'operations', password: 'Abcd1234', rememberMe: false }, 2)
  })
  test.each([true, false])('policy retry focuses its successful destination, enabled=%s', async (enabled) => {
    let attempt = 0
    install({ [policyPath]: () => ++attempt === 1 ? failure(500) : response(200, { ...policy(), selfServiceEnabled: enabled }) })
    open(); const retry = await screen.findByRole('button', { name: copy.retry }); retry.focus(); fireEvent.click(retry)
    const target = enabled ? await ready(copy) : (await screen.findByText(copy.signupDisabledTitle)).closest('[data-disabled]')!
    await waitFor(() => expect(target).toHaveFocus())
    assertRequest(policyPath, 'GET', undefined, 2)
    expect(calls(loginPath)).toHaveLength(0)
  })
  test.each([500, 0])('status retry %s sends only its GET and focuses the callout', async (code) => {
    let attempt = 0
    install({ [loginPath]: () => failure(409), [statusPath]: () => ++attempt === 1 ? code ? failure(code) : Promise.reject(new TypeError('Network failure')) : response(200, { ...statusView, allowedActions: [{ actionId: 'recover_password', label: 'RAW_LABEL', target: '/password-recovery?x=1#h' }] }) })
    open(); await ready(copy); fill(copy); submit(copy)
    const retry = await screen.findByRole('button', { name: copy.retry }); retry.focus(); fireEvent.click(retry)
    expect(await screen.findByRole('link', { name: copy.actions.recover_password })).toHaveAttribute('href', '/password-recovery?x=1#h')
    await waitFor(() => expect(document.querySelector('[data-status]')).toHaveFocus())
    assertRequest(statusPath, 'GET', undefined, 2); assertRequest(policyPath, 'GET'); expect(calls(loginPath)).toHaveLength(1)
    expect(screen.queryByText('RAW_LABEL')).toBeNull()
  })
})

test.each(['/', '/next'])('restores basename-aware intent and rejects invalid intents under %s', async (base) => {
  vi.stubEnv('VITE_BASE_PATH', base)
  for (const intent of [`${base === '/' ? '' : base}/console/settings?x=1#h`, '//evil.test/console/settings', `${base === '/' ? '' : base}/other`, '/console-other/settings', null]) {
    if (intent) storeProtectedRouteIntent(intent)
    install({ [loginPath]: () => response(200, session()) })
    const prefix = base === '/' ? '' : base
    const page = open(`${prefix}/login`, base); await ready(); fill(); submit()
    await screen.findByText('Protected destination')
    expect(page.router.state.location.pathname).toBe(`${prefix}/console/${intent?.endsWith('?x=1#h') ? 'settings' : 'overview'}`)
    if (intent?.endsWith('?x=1#h')) expect(page.router.state.location).toMatchObject({ search: '?x=1', hash: '#h' })
    page.unmount(); sessionStorage.clear(); fetchMock.mockClear()
  }
})

test.each([401, 504, 200])('resumes stored refreshable sessions with shared retry semantics for %s', async (code) => {
  const value = session(); value.tokenSet!.expiresAt = value.expiresAt = '2000-01-01T00:00:00Z'
  persistConsoleShellSession(value, 'tenant_example')
  sessionStorage.setItem('in-falcone.console-auth-status-hint', JSON.stringify({ statusView: 'login', title: 'RAW_HINT', message: 'RAW_HINT_MESSAGE' }))
  install({ [refreshPath]: () => code === 200 ? response(200, session()) : failure(code) })
  const { router } = open()
  if (code === 200) await screen.findByText('Protected destination')
  else {
    await waitFor(() => expect(readConsoleShellSession()).toBeNull())
    expect(router.state.location.pathname).toBe('/login')
    expect(screen.getByText(es.expiredHintTitle)).toBeVisible()
    expect(screen.getByRole('button', { name: es.labels.submit })).toBeEnabled()
  }
  assertRequest(refreshPath, 'POST', { refreshToken: 'synthetic-refresh-token', tenantId: 'tenant_example' }, code === 504 ? 2 : 1)
  expect(calls(loginPath)).toHaveLength(0)
})

test('renders delayed policy skeletons while keeping the form usable', async () => {
  let resolve!: (value: Response) => void
  install({ [policyPath]: () => new Promise((done) => { resolve = done }) })
  open(); await waitFor(() => expect(calls(policyPath)).toHaveLength(1))
  expect(screen.getByText(es.policyLoading)).toBeVisible()
  expect(screen.getByRole('button', { name: es.labels.submit })).toBeEnabled()
  await act(async () => resolve(response(200, policy())))
  await ready()
})

test.each(['login', 'policy', 'status'])('keeps retry focus after a repeated %s failure and copies only supplied request IDs', async (area) => {
  install({ [policyPath]: () => area === 'policy' ? failure(500, 'synthetic-request') : response(200, policy()),
    [loginPath]: () => failure(area === 'login' ? 500 : 409, area === 'login' ? 'synthetic-request' : undefined),
    [statusPath]: () => failure(500, 'synthetic-request') })
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  open()
  if (area !== 'policy') { await ready(); fill(); submit() }
  const retry = await screen.findByRole('button', { name: es.retry })
  const before = fetchMock.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: es.copyRequestId }))
  expect(writeText).toHaveBeenCalledWith('synthetic-request')
  expect(fetchMock.mock.calls).toHaveLength(before)
  retry.focus(); fireEvent.click(retry)
  await waitFor(() => expect(fetchMock.mock.calls.length).toBe(before + 1))
  await waitFor(() => expect(screen.getByRole('button', { name: es.retry })).toHaveFocus())
})

test('HTTP errors without a body request ID never render a placeholder', async () => {
  install({ [loginPath]: () => failure(500) }); open(); await ready(); fill(); submit()
  await screen.findByRole('heading', { name: es.loginErrorTitle })
  expect(screen.queryByRole('button', { name: es.copyRequestId })).toBeNull()
  expect(screen.queryByText(es.requestId)).toBeNull()
})

test.each(['es', 'en'])('renders every nondefault auth label and heading verbatim in %s', async (locale) => {
  const originalLabels = { ...consoleAuthConfig.labels }; const originalHeadings = { ...consoleAuthConfig.headings }
  try {
    await i18n.changeLanguage(locale)
    for (const key of Object.keys(es.labels)) Object.assign(consoleAuthConfig.labels, { [key]: `OVERRIDE_${key}` })
    Object.assign(consoleAuthConfig.headings, { title: 'OVERRIDE_title', subtitle: 'OVERRIDE_subtitle' })
    open(); await screen.findByRole('link', { name: 'OVERRIDE_signup' })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('OVERRIDE_title')
    for (const key of ['username', 'password', 'rememberMe', 'submit', 'passwordRecovery'] as const) expect(screen.getByText(`OVERRIDE_${key}`)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'OVERRIDE_submit' }))
    expect(screen.getAllByRole('alert')).toHaveLength(2)
    expect(screen.getAllByText('OVERRIDE_requiredField')).toHaveLength(2)
  } finally { Object.assign(consoleAuthConfig.labels, originalLabels); Object.assign(consoleAuthConfig.headings, originalHeadings) }
})

test('credentials never reach diagnostics or requests other than the login POST', async () => {
  const logs = ['log', 'warn', 'error', 'info', 'debug'].map((key) => vi.spyOn(console, key as 'log').mockImplementation(() => {}))
  install({ [loginPath]: () => failure(409), [statusPath]: () => response(200, statusView) })
  open(); await ready(); fill(es, 'synthetic-sensitive-password'); submit()
  await screen.findByRole('link', { name: es.actions.view_pending_activation })
  for (const logger of logs) expect(JSON.stringify(logger.mock.calls)).not.toContain('synthetic-sensitive-password')
  for (const [path, init] of fetchMock.mock.calls) if (path !== loginPath) expect(JSON.stringify(init)).not.toMatch(/synthetic-sensitive-password|operations/)
})

test.each(['/', '/next'])('usable stored sessions honor the intent without login under %s', async (base) => {
  vi.stubEnv('VITE_BASE_PATH', base)
  const prefix = base === '/' ? '' : base
  storeProtectedRouteIntent(`${prefix}/console/settings?x=1#h`)
  persistConsoleShellSession(session())
  const { router } = open(`${prefix}/login`, base)
  await screen.findByText('Protected destination')
  expect(router.state.location).toMatchObject({ pathname: `${prefix}/console/settings`, search: '?x=1', hash: '#h' })
  expect(calls(loginPath)).toHaveLength(0); expect(calls(refreshPath)).toHaveLength(0)
})

test('login retry switches service feedback to credential feedback and focuses password', async () => {
  let attempt = 0
  install({ [loginPath]: () => failure(++attempt === 1 ? 500 : 401) })
  open(); await ready(); fill(); submit()
  fireEvent.click(await screen.findByRole('button', { name: es.retry }))
  await screen.findByRole('alert')
  expect(screen.getByLabelText(es.labels.password, { selector: 'input' })).toHaveFocus()
  expect(calls(loginPath)).toHaveLength(2)
})

test('busy submit is announced and cannot send duplicate credentials', async () => {
  let resolve!: (value: Response) => void
  install({ [loginPath]: () => new Promise((done) => { resolve = done }) })
  open(); await ready(); fill(); submit()
  const busy = await screen.findByRole('button', { name: es.labels.submitLoading })
  expect(busy).toHaveAttribute('aria-busy', 'true'); expect(busy).toHaveAttribute('aria-disabled', 'true')
  fireEvent.submit(screen.getByLabelText(es.labels.username).closest('form')!)
  expect(calls(loginPath)).toHaveLength(1)
  await act(async () => resolve(response(200, session())))
  await screen.findByText('Protected destination')
})

test.each(['account_suspended', 'credentials_expired', 'password_recovery', 'unknown'])('maps status identity %s and an unknown action without server copy', async (id) => {
  install({ [loginPath]: () => response(409, { status: 409, code: 'ACCOUNT_RESTRICTED', detail: { statusView: id }, message: 'RAW_SERVER_MESSAGE' }),
    [`/v1/auth/status-views/${id}`]: () => response(200, { statusView: id, title: 'RAW_TITLE', message: 'RAW_MESSAGE', allowedActions: [{ actionId: 'constructor', label: 'RAW_LABEL', target: '/help?x=1#h' }] }) })
  open(); await ready(); fill(); submit()
  if (id === 'unknown') {
    await screen.findByText(es.statuses.login.title)
    expect(calls('/v1/auth/status-views/unknown')).toHaveLength(0)
  } else {
    expect(await screen.findByRole('link', { name: es.actions.unknown })).toHaveAttribute('href', '/help?x=1#h')
    expect(screen.getByText(es.statuses[id as keyof typeof es.statuses].title)).toBeVisible()
  }
  expect(screen.queryByText('RAW_TITLE')).toBeNull(); expect(screen.queryByText('RAW_MESSAGE')).toBeNull(); expect(screen.queryByText('RAW_LABEL')).toBeNull()
})
