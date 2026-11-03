import { act, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { CapabilitiesProvider, useCapabilities, useCapabilityGate } from '../src/shell/capabilities'
import { login, strictFetch } from './shell-support'
const context = vi.hoisted(() => ({ activeTenantId: 't1' as string | null, loading: false }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context }))
let requests: ReturnType<typeof strictFetch>
afterEach(() => { requests?.verify(); context.activeTenantId = 't1'; vi.unstubAllGlobals() })
function Consumer({ id = 'gate' }: { id?: string }) {
  const gate = useCapabilityGate('realtime')
  // @ts-expect-error Phantom catalog keys cannot gate a page.
  const phantom = useCapabilityGate('invented_key')
  const state = useCapabilities()
  return <output data-testid={id}>{JSON.stringify({ gate, phantom, error: Boolean(state.error) })}</output>
}
const result = (id = 'gate') => JSON.parse(screen.getByTestId(id).textContent!)

test('provider mount and tenant changes without a consumer send no request', () => {
  login(); requests = strictFetch({})
  const view = render(<StrictMode><CapabilitiesProvider><span /></CapabilitiesProvider></StrictMode>)
  context.activeTenantId = 't2'; view.rerender(<StrictMode><CapabilitiesProvider><span /></CapabilitiesProvider></StrictMode>)
  expect(requests.mock).not.toHaveBeenCalled()
})

test('the first consumer loads once under StrictMode and later consumers share pending and cached results', async () => {
  login(); let resolve!: (value: Response) => void
  requests = strictFetch({ 'GET /v1/tenant/effective-capabilities': () => new Promise<Response>((done) => { resolve = done }) })
  const page = (count: number) => <StrictMode><CapabilitiesProvider>{Array.from({ length: count }, (_, id) => <Consumer key={id} id={`gate-${id}`} />)}</CapabilitiesProvider></StrictMode>
  const view = render(page(0))
  expect(requests.mock).not.toHaveBeenCalled()
  view.rerender(page(1))
  expect(result('gate-0').gate).toEqual({ enabled: false, loading: true, reason: null })
  await waitFor(() => expect(requests.mock).toHaveBeenCalledTimes(1))
  expect(requests.mock.mock.calls[0][1]).toMatchObject({ method: 'GET', body: undefined })
  view.rerender(page(2))
  expect(requests.mock).toHaveBeenCalledTimes(1)
  await act(async () => resolve(Response.json({ capabilities: { realtime: true, invented_key: true } })))
  for (const id of ['gate-0', 'gate-1']) {
    expect(result(id).gate).toEqual({ enabled: true, loading: false, reason: null })
    expect(result(id).phantom).toEqual({ enabled: false, loading: false, reason: 'plan_restriction' })
  }
  view.rerender(page(3))
  expect(result('gate-2').gate.enabled).toBe(true)
  expect(requests.mock).toHaveBeenCalledTimes(1)
})

test('tenant changes never expose the previous result and load exactly once for the next consumer', async () => {
  login(); let resolve!: (value: Response) => void
  requests = strictFetch({ 'GET /v1/tenant/effective-capabilities': () => new Promise<Response>((done) => { resolve = done }) })
  const page = <StrictMode><CapabilitiesProvider><Consumer /></CapabilitiesProvider></StrictMode>
  const view = render(page)
  await waitFor(() => expect(requests.mock).toHaveBeenCalledTimes(1))
  await act(async () => resolve(Response.json({ capabilities: { realtime: true } })))
  expect(result().gate.enabled).toBe(true)
  context.activeTenantId = 't2'; view.rerender(<StrictMode><CapabilitiesProvider><Consumer /><span /></CapabilitiesProvider></StrictMode>)
  expect(result().gate).toEqual({ enabled: false, loading: true, reason: null })
  await waitFor(() => expect(requests.mock).toHaveBeenCalledTimes(2))
  await act(async () => resolve(Response.json({ capabilities: { realtime: false } })))
  expect(result().gate).toEqual({ enabled: false, loading: false, reason: 'plan_restriction' })
})

test('switching tenants without consumers invalidates the cache even when returning to the original tenant', async () => {
  login(); requests = strictFetch({ 'GET /v1/tenant/effective-capabilities': { capabilities: { realtime: true } } })
  const page = (show: boolean) => <CapabilitiesProvider>{show ? <Consumer /> : null}</CapabilitiesProvider>
  const view = render(page(true))
  await waitFor(() => expect(result().gate.enabled).toBe(true))
  view.rerender(page(false))
  context.activeTenantId = 't2'; view.rerender(page(false))
  expect(requests.mock).toHaveBeenCalledTimes(1)
  context.activeTenantId = 't1'; view.rerender(page(true))
  expect(result().gate.loading).toBe(true)
  await waitFor(() => expect(result().gate.enabled).toBe(true))
  expect(requests.mock).toHaveBeenCalledTimes(2)
})

test('a superseded tenant request cannot overwrite the current tenant result', async () => {
  login(); const responses: ((value: Response) => void)[] = []
  requests = strictFetch({ 'GET /v1/tenant/effective-capabilities': () => new Promise<Response>((done) => { responses.push(done) }) })
  const view = render(<CapabilitiesProvider><Consumer /></CapabilitiesProvider>)
  await waitFor(() => expect(responses).toHaveLength(1))
  context.activeTenantId = 't2'; view.rerender(<CapabilitiesProvider><Consumer /><span /></CapabilitiesProvider>)
  await waitFor(() => expect(responses).toHaveLength(2))
  await act(async () => responses[1](Response.json({ capabilities: { realtime: false } })))
  await act(async () => responses[0](Response.json({ capabilities: { realtime: true } })))
  expect(result().gate).toEqual({ enabled: false, loading: false, reason: 'plan_restriction' })
  expect(requests.mock).toHaveBeenCalledTimes(2)
})

test.each(['http', 'network'] as const)('%s errors fail closed and are cached', async (failure) => {
  login(); requests = strictFetch({ 'GET /v1/tenant/effective-capabilities': () => {
    if (failure === 'network') throw new TypeError('Synthetic network error')
    return Response.json({}, { status: 500 })
  } })
  const view = render(<CapabilitiesProvider><Consumer /></CapabilitiesProvider>)
  await waitFor(() => expect(result().error).toBe(true))
  expect(result().gate).toEqual({ enabled: false, loading: false, reason: 'plan_restriction' })
  view.rerender(<CapabilitiesProvider><Consumer /><Consumer id="second" /></CapabilitiesProvider>)
  expect(result('second').gate.reason).toBe('plan_restriction')
  expect(requests.mock).toHaveBeenCalledTimes(1)
})

test('no active tenant sends no request and clears an earlier result', async () => {
  login(); context.activeTenantId = null; requests = strictFetch({})
  const view = render(<CapabilitiesProvider><Consumer /></CapabilitiesProvider>)
  expect(result().gate).toEqual({ enabled: false, loading: false, reason: 'plan_restriction' })
  expect(requests.mock).not.toHaveBeenCalled()
  requests = strictFetch({ 'GET /v1/tenant/effective-capabilities': { capabilities: { realtime: true } } })
  context.activeTenantId = 't1'; view.rerender(<CapabilitiesProvider><Consumer /><span /></CapabilitiesProvider>)
  await waitFor(() => expect(result().gate.enabled).toBe(true))
  context.activeTenantId = null; view.rerender(<CapabilitiesProvider><Consumer /></CapabilitiesProvider>)
  expect(result().gate).toEqual({ enabled: false, loading: false, reason: 'plan_restriction' })
  expect(requests.mock).toHaveBeenCalledTimes(1)
})
