// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import * as session from '../src/session'
import { loginSession, recordFetch, snapshot, withSession } from './cases/support.mjs'

it.each([true, false, undefined])('repeated 401 suppression=%s preserves the single refresh/replay and default invalidation', (suppress) => withSession(async () => {
  session.persistConsoleShellSession(loginSession())
  const events = vi.fn()
  const unsubscribe = session.subscribeConsoleSessionInvalidated(events)
  const handler = vi.fn(session.invalidateConsoleShellSession)
  session.setConsoleSessionRetryUnauthorizedHandler(handler)
  try {
    const calls = recordFetch((_request, index) => index === 2
      ? Response.json(loginSession({ tokenSet: { ...snapshot.tokenSet, accessToken: 'synthetic-new-access' } }))
      : Response.json({ code: 'DENIED' }, { status: 401 }))
    await expect(session.requestConsoleSessionJson('/v1/flows/workspaces/synthetic-workspace/flows/f1/executions',
      suppress === undefined ? {} : { suppressUnauthorizedInvalidation: suppress })).rejects.toMatchObject({ status: 401 })
    expect(calls.map(({ method }) => method)).toEqual(['GET', 'POST', 'GET'])
    expect(calls[1].url).toBe('/v1/auth/login-sessions/synthetic-session/refresh')
    expect(calls[1].body).toBe(JSON.stringify({ refreshToken: snapshot.tokenSet.refreshToken }))
    expect(calls[0].headers.get('Authorization')).toBe(`Bearer ${snapshot.tokenSet.accessToken}`)
    expect(calls[2].headers.get('Authorization')).toBe('Bearer synthetic-new-access')
    expect(handler).toHaveBeenCalledTimes(suppress ? 0 : 1)
    expect(events).toHaveBeenCalledTimes(suppress ? 0 : 1)
    expect(session.readConsoleShellSession()?.tokenSet?.accessToken ?? null).toBe(suppress ? 'synthetic-new-access' : null)
  } finally { session.setConsoleSessionRetryUnauthorizedHandler(null); unsubscribe() }
}))
