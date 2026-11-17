import { expect, test, vi } from 'vitest'
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { installSession } from './browser-session.mjs'

const base = '/v1/flows/workspaces/synthetic-workspace'
const bearer = { authorization: 'Bearer synthetic-token' }
const sample = `${base}/flows/f1/executions/sample-executionId`
const events = `${base}/executions/sample-executionId/events`

test('CSP bootstrap fixtures serve only the run page on-load GETs and reject every other request', async () => {
  let handle!: (route: unknown) => Promise<void>
  const unmatched = await installSession({ addInitScript: vi.fn(), route: vi.fn((_pattern, callback) => { handle = callback }) })
  const cases: [string, string, Record<string, string>, boolean][] = [
    ['GET', sample, {}, true], ['GET', events, bearer, true],
    ['GET', events, {}, false], ['GET', `${events}?apikey=synthetic`, bearer, false], ['GET', `${sample}?status=Running`, {}, false],
    ['POST', sample, {}, false], ['GET', `${base}/flows/f1/executions/other`, {}, false], ['POST', `${base}/flows/f1/executions/sample-executionId/cancellations`, {}, false],
  ]
  for (const [method, path, headers, served] of cases) {
    const route = { request: () => ({ method: () => method, url: () => 'http://localhost' + path, headers: () => headers, postDataJSON: () => undefined }), fulfill: vi.fn(), abort: vi.fn() }
    await handle(route)
    expect(route.fulfill, `${method} ${path}`).toHaveBeenCalledTimes(served ? 1 : 0)
  }
  expect(unmatched).toEqual(cases.filter(([, , , served]) => !served).map(([method, path]) => `${method} ${path}`))
})
