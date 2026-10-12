import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { publishFlow, validateFlow } from './flowsApi'
import { persistConsoleShellSession } from '@in-falcone/console-api/session'

beforeEach(() => {
  // Synthetic session: only the HTTP boundary is mocked, not console collaborators.
  persistConsoleShellSession({
    sessionId: 'synthetic-session', authenticationState: 'active', statusView: 'active',
    issuedAt: '2026-01-01T00:00:00Z', lastActivityAt: '2026-01-01T00:00:00Z', idleExpiresAt: '2099-01-01T00:00:00Z', sessionPolicy: {}, expiresAt: '2099-01-01T00:00:00Z', refreshExpiresAt: '2099-01-01T00:00:00Z',
    tokenSet: {
      accessToken: 'synthetic-access-token', refreshToken: 'synthetic-refresh-token', tokenType: 'Bearer',
      expiresIn: 3600, refreshExpiresIn: 7200, scope: 'openid',
      expiresAt: '2099-01-01T00:00:00Z', refreshExpiresAt: '2099-01-01T00:00:00Z'
    }
  })
})

afterEach(() => {
  window.sessionStorage.clear()
  vi.unstubAllGlobals()
})

describe('flow API validation errors', () => {
  for (const [name, request] of [['validate', validateFlow], ['publish', publishFlow]] as const) {
    it(`preserves localization params on ${name} 422 responses`, async () => {
      const errors = [{ code: 'FLW-E001', nodeId: 'dup', message: 'Duplicate node ID "dup"; node IDs must be unique within the flow.', params: { nodeId: 'dup' } }]
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
        code: 'FLOW_VALIDATION_FAILED', message: 'Flow definition is invalid', errors
      }), { status: 422, headers: { 'content-type': 'application/json' } })))
      await expect(request('ws', 'flow')).rejects.toMatchObject({
        status: 422, code: 'FLOW_VALIDATION_FAILED', body: { errors }
      })
    })
  }
})
