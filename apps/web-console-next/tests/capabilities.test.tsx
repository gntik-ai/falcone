import { act, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { CapabilitiesProvider, useCapabilities, useCapabilityGate } from '../src/shell/capabilities'
import { login, strictFetch } from './shell-support'
const context = vi.hoisted(() => ({ activeTenantId: 't1' as string | null, loading: false }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context }))
let requests: ReturnType<typeof strictFetch>
afterEach(() => { requests?.verify(); context.activeTenantId = 't1'; vi.unstubAllGlobals() })
function Consumer() {
  const gate = useCapabilityGate('realtime')
  // @ts-expect-error Phantom catalog keys cannot gate a page.
  const phantom = useCapabilityGate('invented_key')
  const state = useCapabilities()
  return <output>{JSON.stringify({ gate, phantom, error: Boolean(state.error) })}</output>
}
test('one GET per active tenant, no reload for rerenders, and no stale result during tenant changes', async () => {
  login(); let resolve!: (value: Response) => void
  requests = strictFetch({ 'GET /v1/tenant/effective-capabilities': () => new Promise<Response>((done) => { resolve = done }) })
  const page = <StrictMode><CapabilitiesProvider><Consumer /></CapabilitiesProvider></StrictMode>
  const view = render(page)
  await waitFor(() => expect(requests.mock).toHaveBeenCalledTimes(1))
  await act(async () => resolve(Response.json({ capabilities: { realtime: true, invented_key: true } })))
  expect(screen.getByRole('status')).toHaveTextContent('"enabled":true')
  expect(JSON.parse(screen.getByRole('status').textContent!).phantom.enabled).toBe(false)
  view.rerender(<StrictMode><CapabilitiesProvider><Consumer /><span /></CapabilitiesProvider></StrictMode>)
  expect(requests.mock).toHaveBeenCalledTimes(1)
  context.activeTenantId = 't2'; view.rerender(page)
  await waitFor(() => expect(requests.mock).toHaveBeenCalledTimes(2))
  expect(JSON.parse(screen.getByRole('status').textContent!).gate).toMatchObject({ enabled: false, loading: true })
  await act(async () => resolve(Response.json({ capabilities: { realtime: false } })))
  expect(JSON.parse(screen.getByRole('status').textContent!).gate.enabled).toBe(false)
})
test('errors fail closed and no active tenant makes no request', async () => {
  login(); requests = strictFetch({ 'GET /v1/tenant/effective-capabilities': () => Response.json({}, { status: 500 }) })
  const view = render(<CapabilitiesProvider><Consumer /></CapabilitiesProvider>)
  await waitFor(() => expect(JSON.parse(screen.getByRole('status').textContent!).error).toBe(true))
  expect(JSON.parse(screen.getByRole('status').textContent!).gate.enabled).toBe(false)
  view.unmount(); context.activeTenantId = null
  render(<CapabilitiesProvider><Consumer /></CapabilitiesProvider>)
  expect(requests.mock).toHaveBeenCalledTimes(1)
})
