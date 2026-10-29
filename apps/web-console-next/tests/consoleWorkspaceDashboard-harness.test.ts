import { expect, test, vi } from 'vitest'
import { consumption, workspaceConsumptionEndpoints } from './parity/pages/console-workspace-dashboard-page.manifest'
import { createEndpointRegistry } from './parity/endpoint-registry'
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { installSession } from './browser-session.mjs'

type MockRoute = {
  request: () => { url: () => string; method: () => string; postDataJSON: () => undefined }
  fulfill: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn>
}
test('CSP session serves the exact sampled consumption GET and fails closed on other methods, IDs and queries', async () => {
  let handle!: (route: MockRoute) => Promise<void>
  const page = { addInitScript: vi.fn(), route: vi.fn((_pattern: string, callback: typeof handle) => { handle = callback }) }
  const unmatched = await installSession(page)
  const cases = [
    ['GET', '/v1/workspaces/sample-workspaceId/consumption'],
    ['POST', '/v1/workspaces/sample-workspaceId/consumption'],
    ['GET', '/v1/workspaces/other-workspace/consumption'],
    ['GET', '/v1/workspaces/sample-workspaceId/consumption?unexpected=true'],
    ['GET', '/v1/tenants/synthetic-tenant/workspaces/sample-workspaceId/consumption'],
  ]
  for (const [index, [method, path]] of cases.entries()) {
    const route = { request: () => ({ url: () => `http://localhost${path}`, method: () => method, postDataJSON: () => undefined }), fulfill: vi.fn(), abort: vi.fn() }
    await handle(route)
    if (index === 0) {
      expect(route.fulfill).toHaveBeenCalledExactlyOnceWith({ status: 200, json: consumption })
      expect(route.abort).not.toHaveBeenCalled()
      expect(unmatched).toEqual([])
    } else {
      expect(route.abort).toHaveBeenCalledExactlyOnceWith()
      expect(route.fulfill).not.toHaveBeenCalled()
    }
  }
  expect(unmatched).toEqual(cases.slice(1).map(([method, path]) => `${method} ${path}`))
})

test('the page manifest is required for the CSP consumption fixture and supplies every named state', () => {
  const base = createEndpointRegistry({}, () => ({}))
  expect(base.find('GET', '/v1/workspaces/sample-workspaceId/consumption')).toBeUndefined()
  const registry = createEndpointRegistry({}, () => ({}), workspaceConsumptionEndpoints)
  expect(registry.find('GET', '/v1/workspaces/sample-workspaceId/consumption')).toBe('workspaceConsumption')
  for (const variant of Object.keys(workspaceConsumptionEndpoints.workspaceConsumption.fixtures)) {
    registry.setVariants({ workspaceConsumption: variant })
    expect(registry.responseFor('workspaceConsumption', 'workspace_viewer')).toBeDefined()
  }
})
