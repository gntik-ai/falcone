import { describe, expect, it } from 'vitest'

import {
  describeConsoleError,
  getConsoleErrorCode,
  getConsoleErrorCorrelationId,
  getConsoleErrorStatus
} from './console-errors'

const FALLBACK = 'No se pudieron cargar los datos de la página.'

describe('describeConsoleError', () => {
  it('maps 401 to a localized session/auth message', () => {
    expect(describeConsoleError({ status: 401, code: 'UNAUTHORIZED', message: 'invalid token' }, FALLBACK)).toMatch(/sesión/i)
  })

  it('maps 403 to a localized permission message', () => {
    const result = describeConsoleError({ status: 403, code: 'FORBIDDEN', message: 'requires superadmin' }, FALLBACK)
    expect(result).toMatch(/permiso/i)
  })

  it('maps 404 to a localized not-found message', () => {
    const result = describeConsoleError({ status: 404, code: 'NOT_FOUND', message: 'No action mapped for GET /v1/iam/realms/x/roles' }, FALLBACK)
    expect(result).toMatch(/no se encontró/i)
  })

  it('maps 409 to a localized conflict message', () => {
    expect(describeConsoleError({ status: 409, code: 'CONFLICT', message: 'slug already exists' }, FALLBACK)).toMatch(/conflicto/i)
  })

  it('maps 429 to a localized rate-limit message', () => {
    expect(describeConsoleError({ status: 429, code: 'RATE_LIMITED', message: 'too many requests' }, FALLBACK)).toMatch(/límite de solicitudes/i)
  })

  it('maps every 5xx to a localized service-unavailable message', () => {
    expect(describeConsoleError({ status: 500, code: 'HTTP_500', message: 'internal server error' }, FALLBACK)).toMatch(/no está disponible/i)
    expect(describeConsoleError({ status: 502, code: 'HTTP_502', message: 'bad gateway' }, FALLBACK)).toMatch(/no está disponible/i)
    expect(describeConsoleError({ status: 503, code: 'HTTP_503', message: 'service unavailable' }, FALLBACK)).toMatch(/no está disponible/i)
  })

  it('falls back to the page-supplied localized message for a network error (no status)', () => {
    expect(describeConsoleError(new TypeError('Failed to fetch'), FALLBACK)).toBe(FALLBACK)
  })

  it('falls back to the page-supplied localized message for an unrecognized/unknown thrown value', () => {
    expect(describeConsoleError('a raw string was thrown', FALLBACK)).toBe(FALLBACK)
    expect(describeConsoleError(undefined, FALLBACK)).toBe(FALLBACK)
    expect(describeConsoleError({ status: 418 }, FALLBACK)).toBe(FALLBACK)
  })

  // These two invariants are the regression lock for issue #743's confirmed live repro
  // (GET /v1/iam/realms/{tenantId}/roles → 403 {"code":"FORBIDDEN","message":"requires
  // superadmin"} rendered verbatim) plus its 404 sibling ("No action mapped for GET /v1/...").
  it('[#743] NEVER contains the raw backend message for a 403 FORBIDDEN', () => {
    const result = describeConsoleError({ status: 403, code: 'FORBIDDEN', message: 'requires superadmin' }, FALLBACK)
    expect(result).not.toContain('requires superadmin')
  })

  it('[#743] NEVER contains the raw backend message for a 404 unmapped-route error', () => {
    const result = describeConsoleError({ status: 404, code: 'NOT_FOUND', message: 'No action mapped for GET /v1/iam/realms/ten_alpha/roles' }, FALLBACK)
    expect(result).not.toContain('No action mapped')
  })

  it('never returns the page fallback for a mapped status even if the fallback itself contains English/raw-looking text', () => {
    const result = describeConsoleError({ status: 403, message: 'requires superadmin' }, 'HTTP_403 fallback')
    expect(result).not.toBe('HTTP_403 fallback')
  })
})

describe('getConsoleErrorStatus', () => {
  it('reads a numeric status off an error-shaped object', () => {
    expect(getConsoleErrorStatus({ status: 404 })).toBe(404)
  })

  it('returns undefined when there is no status', () => {
    expect(getConsoleErrorStatus(new Error('boom'))).toBeUndefined()
    expect(getConsoleErrorStatus(null)).toBeUndefined()
    expect(getConsoleErrorStatus('boom')).toBeUndefined()
  })
})

describe('getConsoleErrorCode', () => {
  it('reads a top-level code', () => {
    expect(getConsoleErrorCode({ code: 'FORBIDDEN' })).toBe('FORBIDDEN')
  })

  it('reads a code nested under body', () => {
    expect(getConsoleErrorCode({ body: { code: 'CONFLICT' } })).toBe('CONFLICT')
  })

  it('returns undefined when absent', () => {
    expect(getConsoleErrorCode({})).toBeUndefined()
  })
})

describe('getConsoleErrorCorrelationId', () => {
  it('prefers correlationId over requestId', () => {
    expect(getConsoleErrorCorrelationId({ correlationId: 'corr_1', requestId: 'req_1' })).toBe('corr_1')
  })

  it('falls back to requestId', () => {
    expect(getConsoleErrorCorrelationId({ requestId: 'req_1' })).toBe('req_1')
  })

  it('returns undefined when neither is present', () => {
    expect(getConsoleErrorCorrelationId({})).toBeUndefined()
    expect(getConsoleErrorCorrelationId(new Error('boom'))).toBeUndefined()
  })
})
