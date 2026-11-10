import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture, buildWorkspaceFixture } from '@in-falcone/console-api/fixtures'
import { readConsoleShellSession, readProtectedRouteIntent, subscribeConsoleSessionInvalidated } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import { changeLocale } from '../src/i18n'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { listBody, secretsPath, secret } from './parity/pages/console-workspace-secrets-page.manifest'
import { pendingConsoleRoutes } from '../src/shell/routes'
import { isMigratedRoute } from '../src/shell/navigation'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const calls = () => requests.mock.mock.calls
const routeWait = { timeout: 5000 }
const base = (extra: Record<string, unknown> = {}) => ({
  [`GET ${tenantUrl}`]: buildTenantCollectionFixture(),
  'GET /v1/tenants/synthetic-tenant': buildTenantCollectionFixture().items[0],
  [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(),
  'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture(),
  ...extra,
})
function Where() { const { pathname } = useLocation(); return <output aria-label="Current location">{pathname}</output> }
function open(basename?: string) { return render(<MemoryRouter basename={basename} initialEntries={[`${basename ?? ''}/console/workspace-secrets`]}><Where /><App /></MemoryRouter>) }

test.each(['superadmin', 'platform_admin', 'platform_operator', 'tenant_owner'])('%s reaches the page under /next, sends one list request and keeps the route', async (role) => {
  login([role], ['synthetic-tenant'])
  requests = strictFetch(base({ [`GET ${secretsPath}`]: listBody }))
  open('/next')
  expect(await screen.findByText('db_password', {}, routeWait)).toBeVisible()
  expect(screen.getByRole('heading', { level: 1, name: 'Secretos del área de trabajo' })).toBeVisible()
  expect(calls().filter(([url]) => url === secretsPath)).toHaveLength(1)
  expect(screen.getByLabelText('Current location').textContent).toBe('/console/workspace-secrets')
  expect(pendingConsoleRoutes.find(({ path }) => path === 'workspace-secrets')).toMatchObject({ migrated: true, guard: 'secrets' })
  expect(isMigratedRoute('/console/workspace-secrets')).toBe(true)
})

test.each([['es', 'Sin acceso a los secretos del área de trabajo'], ['en', 'No access to workspace secrets']] as const)('a non-member without a privileged role is denied with the guard title in %s and no secrets request', async (locale, title) => {
  await changeLocale(locale)
  // shell.non-member: no privileged role and no workspace membership.
  login(['tenant_viewer'], ['synthetic-tenant'], [])
  requests = strictFetch(base())
  open('/next')
  expect(await screen.findByRole('heading', { name: title }, routeWait)).toBeVisible()
  expect(calls().filter(([url]) => String(url).includes('/secrets'))).toEqual([])
})

test('the sidebar link navigates in-app without a document load', async () => {
  login(['superadmin'], ['synthetic-tenant'])
  requests = strictFetch(base({ [`GET ${secretsPath}`]: listBody, 'GET /v1/platform/runtime/knative': {} }))
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/profile']}><Where /><App /></MemoryRouter>)
  const link = await screen.findByRole('link', { name: /Secretos del área de trabajo/ }, routeWait)
  expect(link.getAttribute('href')).toBe('/next/console/workspace-secrets')
  fireEvent.click(link)
  expect(await screen.findByText('db_password', {}, routeWait)).toBeVisible()
  expect(screen.getByLabelText('Current location').textContent).toBe('/console/workspace-secrets')
})

function refreshSetup(variant: 'ok' | 'after-refresh' | 'rejected') {
  const initial = login(['superadmin'], ['synthetic-tenant'])
  const fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal
  let count = 0
  requests = strictFetch(base({
    [`GET ${secretsPath}`]: () => ++count === 1 || variant !== 'ok' ? Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }) : Response.json(listBody),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': () => variant === 'rejected' ? Response.json({ code: 'REFRESH_REJECTED' }, { status: 400 }) : Response.json(fresh),
  }))
  return { initial, fresh }
}

