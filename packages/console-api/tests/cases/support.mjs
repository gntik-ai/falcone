import { readFileSync } from 'node:fs'

export const snapshot = JSON.parse(readFileSync(new URL('../data/base-session.json', import.meta.url), 'utf8'))
export const sessionKey = 'in-falcone.console-shell-session'
export const hintKey = 'in-falcone.console-auth-status-hint'
export const routeKey = 'in-falcone.console-protected-route'
export const invalidatedEvent = 'in-falcone:console-session-invalidated'
export const now = Date.parse('2026-03-28T18:00:00.000Z')

export function loginSession(overrides = {}) {
  return {
    ...structuredClone(snapshot),
    lastActivityAt: snapshot.issuedAt,
    idleExpiresAt: snapshot.expiresAt,
    sessionPolicy: { maxLifetime: '8h', idleTimeout: '1h', refreshTokenMaxAge: '24h' },
    ...overrides
  }
}

export async function withSession(run) {
  const originalFetch = globalThis.fetch
  const originalNow = Date.now
  window.sessionStorage.clear()
  Date.now = () => now
  try {
    return await run()
  } finally {
    globalThis.fetch = originalFetch
    Date.now = originalNow
    window.sessionStorage.clear()
  }
}

export function recordFetch(respond) {
  const requests = []
  globalThis.fetch = async (url, options) => {
    const request = { url, method: options.method, headers: options.headers, body: options.body }
    requests.push(request)
    return respond(request, requests.length)
  }
  return requests
}
