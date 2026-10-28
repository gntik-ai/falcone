import { buildConsoleSignupPolicyFixture } from '@in-falcone/console-api/fixtures'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Profiler } from 'react'
import { Link as RouterLink, MemoryRouter, useNavigate } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import { persistConsoleShellSession } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import WelcomePage from '../src/pages/welcome'
import { changeLocale } from '../src/i18n'
import { login } from './shell-support'
import es from '../src/locales/es/pages.welcome-page.json'
import en from '../src/locales/en/pages.welcome-page.json'

vi.mock('@in-falcone/console-api/config', async (original) => {
  const actual = await original<typeof import('@in-falcone/console-api/config')>()
  return { ...actual, consoleAuthConfig: { ...actual.consoleAuthConfig, labels: { ...actual.consoleAuthConfig.labels } } }
})
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(buildConsoleSignupPolicyFixture())))
  Object.assign(consoleAuthConfig, { loginPath: '/login', signupPath: '/signup', passwordRecoveryPath: '/password-recovery' })
  Object.assign(consoleAuthConfig.labels, { passwordRecovery: es.recovery })
})

for (const locale of ['es', 'en'] as const) {
  const copy = locale === 'es' ? es : en
  test(`${locale} renders the legacy content, translated labels and four configured router links`, async () => {
    await changeLocale(locale)
    // Start the assertion at commit, before the page's passive title effect.
    let titleCheck: Promise<void> | undefined
    render(<MemoryRouter basename="/next" initialEntries={['/next/']}><Profiler id="welcome" onRender={() => {
      if (screen.queryByRole('heading', { level: 1, name: copy.title })) titleCheck ??= waitFor(() => expect(document.title).toBe(copy.documentTitle))
    }}><App /></Profiler></MemoryRouter>)
    expect(await screen.findByRole('heading', { level: 1, name: copy.title })).toBeVisible()
    for (const key of ['badge', 'intro', 'secureTitle', 'secureBody', 'signupTitle', 'signupBody', 'help'] as const) expect(screen.getByText(copy[key])).toBeVisible()
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2)
    const main = screen.getByRole('main')
    expect(within(main).getAllByRole('link').map((link) => link.textContent)).toEqual([copy.back, copy.login, copy.signup, copy.recovery])
    for (const [label, path] of [[copy.back, '/login'], [copy.login, '/login'], [copy.signup, '/signup'], [copy.recovery, '/password-recovery']]) {
      const link = screen.getByRole('link', { name: label })
      expect(link).toHaveAttribute('href', `/next${path}`)
      expect(link).toHaveAccessibleName(link.textContent!)
    }
    expect(screen.getByRole('region', { name: copy.title })).toBeVisible()
    expect(screen.getByRole('img', { name: copy.logo }).closest('a')).toBeNull()
    expect(screen.getAllByRole('img', { name: copy.logo })).toHaveLength(1)
    expect(main).not.toHaveFocus()
    expect(titleCheck).toBeDefined()
    await titleCheck
    expect(document.body.textContent).not.toMatch(/EP-\d+|US-UI|\/v1\/|roadmap|llegarán en T\d|fundación de consola lista|stack confirmado|\bshell\b|Acme|This page will be available soon|Esta página estará disponible próximamente/i)
    expect(main.querySelectorAll('.welcome-actions svg[aria-hidden="true"]')).toHaveLength(2)
  })
  test(`${locale} preserves recovery and signup configuration overrides`, async () => {
    await changeLocale(locale)
    Object.assign(consoleAuthConfig, { signupPath: '/registro' })
    Object.assign(consoleAuthConfig.labels, { passwordRecovery: 'Recuperar acceso' })
    render(<MemoryRouter basename="/next" initialEntries={['/next/']}><WelcomePage /></MemoryRouter>)
    expect(screen.getByRole('link', { name: copy.signup })).toHaveAttribute('href', '/next/registro')
    const recovery = screen.getByRole('link', { name: 'Recuperar acceso' })
    expect(recovery).toHaveTextContent('Recuperar acceso')
    expect(recovery).toHaveAttribute('href', '/next/password-recovery')
    expect(screen.queryByText(copy.recovery)).not.toBeInTheDocument()
  })
}

