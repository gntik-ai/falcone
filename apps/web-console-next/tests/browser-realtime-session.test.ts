import { expect, test, vi } from 'vitest'
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { installSession } from './browser-session.mjs'
import { ready, capabilitiesPath } from './parity/pages/console-realtime-page.manifest'

test('CSP harness serves only the exact realtime GET and scoped capabilities fixture', async () => {
  let handle!: (route: unknown) => Promise<void>
  const page = { addInitScript: vi.fn(), route: vi.fn((_pattern: string, callback: typeof handle) => { handle = callback }) }
  const unmatched = await installSession(page)
  for (const [method, path] of [['GET', '/v1/workspaces/sample-workspaceId/realtime'], ['GET', capabilitiesPath], ['POST', '/v1/workspaces/sample-workspaceId/realtime'], ['GET', '/v1/workspaces/ws-1/realtime'], ['GET', '/v1/workspaces/sample-workspaceId/realtime?unexpected=true']]) {
    const route = { request: () => ({ url: () => `http://localhost${path}`, method: () => method, postDataJSON: () => undefined }), fulfill: vi.fn(), abort: vi.fn() }
    await handle(route)
    if (method === 'GET' && path === '/v1/workspaces/sample-workspaceId/realtime') expect(route.fulfill).toHaveBeenCalledWith({ json: { ...ready, workspaceId: 'sample-workspaceId' } })
    else if (path === capabilitiesPath) expect(route.fulfill).toHaveBeenCalledWith({ status: 200, json: { capabilities: { realtime: true } } })
    else expect(route.abort).toHaveBeenCalledOnce()
  }
  expect(unmatched).toEqual(['POST /v1/workspaces/sample-workspaceId/realtime', 'GET /v1/workspaces/ws-1/realtime', 'GET /v1/workspaces/sample-workspaceId/realtime?unexpected=true'])
})
