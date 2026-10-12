import assert from 'node:assert/strict'

export const httpCases = [
  ['default GET preserves the JSON and API headers without an idempotency key', async () => {
    const { requestJson } = await import('@in-falcone/console-api/http')
    const originalFetch = globalThis.fetch
    try {
      let observed
      globalThis.fetch = async (url, options) => {
        observed = { url, options }
        return Response.json({ ok: true })
      }
      assert.deepEqual(await requestJson('/v1/example'), { ok: true })
      assert.equal(observed.url, '/v1/example')
      assert.equal(observed.options.method, 'GET')
      const headers = observed.options.headers
      assert.equal(headers.get('Accept'), 'application/json')
      assert.equal(headers.get('Content-Type'), 'application/json')
      assert.equal(headers.get('X-API-Version'), '2026-03-26')
      assert.match(headers.get('X-Correlation-Id'), /^corr_.+/)
      assert.equal(headers.get('Idempotency-Key'), null)
    } finally {
      globalThis.fetch = originalFetch
    }
  }],
  ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(method => [
    `${method} with idempotency preserves the idem header`, async () => {
      const { requestJson } = await import('@in-falcone/console-api/http')
      const originalFetch = globalThis.fetch
      try {
        let headers
        globalThis.fetch = async (_url, options) => {
          headers = options.headers
          return Response.json({ ok: true })
        }
        await requestJson('/v1/example', { method, ...(method === 'GET' ? { idempotent: true } : {}) })
        assert.match(headers.get('Idempotency-Key'), /^idem_.+/)
      } finally {
        globalThis.fetch = originalFetch
      }
    }
  ])
]
