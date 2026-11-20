import { afterEach, expect, test, vi } from 'vitest'

// Playwright is the system boundary: its expect resolves a readiness assertion, and the page it inspects is a double.
// `onAssert` runs while the assertion is awaiting, as the page would render while a readiness assertion retries.
const hooks = vi.hoisted(() => ({ onAssert: () => {} }))
vi.mock('@playwright/test', () => ({
  expect: Object.assign(
    () => new Proxy({}, { get: () => async () => { hooks.onAssert() } }),
    { poll: () => ({}), soft: () => ({}) },
  ),
  test: { extend: (fixtures: unknown) => fixtures },
}))
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { trackParity } from './parity/settled-expect.mjs'
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import * as functions from './parity/pages/console-functions-page.support.mjs'
import * as checks from './parity/checks.mjs'

// A locator double: every chained query returns a locator.
const locator: unknown = new Proxy(() => {}, { get: (_target, property) => (property === 'then' ? undefined : locator), apply: () => locator })
const page: Record<string, unknown> = { getByTestId: () => locator, getByRole: () => locator, locator: () => locator }
let rendered = false
const parity: Record<string, any> = {
  locale: 'en', page, network: { requests: [] },
  assertNoSampleData: async () => { if (rendered) throw new Error('sample-data: the page shows kit sample text that no response or input supplied: orders-api') },
}
let release = () => {}
afterEach(() => { release(); rendered = false; parity.page = page; hooks.onAssert = () => {} })

// The sample text is on screen only while the readiness assertion runs and is gone once the helper returns, so only the
// check that follows the assertion can see it.
test.each([
  ['the functions page ready()', () => functions.ready(parity)],
  ['the functions page select()', () => functions.select(parity)],
  ['the functions page openTab()', () => functions.openTab(parity, 'versions')],
])('%s fails when kit sample text shows while its readiness assertion settles', async (_name, run) => {
  release = trackParity(parity, true)
  hooks.onAssert = () => { rendered = true }
  await expect(run()).rejects.toThrow('sample-data:')
})

test('a shared helper still resolves when the page shows no sample text', async () => {
  release = trackParity(parity, true)
  await expect(functions.ready(parity)).resolves.toBeUndefined()
})

test('outside a tracked parity test the helper only runs the Playwright assertion', async () => {
  hooks.onAssert = () => { rendered = true }
  await expect(functions.ready(parity)).resolves.toBeUndefined()
})

// The exported check helpers share the same guard: sample text present while the visibility assertion resolves, and gone
// again when the helper's next page evaluation runs, still fails the journey.
test('the exported assertResponsive helper fails when sample text shows only while its readiness assertion settles', async () => {
  release = trackParity(parity, true)
  const transient = { ...page, setViewportSize: async () => {}, evaluate: async () => { rendered = false; return { scrollWidth: 1, clientWidth: 1 } } }
  hooks.onAssert = () => { rendered = true }
  parity.page = transient
  await expect(checks.assertResponsive(parity, 375)).rejects.toThrow('sample-data:')
})
