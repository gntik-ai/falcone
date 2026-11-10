import { expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createEndpointRegistry } from './parity/endpoint-registry'
import { operationEndpoints } from './parity/pages/operationDetail.manifest'
import { runtimeEndpoints } from './parity/pages/consoleRuntime.manifest'
import { pendingEndpoints } from './parity/pages/pendingActivation.manifest'
import { buildConsoleSignupPolicyFixture } from '@in-falcone/console-api/fixtures'
import { cursorPath, secretsPath, workspaceSecretsEndpoints } from './parity/pages/console-workspace-secrets-page.manifest'
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { installSession } from './browser-session.mjs'

type MockRoute = { request: () => { url: () => string; method: () => string; postDataJSON: () => undefined }; fulfill: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> }
const routeOf = (method: string, path: string): MockRoute => ({ request: () => ({ url: () => `http://localhost${path}`, method: () => method, postDataJSON: () => undefined }), fulfill: vi.fn(), abort: vi.fn() })

test('the CSP harness serves only the query-less workspace secrets list and leaves every other secrets request unmatched', async () => {
  let handle!: (route: MockRoute) => Promise<void>
  const page = { addInitScript: vi.fn(), route: vi.fn((_pattern: string, callback: typeof handle) => { handle = callback }) }
  const unmatched = await installSession(page)
  const served = routeOf('GET', secretsPath)
  await handle(served)
  expect(served.fulfill).toHaveBeenCalledTimes(1)
  expect(served.abort).not.toHaveBeenCalled()
  const others = [['GET', cursorPath], ['POST', secretsPath], ['PUT', `${secretsPath}/db_password`], ['DELETE', `${secretsPath}/db_password`], ['GET', `${secretsPath}/db_password`]]
  for (const [method, path] of others) { const route = routeOf(method, path); await handle(route); expect(route.fulfill).not.toHaveBeenCalled(); expect(route.abort).toHaveBeenCalledTimes(1) }
  expect(unmatched).toEqual(others.map(([method, path]) => `${method} ${path}`))
  expect(Object.keys(workspaceSecretsEndpoints)).toEqual(['workspace-secrets.list'])
})

test('the registry spread is typeof-guarded so the new-Function harness can run the source without the import', () => {
  const source = readFileSync('tests/browser-session.mjs', 'utf8')
  expect(source).toContain("...(typeof workspaceSecretsEndpoints === 'undefined' ? {} : workspaceSecretsEndpoints),")
  // Execute the unchanged harness the way consoleDocs-harness does: import lines removed, names injected by position.
  const body = source.split('\n').filter((line) => !line.startsWith('import ')).join('\n')
  const make = new Function('createEndpointRegistry', 'operationEndpoints', 'runtimeEndpoints', 'pendingEndpoints', 'buildConsoleSignupPolicyFixture',
    body.replace('export async function installSession', 'return async function installSession'))
  expect(() => make(createEndpointRegistry, operationEndpoints, runtimeEndpoints, pendingEndpoints, buildConsoleSignupPolicyFixture)).not.toThrow()
})

test('an unguarded reference would throw in the stripped harness, so the guard is load-bearing', async () => {
  const source = readFileSync('tests/browser-session.mjs', 'utf8')
  const unguarded = source.replace("...(typeof workspaceSecretsEndpoints === 'undefined' ? {} : workspaceSecretsEndpoints),", '...workspaceSecretsEndpoints,')
  const body = unguarded.split('\n').filter((line) => !line.startsWith('import ')).join('\n')
  const make = new Function('createEndpointRegistry', 'operationEndpoints', 'runtimeEndpoints', 'pendingEndpoints', 'buildConsoleSignupPolicyFixture',
    body.replace('export async function installSession', 'return async function installSession'))
  const install = make(createEndpointRegistry, operationEndpoints, runtimeEndpoints, pendingEndpoints, buildConsoleSignupPolicyFixture)
  await expect(install({ addInitScript: vi.fn(), route: vi.fn() })).rejects.toThrow(/workspaceSecretsEndpoints|realtimeReady|catalogEndpoints|is not defined/)
})
