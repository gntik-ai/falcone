import { describe, expect, test } from 'vitest'
// Importing checks.mjs under vitest/jsdom, where import.meta.url is not a file: URL, is itself part of this test.
import { assertNoSampleData } from './parity/checks.mjs'

// The Playwright page is the system boundary: evaluate() runs the shipped in-page function against a jsdom document.
const pageWith = (html: string) => ({
  isClosed: () => false,
  async evaluate(run: (arg: string[]) => unknown, arg: string[]) {
    document.body.innerHTML = html
    return run(arg)
  },
})
const parity = (html: string, supplied: string[] = []) => ({ page: pageWith(html), network: { supplied } })

describe('assertNoSampleData', () => {
  test('passes on a settled page without kit sample text', async () => {
    await expect(assertNoSampleData(parity('<main><h1>Planes</h1><table><tr><td>starter</td><td>eu-north-9</td></tr></table></main>'))).resolves.toBeUndefined()
  })

  test('fails when a DataTable cell shows a kit sample row name', async () => {
    await expect(assertNoSampleData(parity('<main><table><tbody><tr><td> orders-api </td><td>$40.00</td></tr></tbody></table></main>'))).rejects.toThrow(/sample-data: .*orders-api/s)
  })

  test('fails on sample text anywhere in main, including a kit region and a staging variant', async () => {
    await expect(assertNoSampleData(parity('<main><section><p>webhooks-staging</p></section></main>'))).rejects.toThrow(/webhooks-staging/)
    await expect(assertNoSampleData(parity('<main><div><span>eu-west-1</span></div></main>'))).rejects.toThrow(/eu-west-1/)
  })

  test('ignores sample-looking text outside main and text that merely contains a sample string', async () => {
    await expect(assertNoSampleData(parity('<nav>orders-api</nav><main><p>Open orders-api docs</p><p>orders-api-v2</p></main>'))).resolves.toBeUndefined()
  })

  test('treats text a mocked response or the user supplied as data', async () => {
    const html = '<main><table><tr><td>billing-sync</td></tr></table></main>'
    await expect(assertNoSampleData(parity(html, ['{"items":[{"name":"billing-sync"}]}']))).resolves.toBeUndefined()
    await expect(assertNoSampleData(parity(html, ['{"items":[{"name":"other"}]}']))).rejects.toThrow(/billing-sync/)
  })

  test('falls back to the body when the page has no main', async () => {
    await expect(assertNoSampleData(parity('<div>reports</div>'))).rejects.toThrow(/reports/)
  })

  test('does not fail a page that is closing or navigating', async () => {
    const closing = { isClosed: () => true, evaluate: async () => { throw new Error('Target page, context or browser has been closed') }, }
    await expect(assertNoSampleData({ page: closing, network: { supplied: [] } })).resolves.toBeUndefined()
    const navigating = { isClosed: () => false, evaluate: async () => { throw new Error('Execution context was destroyed, most likely because of a navigation') } }
    await expect(assertNoSampleData({ page: navigating, network: { supplied: [] } })).resolves.toBeUndefined()
    const broken = { isClosed: () => false, evaluate: async () => { throw new Error('unexpected failure') } }
    await expect(assertNoSampleData({ page: broken, network: { supplied: [] } })).rejects.toThrow(/unexpected failure/)
  })
})
