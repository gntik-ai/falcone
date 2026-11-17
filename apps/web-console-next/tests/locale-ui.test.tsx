import { login, strictFetch, tenantUrl } from './shell-support'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import es from '../src/locales/es/pages.welcome-page.json'
import en from '../src/locales/en/pages.welcome-page.json'
import { App } from '../src/App'
import { changeLocale } from '../src/i18n'
import { registerLocaleBundles } from '../src/i18n/locale-loader'

test.each([
  ['es', 'Acerca de', 'Consola', es.title, es.intro],
  ['en', 'About', 'Console', en.title, en.intro]
] as const)('shell and lazy welcome copy render in %s', async (locale, about, consoleName, title, body) => {
  await changeLocale(locale)
  render(<MemoryRouter><App /></MemoryRouter>)
  expect(screen.getByText(about)).toBeVisible()
  expect(screen.getByRole('img', { name: consoleName })).toBeVisible()
  expect(await screen.findByRole('heading', { name: title })).toBeVisible()
  expect(screen.getByText(body)).toBeVisible()
})

test('the open user menu contains only menu language controls', async () => {
  render(<MemoryRouter initialEntries={['/console/overview']}><App /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Vista general de la consola' })
  fireEvent.click(screen.getByRole('button', { name: 'Menú de usuario' }))
  const menu = screen.getByRole('menu')
  expect(within(menu).queryByRole('combobox')).not.toBeInTheDocument()
  expect(menu.querySelector('select, label')).toBeNull()
  await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Idioma' })).toBeVisible())
})

test('user menu changes the shell and route copy without navigation', async () => {
  render(<MemoryRouter initialEntries={['/console/overview']}><App /></MemoryRouter>)
  expect(localStorage.getItem('falcone-next-locale')).toBeNull()
  expect(await screen.findByRole('heading', { name: 'Vista general de la consola' })).toBeVisible()
  expect(screen.getByRole('navigation', { name: 'Ruta de navegación' })).toBeVisible()
  expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Menú de usuario' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Idioma' }))
  expect(await screen.findByRole('menuitemradio', { name: 'Español' })).toHaveAttribute('aria-checked', 'true')
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Inglés' }))
  expect(await screen.findByRole('heading', { name: 'Console overview' })).toBeVisible()
  expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
  expect(screen.queryByRole('navigation', { name: 'Ruta de navegación' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'User menu' }))
  await waitFor(() => expect(screen.getByRole('menuitem', { name: 'About' })).toBeVisible())
  expect(document.documentElement.lang).toBe('en')
  expect(localStorage.getItem('falcone-next-locale')).toBe('en')
})

test('settings switch changes both controls', async () => {
  render(<MemoryRouter initialEntries={['/console/settings']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Ajustes de consola' })).toBeVisible()
  fireEvent.click(screen.getByRole('combobox', { name: 'Idioma de la interfaz' }))
  const option = within(await screen.findByRole('listbox')).getByRole('option', { name: 'Inglés' })
  fireEvent.pointerDown(option)
  fireEvent.click(option)
  expect(await screen.findByRole('heading', { name: 'Console settings' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'User menu' }))
  expect(screen.getByRole('combobox', { name: 'Interface language' })).toBeVisible()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Language' }))
  expect(await screen.findByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'true')
})

test('language choices are disabled while a locale bundle is loading', async () => {
  let finish!: (bundle: Record<string, unknown>) => void
  let completed!: () => void
  const settled = new Promise<void>((resolve) => { completed = resolve })
  const loads: string[] = []
  const remove = registerLocaleBundles('locale-menu-pending-test', {
    es: async () => { loads.push('es'); return {} },
    en: () => { loads.push('en'); return new Promise<Record<string, unknown>>((resolve) => { finish = resolve }).finally(completed) }
  })
  try {
    render(<MemoryRouter initialEntries={['/console/overview']}><App /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Vista general de la consola' })
    fireEvent.click(screen.getByRole('button', { name: 'Menú de usuario' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Idioma' }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Inglés' }))
    expect(loads).toEqual(['en'])
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Menú de usuario' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Idioma' }))
    const spanish = await screen.findByRole('menuitemradio', { name: 'Español' })
    const english = await screen.findByRole('menuitemradio', { name: 'Inglés' })
    expect(spanish).toHaveAttribute('aria-disabled', 'true')
    expect(english).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(spanish)
    fireEvent.click(english)
    expect(loads).toEqual(['en'])
    expect(localStorage.getItem('falcone-next-locale')).toBeNull()
    await act(async () => { finish({}); await settled })
    await waitFor(() => expect(document.documentElement.lang).toBe('en'))
  } finally {
    if (finish) await act(async () => { finish({}); await settled })
    act(remove)
  }
})

