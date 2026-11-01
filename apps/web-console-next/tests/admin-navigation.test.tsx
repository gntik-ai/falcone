import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { persistConsoleShellSession } from '@in-falcone/console-api/session'
import { MemoryRouter, useHref, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { App } from '../src/App'
import i18n from '../src/i18n'
import { login, strictFetch, tenantUrl } from './shell-support'

let requests: ReturnType<typeof strictFetch>
let visited: string[]
beforeEach(() => {
  visited = []
  // JSDOM lacks PointerEvent; keyboard activation in Base UI dispatches a click with it.
  vi.stubGlobal('PointerEvent', MouseEvent)
})
afterEach(() => { requests?.verify(); vi.unstubAllGlobals() })

function CurrentLocation() {
  visited.push(useHref(useLocation()))
  return null
}
function open(path = '/console/overview') {
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  return render(<MemoryRouter basename="/next" initialEntries={[`/next${path}`]}><CurrentLocation /><App /></MemoryRouter>)
}
const copy = {
  en: { admin: 'Admin console', console: 'Console', about: 'About', signOut: 'Sign out', trigger: 'User menu' },
  es: { admin: 'Consola de administración', console: 'Consola', about: 'Acerca de', signOut: 'Cerrar sesión', trigger: 'Menú de usuario' }
} as const

describe.each(['en', 'es'] as const)('administrator navigation in %s', (locale) => {
  const text = copy[locale]
  beforeEach(async () => { await i18n.changeLanguage(locale); login(['superadmin']) })

  test('console menu puts Admin console before About and navigates within the basename', async () => {
    const assign = vi.fn()
    vi.stubGlobal('window', Object.create(window, { location: { value: { ...window.location, assign } } }))
    open()
    fireEvent.click(await screen.findByRole('button', { name: text.trigger }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([text.admin, text.about, text.signOut])
    fireEvent.click(screen.getByRole('menuitem', { name: text.admin }))
    await waitFor(() => expect(visited.at(-1)).toBe('/next/admin'))
    expect(assign).not.toHaveBeenCalled()
  })

  test('admin menu offers Console and follows the console index redirect within the basename', async () => {
    const assign = vi.fn()
    vi.stubGlobal('window', Object.create(window, { location: { value: { ...window.location, assign } } }))
    open('/admin')
    fireEvent.click(await screen.findByRole('button', { name: text.trigger }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([text.console, text.about, text.signOut])
    expect(screen.queryByRole('menuitem', { name: text.admin })).toBeNull()
    expect(screen.queryByRole('link', { name: text.admin })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: text.console }))
    await waitFor(() => expect(visited).toContain('/next/console'))
    await waitFor(() => expect(visited.at(-1)).toBe('/next/console/overview'))
    expect(assign).not.toHaveBeenCalled()
  })

  test.each(['/console/overview', '/console/settings'])('topbar link at %s has a hidden icon and navigates within the basename', async (path) => {
    const assign = vi.fn()
    vi.stubGlobal('window', Object.create(window, { location: { value: { ...window.location, assign } } }))
    open(path)
    const link = await screen.findByRole('link', { name: text.admin })
    expect(link).toHaveAttribute('href', '/next/admin')
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    fireEvent.click(link)
    await waitFor(() => expect(visited.at(-1)).toBe('/next/admin'))
    expect(assign).not.toHaveBeenCalled()
  })

  test.each(['platform_admin', 'platform_operator', 'platform_auditor', 'tenant_owner', 'workspace_admin', 'tenant_member', undefined])('hides both entries for %s', async (role) => {
    const session = login(role ? [role] : [])
    if (!role) {
      Reflect.deleteProperty(session.principal!, 'platformRoles')
      persistConsoleShellSession(session)
    }
    open()
    fireEvent.click(await screen.findByRole('button', { name: text.trigger }))
    expect(screen.queryByRole('link', { name: text.admin })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: text.admin })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: text.console })).toBeNull()
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([text.about, text.signOut])
  })

  test.each([
    { path: '/console/overview', label: text.admin, destination: '/next/admin' },
    { path: '/admin', label: text.console, destination: '/next/console/overview' }
  ])('keyboard menu at $path focuses a named item and navigates in-router on Enter', async ({ path, label, destination }) => {
    const assign = vi.fn()
    vi.stubGlobal('window', Object.create(window, { location: { value: { ...window.location, assign } } }))
    open(path)
    const trigger = await screen.findByRole('button', { name: text.trigger })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const item = await screen.findByRole('menuitem', { name: label })
    await waitFor(() => expect(item).toHaveFocus())
    // Exercise roving focus through the real menu rather than focusing the item directly.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    await waitFor(() => expect(screen.getByRole('menuitem', { name: text.about })).toHaveFocus())
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    await waitFor(() => expect(item).toHaveFocus())
    expect(document.activeElement).toHaveAccessibleName(label)
    fireEvent.keyDown(document.activeElement!, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(visited.at(-1)).toBe(destination))
    if (path === '/admin') expect(visited).toContain('/next/console')
    expect(assign).not.toHaveBeenCalled()
  })

  test('both navigation keys resolve from this locale without fallback', () => {
    expect(i18n.t('shell.adminConsole', { lng: locale, fallbackLng: [] })).toBe(text.admin)
    expect(i18n.t('shell.backToConsole', { lng: locale, fallbackLng: [] })).toBe(text.console)
    expect(i18n.getResource(locale, 'common', 'shell.adminConsole')).toBe(text.admin)
    expect(i18n.getResource(locale, 'common', 'shell.backToConsole')).toBe(text.console)
  })
})
