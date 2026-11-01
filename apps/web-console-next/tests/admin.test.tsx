import { buildConsoleSignupPolicyFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { App } from '../src/App'
import i18n from '../src/i18n'
import { login, strictFetch, tenantUrl } from './shell-support'

let requests: ReturnType<typeof strictFetch>
let visited: string[]
beforeEach(() => { visited = [] })
afterEach(() => requests?.verify())

function CurrentLocation() {
  const { pathname } = useLocation()
  visited.push(pathname)
  return null
}
function open(path: string, basename?: string) {
  return render(<MemoryRouter basename={basename} initialEntries={[path]}><CurrentLocation /><App /></MemoryRouter>)
}
const copy = {
  es: { header: 'Consola de administración', back: 'Volver a la consola', overview: 'Vista general', userMenu: 'Menú de usuario', icon: 'Consola' },
  en: { header: 'Administrator console', back: 'Back to console', overview: 'Overview', userMenu: 'User menu', icon: 'Console' }
} as const

describe.each(['es', 'en'] as const)('superadmin at /admin in %s', (locale) => {
  const text = copy[locale]
  beforeEach(async () => { await i18n.changeLanguage(locale) })

  test.each(['/', '/next'])('renders the administrator shell and landing under base %s', async (base) => {
    login(['superadmin'])
    requests = strictFetch({})
    open(`${base === '/' ? '' : base}/admin`, base)
    expect(await screen.findByRole('heading', { level: 1, name: text.header })).toBeVisible()
    // One occurrence is the topbar title, the other is the landing heading.
    expect(screen.getAllByText(text.header)).toHaveLength(2)
    expect(screen.getByRole('button', { name: text.userMenu })).toBeVisible()
    // The CSP/browser route sweep looks for the same console icon the /console shell renders.
    expect(screen.getByRole('img', { name: text.icon })).toBeVisible()
    expect(document.querySelector('[aria-label="Active context"], [aria-label="Contexto activo"]')).toBeNull()
    expect(screen.queryByRole('button', { name: text.overview })).toBeNull()
    expect(screen.getByRole('link', { name: text.back })).toHaveAttribute('href', base === '/' ? '/console' : '/next/console')
  })

  test('Back to console navigates to /console, where the index redirect applies', async () => {
    login(['superadmin'])
    requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
    open('/admin')
    fireEvent.click(await screen.findByRole('link', { name: text.back }))
    await waitFor(() => expect(visited).toContain('/console'))
    await waitFor(() => expect(visited.at(-1)).toBe('/console/overview'))
  })
})

describe.each(['tenant_owner', 'workspace_admin', 'tenant_member'])('%s at /admin', (role) => {
  beforeEach(async () => { await i18n.changeLanguage('en') })

  test('sees the 403 state without admin content and without any request', async () => {
    login([role])
    requests = strictFetch({})
    open('/admin')
    expect(await screen.findByText('403')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Back to console' })).toBeVisible()
    expect(screen.queryByText('Administrator console')).toBeNull()
    expect(screen.queryByText(/being built/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Overview' })).toBeNull()
  })

  test('Back to console navigates to exactly /console', async () => {
    login([role])
    requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
    open('/admin')
    fireEvent.click(await screen.findByRole('button', { name: 'Back to console' }))
    await waitFor(() => expect(visited).toContain('/console'))
  })
})

test('existing /console forbidden states keep the Overview action to /console/overview', async () => {
  await i18n.changeLanguage('en')
  login(['tenant_owner'])
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  open('/console/plans')
  expect(await screen.findByText('403')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Back to console' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Overview' }))
  await waitFor(() => expect(visited.at(-1)).toBe('/console/overview'))
})

test.each(['/', '/next'])('an unauthenticated /admin visit goes to login and stores the admin intent under %s', async (base) => {
  requests = strictFetch({ 'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture() })
  const prefix = base === '/' ? '' : base
  open(`${prefix}/admin`, base)
  expect(await screen.findByRole('heading', { name: 'Accede a In Falcone Console' })).toBeVisible()
  expect(readProtectedRouteIntent()).toBe(`${prefix}/admin`)
})