test.each(['anonymous', 'stored', 'expired'])('%s welcome is public and makes no request or redirect', async (state) => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  if (state !== 'anonymous') {
    const session = login()
    if (state === 'expired') {
      session.tokenSet!.expiresAt = '2000-01-01T00:00:00Z'
      persistConsoleShellSession(session)
    }
  }
  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { level: 1, name: es.title })).toBeVisible()
  expect(screen.getByRole('link', { name: es.login })).toHaveAttribute('href', '/login')
  expect(fetch).not.toHaveBeenCalled()
})

test('login owns its auth logo and main', async () => {
  render(<MemoryRouter initialEntries={['/login']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Accede a In Falcone Console' })).toBeVisible()
  expect(screen.getByRole('img', { name: 'In Falcone' })).toBeVisible()
  expect(screen.getAllByRole('main')).toHaveLength(1)
})

test('returning to welcome by router navigation focuses main', async () => {
  render(<MemoryRouter initialEntries={['/login']}><RouterLink to="/">Return home</RouterLink><App /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Accede a In Falcone Console' })
  fireEvent.click(screen.getByRole('link', { name: 'Return home' }))
  await screen.findByRole('heading', { name: es.title })
  expect(screen.getByRole('main')).toHaveFocus()
})

test('programmatic navigation preserves public chrome and only login reads its policy', async () => {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json(buildConsoleSignupPolicyFixture())))
  vi.stubGlobal('fetch', fetch)
  let navigate!: ReturnType<typeof useNavigate>
  function NavigationProbe() { navigate = useNavigate(); return null }
  render(<MemoryRouter><NavigationProbe /><App /></MemoryRouter>)
  await screen.findByRole('heading', { name: es.title })
  for (const [path, heading] of [
    [consoleAuthConfig.loginPath, 'Accede a In Falcone Console'], [consoleAuthConfig.signupPath, 'Solicitar acceso'],
    [consoleAuthConfig.passwordRecoveryPath, 'Recuperar contraseña']
  ]) {
    await act(async () => { navigate(path) })
    expect(await screen.findByRole('heading', { name: heading })).toBeVisible()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    await act(async () => { navigate('/') })
    await screen.findByRole('heading', { name: es.title })
    expect(screen.getByRole('main')).toHaveFocus()
  }
  expect(fetch).toHaveBeenCalledWith('/v1/auth/signups/policy', expect.objectContaining({ method: 'GET' }))
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('history Back waits until welcome main accepts focus', async () => {
  let navigate!: ReturnType<typeof useNavigate>
  let holdFocus = false
  function NavigationProbe() { navigate = useNavigate(); return null }
  const focus = HTMLElement.prototype.focus
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options) {
    if (!holdFocus || this.id !== 'welcome-main') focus.call(this, options)
  })
  render(<MemoryRouter><NavigationProbe /><App /></MemoryRouter>)
  await screen.findByRole('heading', { name: es.title })
  await act(async () => { navigate('/login') })
  await screen.findByRole('heading', { name: 'Accede a In Falcone Console' })
  holdFocus = true
  await act(async () => { navigate(-1) })
  const main = screen.getByRole('main')
  expect(main).not.toHaveFocus()
  holdFocus = false
  await act(async () => { main.setAttribute('tabindex', '-1') })
  await waitFor(() => expect(main).toHaveFocus())
  const link = screen.getByRole('link', { name: es.signup })
  link.focus()
  await act(async () => { main.setAttribute('class', main.className) })
  expect(link).toHaveFocus()
})

test('leaving welcome cancels pending focus restoration', async () => {
  let navigate!: ReturnType<typeof useNavigate>
  function NavigationProbe() { navigate = useNavigate(); return null }
  const focus = HTMLElement.prototype.focus
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options) {
    if (this.id !== 'welcome-main') focus.call(this, options)
  })
  render(<MemoryRouter initialEntries={['/login']}><NavigationProbe /><App /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Accede a In Falcone Console' })
  await act(async () => { navigate('/') })
  const main = screen.getByRole('main')
  expect(main).not.toHaveFocus()
  await act(async () => { navigate('/login') })
  await screen.findByRole('heading', { name: 'Accede a In Falcone Console' })
  const input = screen.getByRole('textbox')
  input.focus()
  main.focus = focus
  await act(async () => { document.body.append(main) })
  expect(input).toHaveFocus()
  main.remove()
})
