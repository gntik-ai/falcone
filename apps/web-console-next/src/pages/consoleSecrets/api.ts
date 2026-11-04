import { requestJson, type ApiError } from '@in-falcone/console-api/http'
import { ensureConsoleSession, invalidateConsoleShellSession, refreshConsoleShellSession, requestConsoleSessionJson, storeProtectedRouteIntent, type ConsoleShellSession } from '@in-falcone/console-api/session'

export interface SecretRow {
  name: string
  domain: 'platform' | 'tenant'
  tenantId: string | null
  path: string
  currentVersion: { vaultVersion: number; state: 'active' | 'grace'; activatedAt: string } | null
  requiresForce: boolean
}
export interface Inventory { secrets: SecretRow[]; offset: number; limit: number }
export type Failure = Pick<Partial<ApiError>, 'status' | 'requestId'>
export const failureOf = (cause: unknown): Failure => {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return { status: error.status, requestId: error.requestId ?? error.correlationId }
}
export function boundTenant(session: ConsoleShellSession | null): string | null {
  const ids = session?.principal?.tenantIds
  return ids?.length === 1 && ids[0] ? ids[0] : null
}
export function canRevoke(row: SecretRow, session: ConsoleShellSession | null): boolean {
  if (!row.currentVersion || !Number.isSafeInteger(row.currentVersion.vaultVersion) || row.currentVersion.vaultVersion < 1 || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(row.name)) return false
  if (row.domain === 'platform') return row.path === `platform/${row.name}`
  const tenant = boundTenant(session)
  return row.domain === 'tenant' && Boolean(tenant) && row.tenantId === tenant && row.path === `tenant/${tenant}/${row.name}`
}
export async function loadInventory(tenant: string | null, signal: AbortSignal): Promise<SecretRow[]> {
  const results = await Promise.allSettled([
    requestConsoleSessionJson<Inventory>('/v1/secrets/inventory?domain=platform', { method: 'GET', signal }),
    requestConsoleSessionJson<Inventory>(`/v1/secrets/inventory?domain=tenant${tenant ? `&tenantId=${encodeURIComponent(tenant)}` : ''}`, { method: 'GET', signal }),
  ])
  const failures = results.flatMap((result) => result.status === 'rejected' ? [failureOf(result.reason)] : [])
  // Whole-page failure: no successful domain may hide a failure in the other one.
  if (failures.length) throw failures.find((error) => error.status !== 403 && error.status !== 404) ?? failures.find((error) => error.status === 403) ?? failures[0]
  return results.flatMap((result) => result.status === 'fulfilled' ? result.value.secrets : [])
}
export async function revokeVersion(row: SecretRow, justification: string, forceRevoke: boolean) {
  const session = await ensureConsoleSession()
  const token = session?.tokenSet?.accessToken?.trim()
  if (!token) { storeProtectedRouteIntent('/console/secrets'); invalidateConsoleShellSession(); throw { status: 401 } }
  // Resolve the binding again after ensureConsoleSession, which may refresh the principal.
  if (!canRevoke(row, session)) throw { status: 403, code: 'UNBOUND_SECRET' }
  try {
    return await requestJson(`/v1/platform/secrets/${encodeURIComponent(row.domain)}/${encodeURIComponent(row.name)}/versions/${row.currentVersion!.vaultVersion}/revoke`, {
      method: 'POST', body: { justification, forceRevoke }, headers: { Authorization: `Bearer ${token}` },
    })
  } catch (cause) {
    if (failureOf(cause).status === 401) {
      // This irreversible operation must never use the session client's automatic replay.
      await refreshConsoleShellSession()
      storeProtectedRouteIntent('/console/secrets')
      invalidateConsoleShellSession()
    }
    throw cause
  }
}
export const rotationHref = (row: SecretRow) => `/console/secrets/${encodeURIComponent(row.path)}/rotate`
