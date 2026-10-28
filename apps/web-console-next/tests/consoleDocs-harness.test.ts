import { expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createEndpointRegistry } from './parity/endpoint-registry'
import { operationEndpoints } from './parity/pages/operationDetail.manifest'
import { runtimeEndpoints } from './parity/pages/consoleRuntime.manifest'
import { pendingEndpoints } from './parity/pages/pendingActivation.manifest'
import { buildConsoleSignupPolicyFixture } from '@in-falcone/console-api/fixtures'
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { installSession } from './browser-session.mjs'

type MockRoute = {
  request: () => { url: () => string; method: () => string; postDataJSON: () => undefined }
  fulfill: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn>
}

test('CSP harness serves only exact docs reads and preserves fail-closed handling of every other request', async () => {
  let handle!: (route: MockRoute) => Promise<void>
  const page = { addInitScript: vi.fn(), route: vi.fn((_pattern: string, callback: typeof handle) => { handle = callback }) }
  const unmatched = await installSession(page)
  const cases = [
    ['GET', '/v1/workspaces/sample-workspaceId/docs'],
    ['GET', '/v1/workspaces/wrk-1/docs'],
    ['POST', '/v1/workspaces/wrk-1/docs/notes'],
    ['PUT', '/v1/workspaces/wrk-1/docs/notes/synthetic-note'],
    ['DELETE', '/v1/workspaces/wrk-1/docs/notes/synthetic-note'],
    ['POST', '/v1/workspaces/wrk-1/docs'],
    ['GET', '/v1/workspaces/wrk-1/docs?unexpected=true'],
    ['GET', '/v1/workspaces/wrk-1/docs/'],
    ['GET', '/v1/unexpected'],
  ]
  for (const [index, [method, path]] of cases.entries()) {
    const route = { request: () => ({ url: () => `http://localhost${path}`, method: () => method, postDataJSON: () => undefined }), fulfill: vi.fn(), abort: vi.fn() }
    await handle(route)
    if (index < 2) {
      expect(route.fulfill).toHaveBeenCalledExactlyOnceWith({ json: expect.objectContaining({ enabledServices: [], customNotes: [], authInstructions: expect.objectContaining({ clientSecretPlaceholder: '<SYNTHETIC_CLIENT_SECRET>' }) }) })
      expect(route.abort).not.toHaveBeenCalled(); expect(unmatched).toEqual([])
    } else {
      expect(route.fulfill).not.toHaveBeenCalled(); expect(route.abort).toHaveBeenCalledExactlyOnceWith()
    }
  }
  expect(unmatched).toEqual(cases.slice(2).map(([method, path]) => `${method} ${path}`))
})


test('removing just the docs matcher makes the sampled CSP docs GET unmatched', async () => {
  const source = readFileSync('tests/browser-session.mjs', 'utf8')
  const start = source.indexOf("    } else if (route.request().method() === 'GET'")
  const end = source.indexOf('    } else {', start)
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start)
  // Execute the unchanged harness with only the new read branch removed.
  const negative = (source.slice(0, start) + source.slice(end)).split('\n').filter((line) => !line.startsWith('import ')).join('\n')
  const installWithoutDocs = new Function('createEndpointRegistry', 'operationEndpoints', 'runtimeEndpoints', 'pendingEndpoints', 'buildConsoleSignupPolicyFixture',
    negative.replace('export async function installSession', 'return async function installSession'))(
    createEndpointRegistry, operationEndpoints, runtimeEndpoints, pendingEndpoints, buildConsoleSignupPolicyFixture)
  let handle!: (route: MockRoute) => Promise<void>
  const unmatched = await installWithoutDocs({ addInitScript: vi.fn(), route: vi.fn((_pattern: string, callback: typeof handle) => { handle = callback }) })
  const route = { request: () => ({ url: () => 'http://localhost/v1/workspaces/sample-workspaceId/docs', method: () => 'GET', postDataJSON: () => undefined }), fulfill: vi.fn(), abort: vi.fn() }
  await handle(route)
  expect(route.fulfill).not.toHaveBeenCalled(); expect(route.abort).toHaveBeenCalledExactlyOnceWith()
  expect(unmatched).toEqual(['GET /v1/workspaces/sample-workspaceId/docs'])
})
