import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { App } from '../src/App'
import { LocaleSwitch } from '../src/i18n/LocaleSwitch'
import { changeLocale } from '../src/i18n'
import { ShellErrorBoundary } from '../src/shell/RouteState'
import { registerLocaleBundles, useLocaleLoader } from '../src/i18n/locale-loader'
import { login, strictFetch } from './shell-support'
import Settings from '../src/pages/settings'
import welcomeEs from '../src/locales/es/pages.welcome-page.json'
import welcomeEn from '../src/locales/en/pages.welcome-page.json'

const context = vi.hoisted(() => vi.fn())
vi.mock('../src/shell/context', () => ({ useConsoleContext: context, ConsoleContextProvider: ({ children }: { children: React.ReactNode }) => children }))
beforeEach(() => context.mockReturnValue({ tenants: [{ tenantId: 'synthetic-tenant', displayName: 'Tenant Alpha' }], activeTenantId: 'synthetic-tenant', workspaces: [], loading: false, error: null }))
const mount = () => render(<MemoryRouter><Settings /><LocaleSwitch /></MemoryRouter>)

test.each(['/', '/next'])('settings navigation stays in the migrated console under basename %s', async (basename) => {
  login(['tenant_owner'])
  const network = strictFetch({})
  const location = `${basename === '/' ? '' : basename}/console/settings`
  render(<MemoryRouter basename={basename} initialEntries={[location]}><App /></MemoryRouter>)
  const settings = await screen.findByRole('link', { name: 'Ajustes' }, { timeout: 5_000 })
  expect(settings).toHaveAttribute('href', location)
  expect(settings).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: 'Perfil' })).toHaveAttribute('href', `${basename === '/' ? '' : basename}/console/profile`)
  expect(fireEvent.click(settings)).toBe(false)
  expect(await screen.findByRole('heading', { name: 'Ajustes de consola', level: 1 })).toBeVisible()
  network.verify()
  expect(network.mock).not.toHaveBeenCalled()
}, 10_000)

test.each(['es', 'en'] as const)('the settings breadcrumb is translated in %s without adding a menu route', async (locale) => {
  await changeLocale(locale)
  login(['tenant_owner'])
  const network = strictFetch({})
  render(<MemoryRouter initialEntries={['/console/settings']}><App /></MemoryRouter>)
  await screen.findByRole('heading', { name: locale === 'es' ? 'Ajustes de consola' : 'Console settings', level: 1 })
  const breadcrumb = screen.getByRole('navigation', { name: locale === 'es' ? 'Ruta de navegación' : 'Breadcrumb' })
  expect(within(breadcrumb).getByText(locale === 'es' ? 'Configuración' : 'Settings')).toHaveAttribute('aria-current', 'page')
  fireEvent.click(screen.getByRole('button', { name: locale === 'es' ? 'Menú de usuario' : 'User menu' }))
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(locale === 'es' ? ['Acerca de', 'Cerrar sesión'] : ['About', 'Sign out'])
  network.verify()
}, 10_000)

