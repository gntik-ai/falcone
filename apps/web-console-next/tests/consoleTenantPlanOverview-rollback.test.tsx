import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../src/App'
import { login, strictFetch, tenantUrl } from './shell-support'
import { isMigratedRoute } from '../src/shell/navigation'
import pending from '../src/locales/es/pendingPage.json'

vi.mock('../src/shell/routes', async (original) => {
  const module = await original<typeof import('../src/shell/routes')>()
  return { ...module, pendingConsoleRoutes: module.pendingConsoleRoutes.map((route) => route.path === 'my-plan' ? { ...route, migrated: undefined } : route) }
})

test('removing the migration flag renders pendingPage and restores legacy My plan anchors', async () => {
  login(['tenant_viewer'], [])
  const requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  const page = render(<MemoryRouter basename="/next" initialEntries={['/next/console/my-plan']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { level: 1, name: pending.title }, { timeout: 5000 })).toBeVisible()
  expect(isMigratedRoute('/console/my-plan')).toBe(false)
  expect(isMigratedRoute('/console/my-plan/allocation')).toBe(true)
  for (const link of screen.getAllByRole('link', { name: 'Mi plan', hidden: true })) expect(link).toHaveAttribute('href', '/console/my-plan')
  expect(requests.mock.mock.calls.filter(([url]) => String(url).includes('/plan/'))).toHaveLength(0)
  page.unmount()
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/overview']}><App /></MemoryRouter>)
  await screen.findByRole('heading', { level: 1, name: 'Vista general de la consola' }, { timeout: 5000 })
  for (const link of screen.getAllByRole('link', { name: 'Mi plan', hidden: true })) expect(link).toHaveAttribute('href', '/console/my-plan')
  requests.verify()
})
