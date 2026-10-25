import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import { persistConsoleShellSession } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import { changeLocale } from '../src/i18n'
import NotFoundPage from '../src/pages/notFound'
import { appRoutes } from '../src/router'
import { ShellErrorBoundary } from '../src/shell/RouteState'
import { login } from './shell-support'
import es from '../src/locales/es/pages.not-found-page.json'
import en from '../src/locales/en/pages.not-found-page.json'

beforeEach(() => { window.history.replaceState(null, '') })

test('the pending catch-all chunk shows skeletons on the status layout', async () => {
  render(<MemoryRouter initialEntries={['/missing']}><App /></MemoryRouter>)
  const main = screen.getByRole('main')
  expect(main).toHaveAttribute('id', 'not-found-loading')
  expect(within(main).getByRole('status')).toHaveTextContent('Cargando')
  expect(await screen.findByRole('heading', { name: es.title })).toHaveFocus()
})

for (const locale of ['es', 'en'] as const) {
  const copy = locale === 'es' ? es : en
  test(`${locale} renders the recovery content with a single focused heading and no sample chrome`, async () => {
    await changeLocale(locale)
    render(<MemoryRouter><NotFoundPage /></MemoryRouter>)
    const heading = screen.getByRole('heading', { level: 1, name: copy.title })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(heading).toHaveFocus()
    expect(heading).toHaveAttribute('tabindex', '-1')
    expect(heading.parentElement?.parentElement?.parentElement?.tagName).toBe('DIV')
    expect(screen.getByText(copy.description)).toBeVisible()
    const code = screen.getByText(copy.code)
    expect(code).toBeVisible()
    expect(code.className).not.toMatch(/tracking-(?:wide|widest|\[)/)
    expect(screen.getByRole('link', { name: copy.home })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('button', { name: copy.back })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(document.querySelector('footer, dl')).toBeNull()
    expect(screen.getAllByRole('img', { name: copy.logo })).toHaveLength(1)
    expect(within(screen.getByRole('main')).getAllByRole('link')).toHaveLength(2)
    expect(document.querySelectorAll('main svg[aria-hidden="true"]')).toHaveLength(1)
  })

  test.each(['absent', 'stored-valid', 'expired', 'unusable'])(`${locale} %s session chooses the legacy primary without requests`, async (state) => {
    await changeLocale(locale)
    if (state !== 'absent') {
      const session = login()
      if (state === 'expired') session.tokenSet!.expiresAt = '2000-01-01T00:00:00Z'
      if (state === 'unusable') session.tokenSet!.accessToken = ''
      persistConsoleShellSession(session)
    }
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter basename="/next" initialEntries={['/next/missing']}><App /></MemoryRouter>)
    await screen.findByRole('heading', { name: copy.title })
    const authenticated = state === 'stored-valid'
    expect(screen.getByRole('link', { name: authenticated ? copy.console : copy.login })).toHaveAttribute('href', `/next${authenticated ? '/console' : consoleAuthConfig.loginPath}`)
    expect(screen.queryByRole('link', { name: authenticated ? copy.login : copy.console })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: copy.home })).toHaveAttribute('href', '/next')
    expect(fetch).not.toHaveBeenCalled()
  })

  test.each([null, { idx: 0 }, { idx: '1' }, { idx: -1 }])(`${locale} hides unsafe back actions for history %j`, async (state) => {
    await changeLocale(locale)
    window.history.replaceState(state, '')
    render(<MemoryRouter><NotFoundPage /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: copy.back })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: copy.login })).toBeVisible()
    expect(screen.getByRole('link', { name: copy.home })).toBeVisible()
  })

  test(`${locale} back calls router history recovery and keeps decorative icons hidden`, async () => {
    await changeLocale(locale)
    window.history.replaceState({ idx: 1 }, '')
    function Location() { return <output>{useLocation().pathname}</output> }
    render(<MemoryRouter initialEntries={['/login', '/missing']}><Location /><App /></MemoryRouter>)
    await screen.findByRole('heading', { name: copy.title })
    const back = screen.getByRole('button', { name: copy.back })
    expect(back.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(document.querySelectorAll('main svg[aria-hidden="true"]')).toHaveLength(2)
    fireEvent.click(back)
    expect(await screen.findByRole('heading', { name: locale === 'es' ? 'Acceso' : 'Sign in' })).toBeVisible()
    expect(screen.getByText('/login', { selector: 'output' })).toBeVisible()
  })

  test(`${locale} catch-all owns its layout, sets its title and restores the previous title`, async () => {
    await changeLocale(locale)
    document.title = 'Previous document'
    const catchAll = appRoutes[0].children!.find((route) => route.path === '*')!
    expect(catchAll.handle).toEqual({ ownLayout: true })
    const view = render(<MemoryRouter initialEntries={['/missing']}><App /></MemoryRouter>)
    await screen.findByRole('heading', { name: copy.title })
    expect(document.title).toBe(copy.documentTitle)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('img', { name: copy.logo })).toHaveLength(1)
    view.unmount()
    expect(document.title).toBe('Previous document')
  })
}

test('in-app arrival focuses the catch-all heading and the home action uses router navigation', async () => {
  let navigate!: ReturnType<typeof useNavigate>
  function Probe() { navigate = useNavigate(); return null }
  render(<MemoryRouter initialEntries={['/login']}><Probe /><App /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Acceso' })
  await act(async () => { navigate('/does-not-exist') })
  expect(await screen.findByRole('heading', { name: es.title })).toHaveFocus()
  fireEvent.click(screen.getByRole('link', { name: es.home }))
  expect(await screen.findByRole('heading', { name: 'Consola In Falcone' })).toBeVisible()
})

test('catch-all preserves the console unknown-route handler', async () => {
  const consoleRoute = appRoutes.find((route) => route.path === '/console')!
  const unknown = consoleRoute.children!.find((route) => route.path === '*')!
  render(<MemoryRouter>{unknown.element}</MemoryRouter>)
  expect(screen.getByRole('heading', { name: 'Sección de consola no encontrada' })).toBeVisible()
  expect(screen.queryByText(es.description)).not.toBeInTheDocument()
})

test.each(['chunk-load failure', 'offline chunk failure'])('%s renders the shared status-500 retry boundary', (failure) => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  function FailedChunk(): never { throw new Error(failure) }
  render(<MemoryRouter><ShellErrorBoundary><FailedChunk /></ShellErrorBoundary></MemoryRouter>)
  expect(screen.getByRole('heading', { level: 1, name: 'Error del servidor' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  expect(screen.getAllByText('500')[0]).toBeVisible()
})