test.each([
  ['es', 'Vista general de la consola', 'Menú de usuario', 'Idioma', 'Español'],
  ['en', 'Console overview', 'User menu', 'Language', 'English']
] as const)('selecting the checked %s language does not reload bundles', async (locale, heading, trigger, language, checked) => {
  await changeLocale(locale)
  const loads: string[] = []
  const remove = registerLocaleBundles('locale-menu-checked-test', {
    es: async () => { loads.push('es'); return {} },
    en: async () => { loads.push('en'); return {} }
  })
  try {
    render(<MemoryRouter initialEntries={['/console/overview']}><App /></MemoryRouter>)
    await screen.findByRole('heading', { name: heading })
    fireEvent.click(screen.getByRole('button', { name: trigger }))
    fireEvent.click(screen.getByRole('menuitem', { name: language }))
    const item = await screen.findByRole('menuitemradio', { name: checked })
    expect(item).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByRole('menuitemradio').map((option) => option.textContent)).toEqual(locale === 'es' ? ['Español', 'Inglés'] : ['Spanish', 'English'])
    await act(async () => { fireEvent.click(item) })
    expect(loads).toEqual([])
    expect(localStorage.getItem('falcone-next-locale')).toBe(locale)
  } finally { act(remove) }
})

for (const role of ['tenant_owner', 'superadmin']) test.each(['ArrowRight', 'Enter'])('keyboard opens the language submenu with %s for ' + role, async (openKey) => {
  login([role])
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  vi.stubGlobal('PointerEvent', MouseEvent)
  try {
    render(<MemoryRouter initialEntries={['/console/overview']}><App /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Vista general de la consola' })
    const trigger = screen.getByRole('button', { name: 'Menú de usuario' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const first = await screen.findByRole('menuitem', { name: role === 'superadmin' ? 'Consola de administración' : 'Acerca de' })
    await waitFor(() => expect(first).toHaveFocus())
    if (role === 'superadmin') {
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
      await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Acerca de' })).toHaveFocus())
    }
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Idioma' })).toHaveFocus())
    fireEvent.keyDown(document.activeElement!, { key: openKey, code: openKey })
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Español' })).toHaveFocus())
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Inglés' })).toHaveFocus())
    fireEvent.keyDown(document.activeElement!, { key: 'Enter', code: 'Enter' })
    expect(await screen.findByRole('heading', { name: 'Console overview' })).toBeVisible()
    expect(document.documentElement.lang).toBe('en')
    expect(localStorage.getItem('falcone-next-locale')).toBe('en')
  } finally { vi.unstubAllGlobals() }
})

test.each([['es', 'Página no encontrada'], ['en', 'Page not found']] as const)('unknown routes render localized 404 in %s', async (locale, title) => {
  await changeLocale(locale)
  render(<MemoryRouter initialEntries={['/missing']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: title })).toBeVisible()
})

let requests: ReturnType<typeof strictFetch>
beforeEach(() => { login(['tenant_owner']); requests = strictFetch({}) })
afterEach(() => requests.verify())
