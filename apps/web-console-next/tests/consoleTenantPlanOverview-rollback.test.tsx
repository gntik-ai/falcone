import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import { login, strictFetch, tenantUrl } from './shell-support'

vi.mock('../src/shell/routes', async (importOriginal) => {
  const module = await importOriginal<typeof import('../src/shell/routes')>()
  return { ...module, pendingConsoleRoutes: module.pendingConsoleRoutes.map((route) =>
    route.path === 'my-plan' ? { ...route, migrated: undefined } : route) }
})
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'

test('reverting the migration flag restores pendingPage and legacy anchors without plan requests', async () => {
  await import('../src/pages/pendingPage')
  login()
  const requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/my-plan']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Página pendiente' }, { timeout: 5000 })).toBeVisible()
  expect(isMigratedRoute('/console/my-plan')).toBe(false)
  expect(isMigratedRoute('/console/my-plan/allocation')).toBe(true)
  const nav = screen.getAllByRole('link', { name: 'Mi plan' })
  expect(nav.length).toBeGreaterThan(0)
  for (const link of nav) expect(link).toHaveAttribute('href', '/console/my-plan')
  expect(requests.mock.mock.calls.filter(([url]) => String(url).includes('/plan'))).toEqual([])
  requests.verify()
})
