import { expect, test } from 'vitest'
// Match the browser harness's .mjs utility without widening the app TypeScript surface.
// @ts-expect-error The harness intentionally uses native JavaScript modules.
import { consumeResourceDiagnostic } from './resource-diagnostics.mjs'

const url = 'http://localhost/v1/platform/runtime/knative'
test.each(['401', '403', '404', '500', 'network'])('only the exact injected runtime resource diagnostic is consumed: %s', (kind) => {
  const message = kind === 'network' ? 'Failed to load resource: net::ERR_FAILED' : `Failed to load resource: the server responded with a status of ${kind} (Synthetic)`
  const injected = [{ url, kind }]
  expect(consumeResourceDiagnostic(message, url + '/unexpected', injected)).toBe(false)
  expect(consumeResourceDiagnostic('synthetic application error', url, injected)).toBe(false)
  expect(consumeResourceDiagnostic(message, url, injected)).toBe(true)
  expect(injected).toEqual([])
  expect(consumeResourceDiagnostic(message, url, injected)).toBe(false)
})
