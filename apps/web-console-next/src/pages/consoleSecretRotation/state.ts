import type { ApiError } from '@in-falcone/console-api/http'

export interface Failure { status?: number; requestId: string; message: string }
export function failureOf(cause: unknown, newValue = ''): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  const redact = (text: unknown) => typeof text === 'string' ? (newValue ? text.split(newValue).join('…') : text) : ''
  return { status: typeof error.status === 'number' ? error.status : undefined,
    requestId: redact(error.requestId || error.correlationId), message: redact(error.message) }
}
