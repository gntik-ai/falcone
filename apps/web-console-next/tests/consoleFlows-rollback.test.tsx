import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import { login, strictFetch, tenantUrl } from './shell-support'

vi.mock('../src/shell/routes', async (importOriginal) => {
  const module = await importOriginal<typeof import('../src/shell/routes')>()
  return { ...module, pendingConsoleRoutes: module.pendingConsoleRoutes.map((route) =>
    route.path === 'flows' ? { ...route, migrated: undefined } : route) }
})
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'

test('disabling flows restores pendingPage and legacy navigation without flow requests', async () => {
  await import('../src/pages/pendingPage')
  login()
  const requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/flows']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Página pendiente' }, { timeout: 5000 })).toBeVisible()
  expect(isMigratedRoute('/console/flows')).toBe(false)
  expect(screen.getAllByRole('link', { name: /Flujos/ })[0]).toHaveAttribute('href', '/console/flows')
  expect(requests.mock.mock.calls.filter(([url]) => String(url).includes('/flows'))).toEqual([])
  requests.verify()
})
