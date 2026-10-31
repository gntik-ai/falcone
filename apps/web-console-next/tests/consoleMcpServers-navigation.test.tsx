import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { App } from '../src/App'
import i18n from '../src/i18n'
import { navigation } from '../src/shell/navigation'
import { buildBreadcrumbs } from '../src/shell/breadcrumbs'
import { pendingConsoleRoutes } from '../src/shell/routes'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { server, detailPath } from './parity/pages/console-mcp-server-detail-page.manifest'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const cases = ['es', 'en'].flatMap((locale) => ['superadmin', 'tenant_viewer', 'workspace_viewer'].flatMap((role) => ['', '/srv_1'].map((suffix) => ({ locale, role, suffix }))))
test.each(cases)('MCP navigation stays current and available on $suffix for $role in $locale', async ({ locale, role, suffix }) => {
  await i18n.changeLanguage(locale); login([role])
  requests = strictFetch({
    [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(),
    'GET /v1/mcp/workspaces/synthetic-workspace/servers': { items: [] }, [`GET ${detailPath}`]: server,
  })
  render(<MemoryRouter initialEntries={[`/console/mcp/servers${suffix}`]}><App /></MemoryRouter>)
  const nav = await screen.findByRole('navigation', { name: locale === 'es' ? 'Navegación de consola' : 'Console navigation' })
  const link = within(nav).getByRole('link', { name: locale === 'es' ? 'Servidores MCP' : 'MCP servers' })
  expect(link).toHaveAttribute('aria-current', 'page')
  expect(link.closest('ul')).toHaveAccessibleName(locale === 'es' ? 'Funciones' : 'Functions')
  await screen.findByRole('heading', { name: suffix ? 'Acme Orders' : locale === 'es' ? 'No hay servidores MCP' : 'No MCP servers' }, { timeout: 5000 })
}, 15000)

test('the entry and both MCP routes preserve the unguarded detail access model', () => {
  const entry = navigation.find(({ key }) => key === 'mcp-servers')
  expect(entry).toBeDefined()
  expect(entry).toMatchObject({ group: 'functions', path: '/console/mcp/servers' })
  for (const key of ['exactActive', 'requiresSuperadminAccess', 'requiresPlatformInventoryAccess', 'restrictedForAction']) expect(entry).not.toHaveProperty(key)
  for (const path of ['mcp/servers', 'mcp/servers/:mcpServerId']) expect(pendingConsoleRoutes.find((route) => route.path === path)).not.toHaveProperty('guard')
})

test.each(['es', 'en'])('MCP breadcrumbs include a linked list and decoded server id in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const t = i18n.getFixedT(locale, 'common')
  const title = locale === 'es' ? 'Servidores MCP' : 'MCP servers'
  expect(buildBreadcrumbs('/console/mcp/servers', t)).toEqual([{ label: t('shell.console'), href: '/console/overview' }, { label: title, href: undefined }])
  expect(buildBreadcrumbs('/console/mcp/servers/srv%2F1', t)).toEqual([
    { label: t('shell.console'), href: '/console/overview' }, { label: title, href: '/console/mcp/servers' },
    { label: locale === 'es' ? 'Servidor srv/1' : 'Server srv/1' },
  ])
})
