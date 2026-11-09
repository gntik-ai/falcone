import type { ApiError } from '@in-falcone/console-api/http'

export interface Failure { status?: number; requestId: string; message: string }
// The shared transport uses HTTP reason phrases when no JSON message is available.
// Keep those fallbacks out of product copy while preserving server messages.
const transportMessages = new Set([
  'Request failed', 'Bad Request', 'Unauthorized', 'Payment Required', 'Forbidden', 'Not Found',
  'Method Not Allowed', 'Not Acceptable', 'Request Timeout', 'Conflict', 'Gone',
  'Length Required', 'Precondition Failed', 'Payload Too Large', 'URI Too Long',
  'Unsupported Media Type', 'Range Not Satisfiable', 'Expectation Failed',
  'Unprocessable Entity', 'Unprocessable Content', 'Too Many Requests',
  'Internal Server Error', 'Not Implemented', 'Bad Gateway', 'Service Unavailable', 'Gateway Timeout',
])
export function failureOf(cause: unknown, newValue = ''): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  const redact = (text: unknown) => typeof text === 'string' ? (newValue ? text.split(newValue).join('…') : text) : ''
  const status = typeof error.status === 'number' ? error.status : undefined
  const message = status !== undefined && !transportMessages.has(error.message ?? '') ? redact(error.message) : ''
  return { status, requestId: redact(error.requestId || error.correlationId), message }
}
