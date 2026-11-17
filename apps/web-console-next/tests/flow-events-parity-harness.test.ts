import { expect, test, vi } from 'vitest'

vi.mock('@playwright/test', () => ({ expect, test: { extend: (fixtures: unknown) => fixtures } }))
vi.mock('./csp/server.mjs', () => ({ startServer: vi.fn() }))
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { test as fixtures } from './parity/harness.mjs'

const origin = 'http://synthetic.test'
const eventsPath = '/v1/flows/workspaces/synthetic-workspace/executions/synthetic-execution/events'
async function journey(pattern: string, path: string, headers: Record<string, string> = {}) {
  const route = {
    request: () => ({ method: () => 'GET', url: () => new URL(path, origin).href, headers: () => headers, postDataJSON: () => undefined }),
    fulfill: vi.fn(), abort: vi.fn(), continue: vi.fn(),
  }
  const handlers: Record<string, (route: unknown) => Promise<void>> = {}
  const page = {
    clock: { setFixedTime: vi.fn() }, exposeBinding: vi.fn(), on: vi.fn(), addInitScript: vi.fn(),
    route: vi.fn((pattern: string, handle: (route: unknown) => Promise<void>) => { handlers[pattern] = handle }),
  }
  await fixtures.parity[0]({
    page, server: { origin }, role: 'superadmin', locale: 'en',
    pageEndpoints: { 'synthetic-events': { method: 'GET', path: eventsPath, fixtures: { success: { status: 200, body: {} } } } },
  }, async () => { await handlers[pattern](route) })
  return route
}

test.each([
  ['**/*', '/synthetic-asset?APIKEY=synthetic-key'],
  ['**/*', '/synthetic-apikey-asset'],
  ['**/v1/**', `${eventsPath}?apikey=synthetic-key`],
])('the %s handler fails the run for an apikey URL', async (pattern, path) => {
  await expect(journey(pattern, path, { authorization: 'Bearer synthetic-token' })).rejects.toThrow('API key URL forbidden')
})

test.each(['**/*', '**/v1/**'])('the %s handler rejects missing or empty bearer credentials on events requests', async (pattern) => {
  const cases: Record<string, string>[] = [{}, { authorization: 'Basic synthetic-token' }, { authorization: 'Bearer ' }]
  for (const headers of cases) {
    await expect(journey(pattern, eventsPath, headers)).rejects.toThrow('Flow events bearer required')
  }
})

test.each(['**/*', '**/v1/**'])('the %s handler allows events requests with a bearer', async (pattern) => {
  const route = await journey(pattern, eventsPath, { Authorization: 'Bearer synthetic-token' })
  expect(route.abort).not.toHaveBeenCalled()
  if (pattern === '**/*') expect(route.continue).toHaveBeenCalledTimes(1)
  else expect(route.fulfill).toHaveBeenCalledWith({ status: 200, json: {} })
})