for (const locale of ['es', 'en'] as const) {
  test(`ported legacy settings render tenant and honest empty copy without requests in ${locale}`, async () => {
    await changeLocale(locale)
    const network = strictFetch({})
    mount()
    expect(screen.getByRole('heading', { name: locale === 'es' ? 'Ajustes de consola' : 'Console settings', level: 1 })).toBeVisible()
    expect(screen.getByText(locale === 'es' ? 'Sin preferencias configurables' : 'No configurable preferences')).toBeVisible()
    expect(document.body.textContent).toContain('Tenant Alpha')
    for (const pattern of [/EP-\d+/, /US-UI/i, /consola base/i, /pantalla temporal/i, /entrada base/i, /iteración posterior/i]) expect(document.body.textContent).not.toMatch(pattern)
    expect(screen.getByRole('link', { name: locale === 'es' ? 'Perfil' : 'Profile' })).toHaveAttribute('href', '/console/profile')
    expect(screen.getByRole('link', { name: locale === 'es' ? 'Ajustes' : 'Settings' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('combobox', { name: locale === 'es' ? 'Idioma de la interfaz' : 'Interface language' })).toHaveTextContent(locale === 'es' ? 'Español' : 'English')
    network.verify()
    expect(network.mock).not.toHaveBeenCalled()
  })
}

test('tenant loading uses a skeleton and a missing tenant uses the legacy fallback', () => {
  context.mockReturnValue({ tenants: [], activeTenantId: null, loading: true })
  const page = mount()
  expect(screen.getByRole('status', { name: 'Cargando la organización activa.' })).toBeVisible()
  context.mockReturnValue({ tenants: [], activeTenantId: null, loading: false, error: { status: 403 } })
  page.rerender(<MemoryRouter><Settings /><LocaleSwitch /></MemoryRouter>)
  expect(screen.getByText('Preferencias operativas para tu cuenta y para la organización activa.')).toBeVisible()
  expect(screen.getByRole('combobox', { name: 'Idioma de la interfaz' })).toBeEnabled()
})

for (const [from, to] of [['es', 'en'], ['en', 'es']] as const) for (const control of ['page', 'menu']) {
  test(`${control} preserves ${from} on bundle failure and retries ${to} with pending and focus recovery`, async () => {
    await changeLocale(from)
    mount()
    let finish!: (value: Record<string, unknown>) => void
    const loader = vi.fn().mockRejectedValueOnce(new Error('synthetic failure')).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const remove = registerLocaleBundles('pages.console-settings-page', { es: loader, en: loader })
    try {
      const label = from === 'es' ? 'Idioma de la interfaz' : 'Interface language'
      const trigger = screen.getByRole('combobox', { name: label })
      if (control === 'page') {
        fireEvent.click(trigger)
        const option = within(await screen.findByRole('listbox')).getByRole('option', { name: to === 'es' ? 'Spanish' : 'Inglés' })
        fireEvent.pointerDown(option)
        fireEvent.click(option)
      } else fireEvent.change(screen.getByRole('combobox', { name: from === 'es' ? 'Idioma' : 'Language' }), { target: { value: to } })
      const retry = await screen.findByRole('button', { name: from === 'es' ? 'Reintentar' : 'Retry' })
      expect(document.documentElement.lang).toBe(from)
      expect(localStorage.getItem('falcone-next-locale')).toBe(from)
      await waitFor(() => expect(document.querySelector('[aria-live="assertive"]')).toHaveTextContent(from === 'es' ? 'Se mantiene el idioma anterior.' : 'The previous language remains active.'))
      retry.focus()
      fireEvent.click(retry)
      expect(trigger).toHaveAttribute('aria-busy', 'true')
      expect(trigger).toBeDisabled()
      expect(retry).toHaveFocus()
      expect(document.documentElement.lang).toBe(from)
      await act(async () => { finish({}); await Promise.resolve() })
      await waitFor(() => expect(document.documentElement.lang).toBe(to))
      expect(localStorage.getItem('falcone-next-locale')).toBe(to)
      await waitFor(() => expect(trigger).toHaveFocus())
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument()
    } finally { act(remove) }
  })
}

test.each(['es', 'en'] as const)('a caught render error in %s has translated copy, no sample diagnostics and retry remounts', async (locale) => {
  await changeLocale(locale)
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  context.mockImplementation(() => { throw new Error('synthetic render failure') })
  mount()
  expect(screen.getByRole('heading', { name: locale === 'es' ? 'Ajustes de consola' : 'Console settings', level: 1 })).toBeVisible()
  expect(screen.queryByText(locale === 'es' ? 'Referencia del error' : 'Error reference')).not.toBeInTheDocument()
  expect(document.querySelector('code')).toBeNull()
  expect(document.body).not.toHaveTextContent(/503|req_8f2c41d07a9b|acme-web/)
  expect(document.body.textContent).not.toContain('req_8f2c41d07a9b')
  context.mockReturnValue({ tenants: [], activeTenantId: null, loading: false })
  fireEvent.click(screen.getByRole('button', { name: locale === 'es' ? 'Reintentar' : 'Retry' }))
  expect(await screen.findByText(locale === 'es' ? 'Sin preferencias configurables' : 'No configurable preferences')).toBeVisible()
  log.mockRestore()
})

test.each(['missing crypto', 'missing randomUUID'])('render errors remain recoverable with %s', (availability) => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('crypto', availability === 'missing crypto' ? undefined : {})
  try {
    context.mockImplementation(() => { throw new Error('synthetic render failure') })
    const page = mount()
    expect(screen.getByRole('heading', { name: 'Ajustes de consola', level: 1 })).toBeVisible()
    expect(document.querySelector('code')).toBeNull()
    expect(document.body).not.toHaveTextContent(/503|req_8f2c41d07a9b|acme-web/)
    context.mockReturnValue({ tenants: [], activeTenantId: null, loading: false })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(screen.getByText('Sin preferencias configurables')).toBeVisible()
    page.unmount()

    let fail = true
    function BrokenRoute() {
      if (fail) throw new Error('synthetic route failure')
      return <Settings />
    }
    render(<MemoryRouter><ShellErrorBoundary><BrokenRoute /></ShellErrorBoundary></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Error del servidor', level: 1 })).toBeVisible()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(screen.getByText('Sin preferencias configurables')).toBeVisible()
  } finally {
    vi.unstubAllGlobals()
    log.mockRestore()
  }
})

for (const locale of ['es', 'en'] as const) for (const route of ['/console/overview', '/']) {
  test(`bundle failure on ${route} keeps ${locale} without surfacing a toast`, async () => {
    await changeLocale(locale)
    login(['tenant_owner'])
    const network = strictFetch({})
    render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)
    await screen.findByRole('heading', { name: route === '/' ? (locale === 'es' ? welcomeEs : welcomeEn).title : (locale === 'es' ? 'Vista general de la consola' : 'Console overview') })
    const remove = registerLocaleBundles('synthetic-other-route', { es: async () => { throw new Error('synthetic failure') }, en: async () => { throw new Error('synthetic failure') } })
    function Observer() { const state = useLocaleLoader(); return <output data-testid="loader-result">{String(state.error)}</output> }
    render(<Observer />)
    try {
      if (route === '/') (screen.getByText(locale === 'es' ? 'Menú de usuario' : 'User menu').closest('details') as HTMLDetailsElement).open = true
      else fireEvent.click(screen.getByRole('button', { name: locale === 'es' ? 'Menú de usuario' : 'User menu' }))
      fireEvent.change(screen.getByRole('combobox', { name: locale === 'es' ? 'Idioma' : 'Language' }), { target: { value: locale === 'es' ? 'en' : 'es' } })
      await waitFor(() => expect(screen.getByTestId('loader-result')).toHaveTextContent('true'))
      expect(document.documentElement.lang).toBe(locale)
      expect(localStorage.getItem('falcone-next-locale')).toBe(locale)
      expect(screen.queryByText('No se pudo cambiar el idioma')).not.toBeInTheDocument()
      network.verify()
    } finally { act(remove) }
  })
}

test('cached bundles still announce each completed language switch', async () => {
  mount()
  const loader = async () => ({})
  const remove = registerLocaleBundles('pages.console-settings-page', { es: loader, en: loader })
  try {
    for (const [from, to] of [['es', 'en'], ['en', 'es']] as const) {
      fireEvent.change(screen.getByRole('combobox', { name: from === 'es' ? 'Idioma' : 'Language' }), { target: { value: to } })
      await waitFor(() => expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(to === 'es' ? 'Idioma de la interfaz cambiado a Español.' : 'Interface language changed to English.'))
    }
  } finally { act(remove) }
})