test.each([['workspace-secrets.list.401-refresh-ok', 'ok'], ['workspace-secrets.list.401-after-refresh', 'after-refresh'], ['workspace-secrets.list.401-refresh-rejected', 'rejected']] as const)('%s under /next refreshes once and sends no write', async (_fixture, variant) => {
  const { initial, fresh } = refreshSetup(variant)
  let invalidations = 0
  const unsubscribe = subscribeConsoleSessionInvalidated(() => invalidations++)
  try {
    open('/next')
    if (variant === 'ok') {
      await screen.findByText('db_password', {}, routeWait)
      expect(screen.getByLabelText('Current location').textContent).toBe('/console/workspace-secrets')
      expect(calls().filter(([url]) => url === secretsPath)).toHaveLength(2)
      expect(invalidations).toBe(0)
    } else {
      await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, routeWait)
      expect(screen.getByLabelText('Current location').textContent).toBe('/login')
      expect(readProtectedRouteIntent()).toBe('/next/console/workspace-secrets')
      expect(readConsoleShellSession()).toBeNull()
      expect(calls().filter(([url]) => url === secretsPath)).toHaveLength(variant === 'rejected' ? 1 : 2)
    }
    const refresh = calls().filter(([url]) => String(url).endsWith('/refresh'))
    expect(refresh).toHaveLength(1)
    expect(JSON.parse(String(refresh[0][1]?.body))).toEqual({ refreshToken: initial.tokenSet?.refreshToken })
    expect(calls().filter(([, init]) => init?.method && init.method !== 'GET' && !String(init.method).includes('POST'))).toEqual([])
    expect(calls().filter(([url, init]) => url === secretsPath && init?.method === 'POST')).toEqual([])
    expect(fresh.tokenSet?.accessToken).toBeTruthy()
  } finally { unsubscribe() }
})

test('shell.workspace-switch clears the form values and loads the other workspace once', async () => {
  login(['superadmin'], ['synthetic-tenant'])
  const first = buildWorkspaceFixture()
  const other = { ...first, workspaceId: 'synthetic-other', displayName: 'Other workspace', slug: 'synthetic-other' }
  const otherPath = '/v1/functions/workspaces/synthetic-other/secrets'
  requests = strictFetch(base({
    [`GET ${workspaceUrl('synthetic-tenant')}`]: { items: [first, other], page: { after: null } },
    [`GET ${secretsPath}`]: listBody, [`GET ${otherPath}`]: { items: [secret('other_secret')], page: { size: 25 } },
  }))
  localStorage.setItem('in-falcone.console-active-context', JSON.stringify({ userId: 'synthetic-user', tenantId: 'synthetic-tenant', workspaceId: first.workspaceId, updatedAt: '2026-01-01' }))
  open('/next')
  await screen.findByText('db_password', {}, routeWait)
  fireEvent.change(screen.getByLabelText('Nombre del secreto'), { target: { value: 'half_typed' } })
  fireEvent.change(screen.getByLabelText('Valor del secreto'), { target: { value: 'synthetic-canary-value-7f3a91c2' } })
  fireEvent.click(screen.getByRole('button', { name: /Synthetic Workspace/ }))
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Other workspace' }))
  expect(await screen.findByText('other_secret', {}, routeWait)).toBeVisible()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect((screen.getByLabelText('Nombre del secreto') as HTMLInputElement).value === '').toBe(true)
  expect((screen.getByLabelText('Valor del secreto') as HTMLInputElement).value === '').toBe(true)
  expect(calls().filter(([url]) => url === otherPath)).toHaveLength(1)
  expect(calls().filter(([, init]) => init?.method && init.method !== 'GET')).toEqual([])
})

test('workspace Reintentar sends exactly one list request with the real context', async () => {
  login(['superadmin'], ['synthetic-tenant'])
  let loads = 0
  requests = strictFetch(base({
    [`GET ${workspaceUrl('synthetic-tenant')}`]: () => ++loads === 1 ? Response.json({}, { status: 500 }) : Response.json(buildWorkspaceCollectionFixture()),
    [`GET ${secretsPath}`]: listBody,
  }))
  open('/next')
  const title = await screen.findByRole('heading', { name: 'No se pudieron cargar las áreas de trabajo' }, routeWait)
  expect(screen.getByRole('heading', { level: 1, name: 'Secretos del área de trabajo' })).toBeVisible()
  expect(calls().filter(([url]) => String(url).includes('/secrets'))).toHaveLength(0)
  fireEvent.click(within(title.closest('div')!.parentElement!).getByRole('button', { name: 'Reintentar' }))
  await screen.findByText('db_password', {}, routeWait)
  expect(loads).toBe(2)
  expect(calls().filter(([url]) => url === secretsPath)).toHaveLength(1)
  // Reintentar reloads the workspaces only: the tenant list is read exactly once, at bootstrap.
  expect(calls().filter(([url]) => String(url).split('?')[0] === String(tenantUrl).split('?')[0])).toHaveLength(1)
})

test('the active-workspace shell loading state shows no secrets request', async () => {
  login(['superadmin'], ['synthetic-tenant'])
  let release = () => {}
  requests = strictFetch(base({ [`GET ${workspaceUrl('synthetic-tenant')}`]: () => new Promise<Response>((resolve) => { release = () => resolve(Response.json({ items: [], page: { after: null } })) }) }))
  open('/next')
  expect(await screen.findAllByText('Cargando áreas de trabajo', {}, routeWait)).not.toHaveLength(0)
  expect(calls().filter(([url]) => String(url).includes('/secrets'))).toHaveLength(0)
  await act(async () => { release() })
})
