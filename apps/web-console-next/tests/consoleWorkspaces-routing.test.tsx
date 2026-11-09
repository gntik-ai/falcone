import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures'
import { App } from '../src/App'
import { login, strictFetch, workspaceUrl } from './shell-support'
import { isMigratedRoute } from '../src/shell/navigation'
import { tenant, tenantId, available, quotasPath, overviewPath, createPath, success } from './parity/pages/console-workspaces-page.manifest'
import es from '../src/locales/es/pages.console-workspaces-page.json'
import en from '../src/locales/en/pages.console-workspaces-page.json'
import commonEn from '../src/locales/en/common.json'
import realtimeEs from '../src/locales/es/pages.console-realtime-page.json'
import i18n from '../src/i18n'
let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
function setup(overrides = {}) {
  login(['tenant_admin'], [tenantId])
  requests = strictFetch({ [`GET /v1/tenants/${tenantId}`]: { tenant }, [`GET ${workspaceUrl(tenantId)}`]: { items: [] }, [`GET ${quotasPath}`]: available, [`GET ${overviewPath}`]: { hardLimitDimensions: [] }, [`POST ${createPath}`]: success, ...overrides })
}
const open = (path: string) => render(<StrictMode><MemoryRouter basename="/next" initialEntries={[`/next${path}`]}><App /></MemoryRouter></StrictMode>)
async function finish() {
  await waitFor(() => expect(screen.getByRole('region', { name: 'Contexto activo' })).toHaveAttribute('aria-busy', 'false'))
  fireEvent.click(await screen.findByRole('button', { name: es.create }, { timeout: 10000 })); await waitFor(() => expect(screen.getByRole('button', { name: es.next })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: es.next })); const field = screen.getByRole('textbox', { name: new RegExp(es.nameLabel) }); fireEvent.change(field, { target: { value: 'Synthetic workspace' } })
  await waitFor(() => expect(screen.getByRole('button', { name: es.next })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: es.next })); fireEvent.click(screen.getByRole('button', { name: es.next })); fireEvent.click(screen.getByRole('button', { name: es.finish }))
}
test('arrives in-app from overview through the migrated /next shell link', async () => {
  setup(); open('/console/overview'); expect(isMigratedRoute('/console/workspaces')).toBe(true)
  await waitFor(() => expect(document.querySelector('a[href="/next/console/workspaces"]')).toBeInTheDocument()); const link = document.querySelector('a[href="/next/console/workspaces"]')!; fireEvent.click(link); await screen.findByRole('heading', { name: es.title }, { timeout: 10000 })
  const shellReads = new Set([`/v1/tenants/${tenantId}`, workspaceUrl(tenantId)])
  await waitFor(() => expect(requests.mock.mock.calls.map(([path]) => path).filter((path) => !shellReads.has(String(path)))).toEqual([quotasPath, overviewPath]))
})
test.each([403, 404])('preserves the legacy inventory handoff from realtime %s while shell navigation stays migrated', async (status) => {
  setup({
    [`GET ${workspaceUrl(tenantId)}`]: { items: [{ workspaceId: 'synthetic-workspace', tenantId, displayName: 'Synthetic workspace' }] },
    'GET /v1/tenant/effective-capabilities': { capabilities: { realtime: true } },
    'GET /v1/workspaces/synthetic-workspace/realtime': () => Response.json({ code: `HTTP_${status}` }, { status }),
  })
  open('/console/workspaces/synthetic-workspace/realtime')
  const page = await screen.findByRole('heading', { name: status === 403 ? realtimeEs.noAccess : realtimeEs.notFound }, { timeout: 10000 })
  expect(within(page.closest('.console-realtime')!).getByRole('link', { name: realtimeEs.back })).toHaveAttribute('href', '/console/workspaces')
  expect(document.querySelector('nav a[href="/next/console/workspaces"]')).toBeInTheDocument()
  expect(requests.mock.mock.calls.some(([path]) => path === quotasPath || path === overviewPath)).toBe(false)
})
test('a failed create refresh redirects to login with basename intent and never resends', async () => {
  setup({ [`POST ${createPath}`]: () => Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }), 'POST /v1/auth/login-sessions/synthetic-session/refresh': () => Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }), 'GET /v1/auth/signups/policy': { selfServiceEnabled: false, mode: 'invitation' } }); open('/console/workspaces'); await finish(); await screen.findByLabelText('Usuario', {}, { timeout: 10000 })
  expect(readProtectedRouteIntent()).toBe('/next/console/workspaces'); expect(requests.mock.mock.calls.filter(([path]) => path === createPath)).toHaveLength(1); expect(requests.mock.mock.calls.filter(([path]) => String(path).endsWith('/refresh'))).toHaveLength(1)
})
test('successful create refresh remains on workspaces, retries once and shows the success toast', async () => {
  let count = 0
  setup({ [`POST ${createPath}`]: () => ++count === 1 ? Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }) : Response.json(success), 'POST /v1/auth/login-sessions/synthetic-session/refresh': buildConsoleRefreshSessionFixture() }); open('/console/workspaces'); await finish(); await within(await screen.findByTestId('workspace-create-success')).findByRole('heading', { name: es.successTitle }); expect(screen.queryByLabelText('Usuario')).toBeNull(); expect(count).toBe(2)
})
test('renders English with no stored locale and switches the page to Spanish', async () => {
  // The singleton is already initialized by test setup; the app's unchanged initialLocale picks en.
  await i18n.changeLanguage('en'); localStorage.removeItem('falcone-next-locale'); setup(); open('/console/workspaces'); await screen.findByRole('heading', { name: en.title }, { timeout: 10000 }); expect(document.documentElement.lang).toBe('en')
  await waitFor(() => expect(screen.getByRole('region', { name: commonEn.shell.context })).toHaveAttribute('aria-busy', 'false'))
  // The u0 kit switcher's built-in empty label is covered by the existing overview parity fixture.
  expect(screen.getByRole('button', { name: commonEn.shell.workspace })).toHaveTextContent('Select workspace')
  fireEvent.click(screen.getByRole('button', { name: 'User menu' })); fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'es' } }); await screen.findByRole('heading', { name: es.title }); expect(document.documentElement.lang).toBe('es')
  expect(screen.getByRole('button', { name: es.create })).toBeVisible()
  expect(screen.getByRole('heading', { name: es.inventory })).toBeVisible()
})
