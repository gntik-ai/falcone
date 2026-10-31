import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { readConsoleShellSession } from '@in-falcone/console-api/session'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-mcp-servers-page.json'
import en from '../src/locales/en/pages.console-mcp-servers-page.json'
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { server } from './parity/pages/console-mcp-server-detail-page.manifest'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
test('the migrated list reads once and its encoded row link opens the existing detail without a document reload', async () => {
  expect(isMigratedRoute('/console/mcp/servers')).toBe(true)
  login(['tenant_viewer'])
  requests = strictFetch({
    [`GET ${tenantUrl}`]: buildTenantCollectionFixture(),
    [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(),
    'GET /v1/mcp/workspaces/synthetic-workspace/servers': { items: [
      { serverId: 'srv/1', name: 'Orders', status: 'published', lifecycleStatus: 'active', version: 'v3' },
      { serverId: 'srv_2', name: '', status: 'draft', lifecycleStatus: 'active', version: null },
    ] },
    'GET /v1/mcp/workspaces/synthetic-workspace/servers/srv%2F1': server,
  })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/mcp/servers']}><App /></MemoryRouter>)
  const table = await screen.findByRole('table', {}, { timeout: 5000 })
  expect(within(table).getAllByRole('row')).toHaveLength(3)
  expect(within(table).getByRole('link', { name: 'srv_2' })).toBeVisible()
  expect(within(table).getByText('Publicado')).toBeVisible()
  expect(isMigratedRoute('/console/mcp/servers')).toBe(true)
  expect(requests.mock.mock.calls.filter(([url]) => String(url).endsWith('/servers'))).toHaveLength(1)
  const link = within(table).getByRole('link', { name: 'Orders' })
  expect(link).toHaveAttribute('href', '/next/console/mcp/servers/srv%2F1')
  const location = window.location.href
  expect(fireEvent.click(link)).toBe(false)
  expect(await screen.findByRole('heading', { name: 'Acme Orders' }, { timeout: 5000 })).toBeVisible()
  expect(window.location.href).toBe(location)
}, 15000)

function CurrentLocation() { return <output aria-label="Current location">{useLocation().pathname}</output> }
test.each(['es', 'en'])('repeated endpoint 401 renders the page state in %s and preserves the session and route', async (locale) => {
  await i18n.changeLanguage(locale)
  const session = login(['tenant_viewer']), copy = locale === 'es' ? es : en
  requests = strictFetch({
    [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(),
    'GET /v1/mcp/workspaces/synthetic-workspace/servers': () => Response.json({}, { status: 401 }),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': session,
  })
  render(<MemoryRouter initialEntries={['/console/mcp/servers']}><CurrentLocation /><App /></MemoryRouter>)
  expect(await screen.findByText(copy.errors['401'], {}, { timeout: 5000 })).toBeVisible()
  expect(screen.getByLabelText('Current location')).toHaveTextContent('/console/mcp/servers')
  expect(readConsoleShellSession()).toMatchObject({ sessionId: session.sessionId, authenticationState: 'active', principal: session.principal, tokenSet: session.tokenSet })
  expect(requests.mock.mock.calls.filter(([url]) => String(url).endsWith('/servers'))).toHaveLength(2)
  expect(requests.mock.mock.calls.filter(([url]) => String(url).endsWith('/refresh'))).toHaveLength(1)
}, 15000)
