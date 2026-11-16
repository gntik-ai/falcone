import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { readConsoleShellSession, subscribeConsoleSessionInvalidated } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { fixtures, paths } from './parity/pages/console-kafka-page.manifest'
import es from '../src/locales/es/pages.console-kafka-page.json'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const shell = () => ({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), 'GET /v1/tenants/synthetic-tenant': buildTenantCollectionFixture().items[0], [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(), 'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture() })
const defaults = () => ({ ...shell(), [`GET ${paths.inventory}`]: fixtures['kafka:inventory-3-with-bridges'], [`GET ${paths.bridge}`]: fixtures['kafka:bridge-1'], [`GET ${paths.detail}`]: fixtures['kafka:topic-detail'], [`GET ${paths.access}`]: fixtures['kafka:topic-access'], [`GET ${paths.metadata}`]: fixtures['kafka:topic-metadata'] })
function Where() { return <output aria-label="Current location">{useLocation().pathname}</output> }
function Entry() { const navigate = useNavigate(); return <><NavLink to="/console/kafka">Open Kafka link</NavLink><button onClick={() => navigate('/console/kafka')}>Open Kafka button</button></> }
function open(path = '/console/kafka') { return render(<MemoryRouter initialEntries={[path]}><Where /><Routes><Route path="/entry" element={<Entry />} /><Route path="*" element={<App />} /></Routes></MemoryRouter>) }
const pageCalls = () => requests.mock.mock.calls.filter(([path]) => String(path).startsWith('/v1/events/') || String(path).endsWith('/refresh'))
const unauthorized = () => Response.json({ requestId: 'kafka-replay-id' }, { status: 401 })

test.each(['link', 'button'])('the migrated route loads its lazy page through a %s', async (kind) => {
  login(); requests = strictFetch(defaults()); open('/entry'); fireEvent.click(screen.getByRole(kind, { name: kind === 'link' ? 'Open Kafka link' : 'Open Kafka button' }))
  expect(await screen.findByRole('heading', { name: es.kafkaEvents }, { timeout: 10000 })).toBeVisible()
  expect(await screen.findByRole('button', { name: 'orders.created' })).toBeVisible()
  expect(isMigratedRoute('/console/kafka')).toBe(true); expect(screen.getByLabelText('Current location')).toHaveTextContent('/console/kafka')
})
test.each(['tenant_viewer', 'tenant_owner', 'workspace_viewer'])('authenticated %s can reach Kafka without a page guard', async (role) => {
  login([role], ['synthetic-tenant']); requests = strictFetch(defaults()); open(); expect(await screen.findByRole('button', { name: 'orders.created' }, { timeout: 10000 })).toBeVisible()
})
test.each(['tenant-none', 'workspace-none'])('%s permits shell bootstrap and sends zero Kafka requests', async (variant) => {
  login(); requests = strictFetch({ ...shell(), ...(variant === 'tenant-none' ? { [`GET ${tenantUrl}`]: { items: [] } } : { [`GET ${workspaceUrl('synthetic-tenant')}`]: { items: [] } }) }); open()
  expect(await screen.findByRole('heading', { name: variant === 'tenant-none' ? es.selectAnOrganizationToContinue : es.selectAWorkspace }, { timeout: 10000 })).toBeVisible()
  expect(pageCalls()).toHaveLength(0)
})
test.each([false, true])('inventory 401 refresh rejected=%s performs exactly the allowed refresh and replay', async (rejected) => {
  const initial = login(), refreshed = buildConsoleRefreshSessionFixture(); refreshed.principal = initial.principal; let attempts = 0
  requests = strictFetch({ ...defaults(), [`GET ${paths.inventory}`]: () => ++attempts === 1 ? unauthorized() : Response.json(fixtures['kafka:inventory-empty']), [`POST ${paths.refresh}`]: () => rejected ? Response.json({}, { status: 400 }) : Response.json(refreshed) }); open()
  if (rejected) { await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, { timeout: 10000 }); expect(screen.getByLabelText('Current location')).toHaveTextContent('/login') }
  else { await screen.findByText(es.thereAreNoTopicsInThisWorkspace, undefined, { timeout: 10000 }); expect(screen.getByLabelText('Current location')).toHaveTextContent('/console/kafka') }
  expect(pageCalls().map(([path, init]) => `${init?.method ?? 'GET'} ${path}`)).toEqual([`GET ${paths.inventory}`, `POST ${paths.refresh}`, ...(rejected ? [] : [`GET ${paths.inventory}`])])
  if (!rejected) expect(new Headers(pageCalls()[2][1]?.headers).get('Authorization')).toBe(`Bearer ${refreshed.tokenSet?.accessToken}`)
})
test.each(['inventory', 'detail', 'access', 'metadata'] as const)('%s replay 401 shows a section error and preserves the refreshed session without invalidation or redirect', async (section) => {
  const initial = login(), refreshed = buildConsoleRefreshSessionFixture(); refreshed.principal = initial.principal
  let invalidations = 0; const unsubscribe = subscribeConsoleSessionInvalidated(() => invalidations++)
  requests = strictFetch({ ...defaults(), [`GET ${paths[section]}`]: unauthorized, [`POST ${paths.refresh}`]: refreshed }); open()
  try {
    if (section !== 'inventory') {
      fireEvent.click(await screen.findByRole('button', { name: 'orders.created' }, { timeout: 10000 }));
      if (section !== 'detail') fireEvent.click(await screen.findByRole('tab', { name: es.tabs[section] }))
    }
    expect(await screen.findByText(es.errors.unauthorized, undefined, { timeout: 10000 })).toBeVisible()
    expect(readConsoleShellSession()?.tokenSet?.accessToken).toBe(refreshed.tokenSet?.accessToken); expect(invalidations).toBe(0); expect(screen.getByLabelText('Current location')).toHaveTextContent('/console/kafka')
    expect(pageCalls().filter(([path]) => path === paths[section] || path === paths.refresh).map(([path, init]) => `${init?.method ?? 'GET'} ${path}`)).toEqual([`GET ${paths[section]}`, `POST ${paths.refresh}`, `GET ${paths[section]}`])
  } finally { unsubscribe() }
})
