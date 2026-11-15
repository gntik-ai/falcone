import { expect, test, vi } from 'vitest'
import { buildConsoleLoginSessionFixture } from '@in-falcone/console-api/fixtures'
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { installKafkaHarness } from './parity/pages/console-kafka-page.support.mjs'
import { legacyJourneyFixtures, paths } from './parity/pages/console-kafka-page.manifest'

type MockRoute = {
  request: () => { method: () => string; url: () => string; postDataJSON: () => undefined; headers: () => object }
  fulfill: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn>; fallback: ReturnType<typeof vi.fn>
}
async function harness() {
  let handle!: (route: MockRoute) => Promise<void>, initialize!: () => void
  const page = {
    addInitScript: vi.fn((callback) => { initialize = callback }), on: vi.fn(),
    route: vi.fn((_pattern, callback) => { handle = callback }),
  }
  const parity = { page, faults: [], open: vi.fn() }
  const h = await installKafkaHarness(parity)
  async function request(path: string, method = 'GET') {
    const route = {
      request: () => ({ method: () => method, url: () => `http://localhost${path}`, postDataJSON: () => undefined, headers: () => ({ authorization: 'Bearer synthetic-token' }) }),
      fulfill: vi.fn(), abort: vi.fn(), fallback: vi.fn(),
    }
    await handle(route)
    return route
  }
  return { h, initialize, request }
}

test('the legacy journey workspace remains accessible to the synthetic session', async () => {
  const { initialize } = await harness()
  const key = 'in-falcone.console-shell-session'
  sessionStorage.setItem(key, JSON.stringify(buildConsoleLoginSessionFixture()))
  vi.stubGlobal('fetch', vi.fn())
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive')
  initialize()
  document.dispatchEvent(new Event('readystatechange'))
  expect(JSON.parse(sessionStorage.getItem(key)!).principal.workspaceIds).toEqual(['synthetic-workspace', 'ws_alpha_prod'])
})

test.each(['nominal', 'empty', 'error'])('the mirrored legacy %s scenario serves the original workspace and data', async (variant) => {
  const { h, request } = await harness()
  await h.open(`kafka:legacy-service-${variant}`)
  const inventory = await request('/v1/events/workspaces/ws_alpha_prod/inventory?page[size]=100')
  expect(inventory.abort).not.toHaveBeenCalled()
  expect(inventory.fulfill).toHaveBeenCalledWith({ status: variant === 'error' ? 503 : 200, json: variant === 'error' ? { message: 'Synthetic backend failure', requestId: 'kafka-browser-request' } : legacyJourneyFixtures[variant === 'empty' ? 'empty' : 'inventory'] })
  if (variant === 'nominal') {
    for (const key of ['detail', 'access', 'metadata'] as const) {
      const route = await request(paths[key].replace('res_topic_1', 'topic_audit_001'))
      expect(route.fulfill).toHaveBeenCalledWith({ status: 200, json: legacyJourneyFixtures[key] })
    }
  }
  expect(h.unmatched).toEqual([])
})

test('topic changes serve the selected inventory row and keep unrelated requests unmatched', async () => {
  const { h, request } = await harness()
  await h.open()
  for (const key of ['detail', 'access', 'metadata'] as const) {
    const route = await request(paths[key].replace('res_topic_1', 'res_topic_2'))
    expect(route.fulfill).toHaveBeenCalledWith({ status: 200, json: expect.objectContaining({ resourceId: 'res_topic_2', topicName: 'orders.pending' }) })
    expect(route.abort).not.toHaveBeenCalled()
  }
  expect(h.unmatched).toEqual([])
  for (const [method, path] of [
    ['GET', '/v1/events/topics/unknown'],
    ['GET', '/v1/events/topics/res_topic_2/metadata?extra=1'],
    ['POST', paths.detail], ['GET', paths.publish],
    ['GET', '/v1/events/workspaces/other/inventory?page[size]=100'],
    ['GET', '/v1/events/workspaces/synthetic-workspace/inventory?page[size]=99'],
    ['GET', '/v1/unknown'],
  ]) {
    const route = await request(path, method)
    expect(route.abort).toHaveBeenCalledOnce()
    expect(route.fulfill).not.toHaveBeenCalled()
    expect(h.unmatched).toContain(`${method} ${path}`)
  }
})
