import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import RecoveryPage from '../src/pages/recovery'
import LoginPage from '../src/pages/login'
import { App } from '../src/App'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.password-recovery-page.json'
import en from '../src/locales/en/pages.password-recovery-page.json'
import loginEs from '../src/locales/es/pages.login-page.json'
import loginEn from '../src/locales/en/pages.login-page.json'
import manifest, { recoveryPath, recoveryTicket } from './parity/pages/password-recovery-page.manifest'
import { createEndpointRegistry } from './parity/endpoint-registry'
import { endpoints, responseFor } from './parity/fixtures/shell'

const fetchMock = vi.fn<typeof fetch>()
const payload = { usernameOrEmail: 'operaciones@example.com', deliveryChannel: 'email' }
const registry = () => createEndpointRegistry(endpoints, (name, variant, role) => responseFor(name, variant as Parameters<typeof responseFor>[1], role), manifest.endpoints)
function install(variants = ['success']) {
  const fixtures = registry()
  fixtures.setVariants({ recovery: variants })
  fetchMock.mockImplementation(async (url, init) => {
    const name = fixtures.find(init?.method ?? 'GET', String(url))
    if (!name) throw new Error(`Unmatched request ${url}`)
    const response = fixtures.responseFor(name, 'tenant_viewer')
    if (response.network) throw new TypeError('RAW_SERVER_MESSAGE')
    return Response.json(response.body, { status: response.status })
  })
}
function open(entry = '/next/password-recovery', app = false) {
  const router = createMemoryRouter(app ? [{ path: '*', element: <App /> }] : [
    { path: '/password-recovery', element: <RecoveryPage /> },
    { path: '/login', element: <LoginPage /> },
  ], { basename: '/next', initialEntries: [entry] })
  const rendered = render(<StrictMode><RouterProvider router={router} /></StrictMode>)
  return { ...rendered, router }
}
function assertRequests(count = 1) {
  expect(fetchMock).toHaveBeenCalledTimes(count)
  for (const [url, init] of fetchMock.mock.calls) {
    expect(url).toBe(recoveryPath)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(payload)
    const headers = new Headers(init?.headers)
    expect(headers.get('Idempotency-Key')).toMatch(/^idem_.+/)
    expect(headers.has('Authorization')).toBe(false)
  }
}
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); install() })
afterEach(() => { fetchMock.mockReset(); vi.unstubAllGlobals() })

