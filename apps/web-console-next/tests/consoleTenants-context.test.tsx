import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { readConsoleShellSession } from '@in-falcone/console-api/session'
import { ConsoleContextProvider, useConsoleContext } from '../src/shell/context'
import { SessionProvider } from '../src/shell/session'
import { login, renderWithSession, strictFetch, tenantUrl, workspaceUrl } from './shell-support'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
function Probe() {
  const context = useConsoleContext()
  return <><output>{JSON.stringify(context)}</output><button onClick={() => void context.reloadTenants?.()}>Reload</button><button onClick={() => context.selectTenant('t1')}>Select</button></>
}
const tenant = (id: string) => ({ tenantId: id, displayName: id, slug: id })
function open(role = 'superadmin', own: string[] = []) {
  login([role], own)
  renderWithSession(<StrictMode><ConsoleContextProvider><Probe /></ConsoleContextProvider></StrictMode>)
}
const value = () => JSON.parse(screen.getByRole('status').textContent!)

test('StrictMode dedupes bootstrap, retains cursor, and reload bypasses the cache and replaces inventory', async () => {
  let count = 0
  requests = strictFetch({ [`GET ${tenantUrl}`]: () => Response.json(++count === 1 ? { items: [tenant('t1'), tenant('t2')], page: { after: 'next' } } : { items: [tenant('t3')], page: { after: null } }), [`GET ${workspaceUrl('t3')}`]: { items: [] } })
  open()
  await waitFor(() => expect(value().loading).toBe(false))
  expect(count).toBe(1); expect(value().tenantsPageInfo).toEqual({ after: 'next' })
  fireEvent.click(screen.getByText('Reload'))
  await waitFor(() => expect(value().tenants[0].tenantId).toBe('t3'))
  expect(count).toBe(2); expect(value().tenantsPageInfo).toEqual({ after: null })
})
test('tenant operator passes through the singular loader page without a collection request', async () => {
  requests = strictFetch({ 'GET /v1/tenants/t1': { tenant: tenant('t1') }, [`GET ${workspaceUrl('t1')}`]: { items: [] } })
  open('tenant_owner', ['t1'])
  await waitFor(() => expect(value().loading).toBe(false))
  expect(value().tenantsPageInfo).toEqual({ after: null })
  expect(requests.mock.mock.calls.filter(([url]) => url === '/v1/tenants/t1')).toHaveLength(1)
})
test('tenant failures expose only status and request ID, and successful retry clears their own error', async () => {
  let count = 0
  requests = strictFetch({ [`GET ${tenantUrl}`]: () => ++count === 1 ? Response.json({ requestId: 'req_tenants', message: 'PRIVATE' }, { status: 500 }) : Response.json({ items: [], page: { after: null } }) })
  open()
  await waitFor(() => expect(value().tenantsError).toEqual({ status: 500 }))
  expect(value().tenantsRequestId).toBe('req_tenants'); expect(value().error).toEqual({ status: 500 })
  expect(screen.getByRole('status')).not.toHaveTextContent('PRIVATE')
  fireEvent.click(screen.getByText('Reload'))
  await waitFor(() => expect(value().tenantsError).toBeNull())
  expect(value().tenantsRequestId).toBeNull(); expect(value().error).toBeNull()
})
test('workspace failures leave tenant error fields unchanged and tenant success preserves the workspace error', async () => {
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [tenant('t1'), tenant('t2')], page: { after: null } }, [`GET ${workspaceUrl('t1')}`]: () => Response.json({ requestId: 'req_workspace' }, { status: 403 }) })
  open()
  await waitFor(() => expect(value().loading).toBe(false))
  fireEvent.click(screen.getByText('Select'))
  await waitFor(() => expect(value().error).toEqual({ status: 403 }))
  expect(value().tenantsError).toBeNull(); expect(value().tenantsRequestId).toBeNull()
  fireEvent.click(screen.getByText('Reload'))
  await waitFor(() => expect(requests.mock.mock.calls.filter(([url]) => url === tenantUrl)).toHaveLength(2))
  await waitFor(() => expect(value().loading).toBe(false))
  expect(value().error).toEqual({ status: 403 })
})
test('a later reload wins over an older bootstrap or overlapping reload response', async () => {
  const resolvers: ((response: Response) => void)[] = []
  requests = strictFetch({ [`GET ${tenantUrl}`]: () => new Promise<Response>((resolve) => resolvers.push(resolve)) })
  open()
  await waitFor(() => expect(resolvers).toHaveLength(1))
  fireEvent.click(screen.getByText('Reload')); fireEvent.click(screen.getByText('Reload'))
  await waitFor(() => expect(resolvers).toHaveLength(3))
  await act(async () => resolvers[2](Response.json({ items: [], page: { after: 'winner' } })))
  await act(async () => { resolvers[0](Response.json({ items: [tenant('stale')], page: { after: null } })); resolvers[1](Response.json({ items: [tenant('older')], page: { after: null } })) })
  expect(value().tenants).toEqual([]); expect(value().tenantsPageInfo).toEqual({ after: 'winner' })
})
test('a new session bootstrap clears superseded reload loading and ignores its stale response', async () => {
  let count = 0
  let finishReload!: (response: Response) => void
  requests = strictFetch({ [`GET ${tenantUrl}`]: () => {
    if (++count === 2) return new Promise<Response>((resolve) => { finishReload = resolve })
    return Response.json({ items: [tenant('t1'), tenant('t2')], page: { after: count === 1 ? 'initial' : 'current' } })
  } })
  login()
  const tree = () => <StrictMode><SessionProvider value={readConsoleShellSession()}><ConsoleContextProvider><Probe /></ConsoleContextProvider></SessionProvider></StrictMode>
  const view = render(tree())
  await waitFor(() => expect(value().loading).toBe(false))
  expect(count).toBe(1)
  fireEvent.click(screen.getByText('Reload'))
  await waitFor(() => expect(count).toBe(2))
  expect(value().loading).toBe(true)

  // ProtectedRoute supplies a fresh session object on navigation without remounting the provider.
  view.rerender(tree())
  await waitFor(() => expect(value().tenantsPageInfo).toEqual({ after: 'current' }))
  expect(count).toBe(3)
  await waitFor(() => expect(value().loading).toBe(false))
  await act(async () => finishReload(Response.json({ items: [tenant('stale')], page: { after: 'stale' } })))
  expect(value().tenants.map((item: { tenantId: string }) => item.tenantId)).toEqual(['t1', 't2'])
  expect(value().tenantsPageInfo).toEqual({ after: 'current' })
  expect(value().loading).toBe(false)
})
test('an older reload finishing cannot clear loading for the current reload', async () => {
  const resolvers: ((response: Response) => void)[] = []
  requests = strictFetch({ [`GET ${tenantUrl}`]: () => new Promise<Response>((resolve) => resolvers.push(resolve)) })
  open()
  await waitFor(() => expect(resolvers).toHaveLength(1))
  await act(async () => resolvers[0](Response.json({ items: [], page: { after: null } })))
  await waitFor(() => expect(value().loading).toBe(false))
  fireEvent.click(screen.getByText('Reload')); fireEvent.click(screen.getByText('Reload'))
  await waitFor(() => expect(resolvers).toHaveLength(3))
  await act(async () => resolvers[1](Response.json({ items: [tenant('stale')], page: { after: 'stale' } })))
  expect(value().loading).toBe(true)
  expect(value().tenants).toEqual([])
  await act(async () => resolvers[2](Response.json({ items: [], page: { after: 'current' } })))
  await waitFor(() => expect(value().loading).toBe(false))
  expect(value().tenantsPageInfo).toEqual({ after: 'current' })
})
