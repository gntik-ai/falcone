import { expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { needles, scanTree, seededCheck, zipEntries, zipOf } from './parity/artifact-scan.mjs'
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { blank, expectBlank, sanitize, typeSecret } from './parity/pages/console-workspace-secrets-page.support.mjs'
import { canary, redacted } from './parity/pages/console-workspace-secrets-page.manifest'

test('the seeded canary is detected in plain, base64, URL-encoded, zipped and report-embedded forms and never printed', () => {
  const found = seededCheck(canary)
  expect(found.hits.length).toBeGreaterThanOrEqual(5)
  expect(found.hits.join('\n')).not.toContain(canary)
})

test('the scanner reads deflated zip entries and ignores values that are already masked', () => {
  const entries = zipEntries(zipOf('a.trace', `{"v":"${canary}"}`))
  expect(entries.map(({ name }: { name: string }) => name)).toEqual(['a.trace'])
  expect(entries[0].data.toString()).toContain(canary)
  expect(needles(canary).map(([kind]: [string]) => kind)).toEqual(expect.arrayContaining(['plain', 'url', 'utf16', 'hex', 'base64-0', 'base64-1', 'base64-2']))
  expect(needles(canary).every(([, value]: [string, Buffer]) => !value.includes(Buffer.from(redacted)))).toBe(true)
})

test('a failing clear assertion names the field and never prints the value', async () => {
  const stillFilled = { evaluate: async (callback: (element: { value: string }) => boolean) => callback({ value: canary }) }
  expect(await blank(stillFilled)).toBe(false)
  const failures: string[] = []
  const expectation = (actual: unknown, message: string) => ({ toBe: (expected: unknown) => { if (actual !== expected) failures.push(`${message}: expected ${String(expected)}, received ${String(actual)}`) } })
  await expectBlank(expectation, stillFilled, 'value')
  expect(failures).toEqual(['value must be cleared: expected true, received false'])
  expect(failures.join('\n')).not.toContain(canary)
})

test('typeSecret failures are sanitized and the probe sources hold only the redacted mask', async () => {
  const failing = { evaluate: vi.fn(async () => { throw new Error(`Timeout while typing ${canary}`) }) }
  await expect(typeSecret(failing, canary)).rejects.toThrow('typeSecret: Timeout while typing [redacted-secret-value]')
  expect(sanitize(`a ${canary} b`)).toBe(`a ${redacted} b`)
  // The reports are scanned on disk; the spec and probe never log or assert the raw value.
  for (const file of ['parity/pages/console-workspace-secrets-page.spec.mjs', 'parity/artifacts.spec.mjs']) {
    const source = readFileSync(`tests/${file}`, 'utf8')
    expect(source).not.toMatch(/toHaveValue\(/)
    expect(source).not.toMatch(/console\.log\(/)
  }
})

test('verify-artifacts is wired into the CI parity job', () => {
  const workflow = readFileSync('../../.github/workflows/ci.yml', 'utf8')
  expect(workflow).toContain('node tests/parity/verify-artifacts.mjs')
  const ui = JSON.parse(readFileSync('package.json', 'utf8'))
  expect(ui.scripts['test:parity']).toContain('verify-negatives.mjs')
})

test('a clean tree and an empty needle list report nothing', () => {
  expect(scanTree('tests/parity/fixtures', [canary]).hits).toEqual([])
})