for (const [locale, copy, loginCopy] of [['es', es, loginEs], ['en', en, loginEn]] as const) describe(locale, () => {
  beforeEach(async () => { await i18n.changeLanguage(locale) })
  const field = () => screen.getByLabelText(copy.identifier)
  const button = () => screen.getByRole('button', { name: copy.submit })
  function submit(value = '  operaciones@example.com  ') {
    fireEvent.change(field(), { target: { value } })
    fireEvent.click(button())
  }
  const success = () => screen.findByText(copy.successTitle)
  function assertPrivacy() {
    expect(document.body).not.toHaveTextContent(/RAW_SERVER_MESSAGE|Acme|req_8f2c41d07a9b|EP-\d+|US-UI|\/v1\/|Realm|Client ID/)
    expect(screen.queryByRole('button', { name: /resend|reenviar|request access|solicitar acceso|support|soporte/i })).not.toBeInTheDocument()
  }
  test('ports #726: renders a real public recovery view with one main, heading and logo', async () => {
    open('/next/password-recovery', true)
    await screen.findByRole('heading', { name: copy.title })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('img', { name: copy.logo })).toHaveLength(1)
    expect(field()).toHaveFocus()
    expect(button()).toBeEnabled()
    expect(screen.getByRole('link', { name: copy.back })).toHaveAttribute('href', '/next' + consoleAuthConfig.loginPath)
    expect(screen.getByText(copy.asideDelivery)).toBeVisible()
    expect(screen.getByText(copy.asideOperator)).toBeVisible()
    expect(document.title).toBe(copy.documentTitle)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  test('ports #729: keeps native constraints while disabling browser validation', () => {
    open()
    expect(field().closest('form')).toHaveAttribute('novalidate')
    expect(field()).toHaveAttribute('minlength', '3')
    expect(field()).toHaveAttribute('maxlength', '255')
    expect(field()).toHaveAttribute('type', 'text')
    expect(field()).toHaveAttribute('autocomplete', 'username')
    expect(field()).toHaveAttribute('aria-describedby', 'password-recovery-username-help')
  })
  test.each(['', '   '])('ports #729: validates trimmed required input without sending a request (%j)', (value) => {
    open(); submit(value)
    expect(screen.getByRole('alert')).toHaveTextContent(copy.required)
    expect(field()).toHaveFocus()
    expect(field()).toHaveAttribute('aria-invalid', 'true')
    expect(field()).toHaveAttribute('aria-describedby', 'password-recovery-username-help password-recovery-username-required')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  test('ports #729: clears the required error on edit', () => {
    open(); submit('')
    fireEvent.change(field(), { target: { value: 'o' } })
    expect(screen.queryByText(copy.required)).not.toBeInTheDocument()
    expect(field()).not.toHaveAttribute('aria-invalid', 'true')
    expect(field()).toHaveAttribute('aria-describedby', 'password-recovery-username-help')
  })
  test('keeps minLength as an attribute without adding a client length check', async () => {
    open(); submit('o'); await success()
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ usernameOrEmail: 'o', deliveryChannel: 'email' })
  })
  test('ports #730: omits scaffolding and sample copy from the empty form', () => {
    open(); assertPrivacy()
    expect(screen.queryByText(copy.ticketTitle)).not.toBeInTheDocument()
    expect(screen.queryByText(copy.successTitle)).not.toBeInTheDocument()
  })
  test.each(['pending-delivery', 'delivered', 'completed', 'expired'])('ports accepted recovery: posts once and localizes %s', async (variant) => {
    install([variant]); open(); submit(); await success()
    assertRequests()
    const status = variant === 'pending-delivery' ? 'pending_delivery' : variant as keyof typeof copy.statuses
    expect(screen.getByText(copy.status.replace('{status}', copy.statuses[status]))).toBeVisible()
    expect(screen.getByText(copy.destination.replace('{destination}', recoveryTicket.maskedDestination))).toBeVisible()
    expect(document.querySelector('time')).toHaveTextContent(new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(recoveryTicket.expiresAt)))
    expect(button()).toHaveFocus()
    expect(screen.getByText(copy.successMessage)).toBeVisible()
    assertPrivacy()
  })
  test('announces pending once, disables duplicate submissions and clears the previous ticket', async () => {
    open(); submit(); await success()
    let release!: (value: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    submit()
    expect(screen.queryByText(copy.ticketTitle)).not.toBeInTheDocument()
    expect(screen.queryByText(copy.successTitle)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: copy.submitting })).toBeDisabled()
    expect(screen.getByRole('button', { name: copy.submitting })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getAllByText(copy.submitting)).toHaveLength(2)
    expect(document.querySelectorAll('[role="status"][aria-busy="true"]')).toHaveLength(1)
    fireEvent.submit(field().closest('form')!)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => release(Response.json(recoveryTicket, { status: 202 })))
    await success(); assertRequests(2)
  })
  test.each([['400', 'invalidTitle', 'alert'], ['429', 'restrictedTitle', 'status'], ['403', 'deniedTitle', 'status'], ['404', 'missingTitle', 'status']] as const)('ports in-page %s with localized copy and stable submit focus', async (variant, title, role) => {
    install([variant]); const { router } = open(); submit()
    const outcome = await screen.findByText(copy[title])
    const region = outcome.closest(`[role="${role}"]`)
    expect(region).not.toBeNull()
    if (role === 'status' && variant !== '429') expect(region).toHaveAttribute('aria-live', 'polite')
    if (role === 'alert') expect(region).toHaveAttribute('aria-live', 'assertive')
    expect(button()).toHaveFocus()
    expect(field()).toBeEnabled()
    expect(screen.getAllByRole('link', { name: copy.back })).toHaveLength(1)
    expect(router.state.location.pathname).toBe('/next/password-recovery')
    assertPrivacy(); assertRequests()
    if (variant === '403' || variant === '404') {
      const link = within(region as HTMLElement).getByRole('link', { name: copy.back })
      const calls = fetchMock.mock.calls.length
      fireEvent.click(link)
      await screen.findByRole('heading', { name: loginCopy.title })
      expect(router.state.location.pathname).toBe('/next/login')
      expect(fetchMock.mock.calls.slice(calls).map(([url]) => url)).toEqual(['/v1/auth/signups/policy'])
    }
  })
  test.each(['401', '500', 'network'])('shows %s as a service error without refresh or redirect', async (variant) => {
    install([variant]); const { router } = open(); submit()
    await screen.findByRole('heading', { name: copy.serviceTitle })
    expect(screen.getByRole('alert')).toHaveTextContent(copy.serviceMessage)
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive')
    if (variant === '500') expect(screen.getByText('synthetic-recovery-request')).toBeVisible()
    expect(screen.queryByText(copy.ticketTitle)).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/next/password-recovery')
    expect(button()).toHaveFocus()
    fireEvent.keyDown(button(), { key: 'Tab' })
    expect(screen.getByRole('button', { name: copy.retry })).toHaveFocus()
    assertRequests(); assertPrivacy()
  })
  test('retry preserves the submitted payload, re-announces failure and restores focus after success', async () => {
    install(['500', '500', 'success']); open(); submit()
    await screen.findByRole('heading', { name: copy.serviceTitle })
    const previousAlert = screen.getByRole('alert')
    fireEvent.change(field(), { target: { value: 'different-user' } })
    fireEvent.click(screen.getByRole('button', { name: copy.retry }))
    await screen.findByRole('heading', { name: copy.serviceTitle })
    await waitFor(() => expect(screen.getByRole('button', { name: copy.retry })).toHaveFocus())
    expect(screen.getByRole('alert')).not.toBe(previousAlert)
    fireEvent.click(screen.getByRole('button', { name: copy.retry }))
    await success()
    expect(screen.queryByRole('button', { name: copy.retry })).not.toBeInTheDocument()
    expect(button()).toHaveFocus()
    assertRequests(3); assertPrivacy()
  })
  test('clears the previous ticket and feedback before even an invalid subsequent submit', async () => {
    open(); submit(); await success(); submit(' ')
    expect(screen.queryByText(copy.ticketTitle)).not.toBeInTheDocument()
    expect(screen.queryByText(copy.successTitle)).not.toBeInTheDocument()
    expect(field()).toHaveFocus(); assertRequests()
  })
  test('ports #726: arrives from login and returns through a router link', async () => {
    const { router } = open('/next/login', true)
    await screen.findByRole('link', { name: loginCopy.labels.passwordRecovery })
    fireEvent.click(screen.getByRole('link', { name: loginCopy.labels.passwordRecovery }))
    await screen.findByRole('heading', { name: copy.title })
    expect(field()).toHaveFocus()
    expect(screen.getByRole('button', { name: copy.submit })).toBeVisible()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/v1/auth/signups/policy'])
    fetchMock.mockClear()
    fireEvent.click(screen.getByRole('link', { name: copy.back }))
    await screen.findByRole('heading', { name: loginCopy.title })
    expect(router.state.location.pathname).toBe('/next/login')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/v1/auth/signups/policy'])
  })
  test('restores the document title on unmount', () => {
    document.title = 'Previous title'
    const view = open()
    expect(document.title).toBe(copy.documentTitle)
    view.unmount()
    expect(document.title).toBe('Previous title')
  })
})
