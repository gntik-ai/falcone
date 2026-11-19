import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import { createRequestId, type JsonValue } from '@in-falcone/console-api/http'
import { failureOf, type Failure } from './api'

// Contract CA-1302-1 (sha256 abd13406767f14579bf13744da417c122f7117cb5be7f26961b07c097ad94c23):
// POST /v1/workspaces/{workspaceId}/databases takes an optional Idempotency-Key that must match this pattern.
export const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/
export const newKey = () => createRequestId('idem')
// CA-1302-1 asks for the retry after Retry-After: 1, at most five times with the same key. The wire layer drops headers, so the delay is fixed.
export const IN_PROGRESS_DELAY_MS = 1000
export const IN_PROGRESS_RETRIES = 5

export type Engine = 'mongodb' | 'postgresql'
export type DbForm = { engine: Engine; name: string; items: string[] }
export const bodyOf = ({ engine, name, items }: DbForm) => ({ engine, name, extensions: engine === 'postgresql' ? items : [], collections: engine === 'mongodb' ? items : [] })
export const submitPath = (workspace: string) => `/v1/workspaces/${workspace}/databases`

export type Outcome =
  | { kind: 'success'; databaseId: string }
  | { kind: 'retry'; failure: Failure }            // 5xx (including 503 IDEMPOTENCY_UNAVAILABLE) and network failures; same key
  | { kind: 'progress'; failure: Failure }         // 409 IDEMPOTENCY_KEY_IN_PROGRESS; same key
  | { kind: 'replay-unavailable'; failure: Failure } // 409 IDEMPOTENCY_REPLAY_UNAVAILABLE; the database may exist
  | { kind: 'mismatch'; failure: Failure }         // 422 IDEMPOTENCY_KEY_MISMATCH; next submit uses a new key
  | { kind: 'invalid-key'; failure: Failure }      // 400 INVALID_IDEMPOTENCY_KEY; new key, no automatic retry
  | { kind: 'forbidden'; failure: Failure }
  | { kind: 'expired'; failure: Failure }
  | { kind: 'conflict'; failure: Failure }         // any other 409
  | { kind: 'invalid'; failure: Failure }          // any other 422 or 400
  | { kind: 'rejected'; failure: Failure }
  | { kind: 'aborted' }

export function classify(cause: unknown, requestId: string): Outcome {
  if ((cause as { name?: string } | null)?.name === 'AbortError') return { kind: 'aborted' }
  const failure = { ...failureOf(cause), requestId: failureOf(cause).requestId ?? requestId }
  const { status, code } = failure
  if (status === undefined || status >= 500) return { kind: 'retry', failure }
  if (status === 401) return { kind: 'expired', failure }
  if (status === 403) return { kind: 'forbidden', failure }
  if (status === 400) return code === 'INVALID_IDEMPOTENCY_KEY' ? { kind: 'invalid-key', failure } : { kind: 'invalid', failure }
  if (status === 409) return code === 'IDEMPOTENCY_KEY_IN_PROGRESS' ? { kind: 'progress', failure } : code === 'IDEMPOTENCY_REPLAY_UNAVAILABLE' ? { kind: 'replay-unavailable', failure } : { kind: 'conflict', failure }
  if (status === 422) return code === 'IDEMPOTENCY_KEY_MISMATCH' ? { kind: 'mismatch', failure } : { kind: 'invalid', failure }
  return { kind: 'rejected', failure }
}

// Only databaseId is read from the 201: the PostgreSQL body carries a one-time credential that must never be rendered, stored or announced.
export async function send(workspace: string, form: DbForm, key: string, signal: AbortSignal): Promise<Outcome> {
  const requestId = createRequestId('wiz')
  try {
    const response = await requestConsoleSessionJson<{ databaseId?: unknown } | null>(submitPath(workspace), {
      method: 'POST', body: bodyOf(form) as JsonValue, signal, headers: { 'Idempotency-Key': key, 'X-Request-Id': requestId },
    })
    return { kind: 'success', databaseId: typeof response?.databaseId === 'string' ? response.databaseId : '' }
  } catch (cause) {
    return classify(cause, requestId)
  }
}
