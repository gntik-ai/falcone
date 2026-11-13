import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import { login, strictFetch, tenantUrl } from './shell-support'
vi.mock('../src/shell/routes', async (importOriginal) => {
  const module = await importOriginal<typeof import('../src/shell/routes')>()
  return { ...module, pendingConsoleRoutes: module.pendingConsoleRoutes.map((route) => route.path === 'postgres' ? { ...route, migrated: undefined } : route) }
})
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'
test('removing the postgres flag alone restores the legacy handoff without page requests', async () => {
  await import('../src/pages/pendingPage'); login()
  const server = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/postgres']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Página pendiente' }, { timeout: 5000 })).toBeVisible()
  expect(isMigratedRoute('/console/postgres')).toBe(false)
  expect(screen.getByRole('link', { name: 'PostgreSQL' })).toHaveAttribute('href', '/console/postgres')
  expect(server.mock.mock.calls.map(([path]) => path)).toEqual([tenantUrl]); server.verify()
})
