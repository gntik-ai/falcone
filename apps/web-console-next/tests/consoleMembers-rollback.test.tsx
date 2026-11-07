import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import { login, strictFetch, tenantUrl } from './shell-support'
vi.mock('../src/shell/routes', async (importOriginal) => {
  const module = await importOriginal<typeof import('../src/shell/routes')>()
  return { ...module, pendingConsoleRoutes: module.pendingConsoleRoutes.map((route) => route.path === 'members' ? { ...route, migrated: undefined } : route) }
})
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'
test('clearing migrated alone restores pendingPage and legacy routing without members calls', async () => {
  await import('../src/pages/pendingPage'); login()
  const requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/members']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Página pendiente' }, { timeout: 5000 })).toBeVisible()
  expect(isMigratedRoute('/console/members')).toBe(false)
  expect(screen.getAllByRole('link', { name: 'Miembros' })[0]).toHaveAttribute('href', '/console/members')
  expect(requests.mock.mock.calls.filter(([url]) => /\/v1\/(?:iam|metrics|tenants\/[^/]+\/(?:users|invitations))/.test(String(url)))).toEqual([])
  requests.verify()
})
