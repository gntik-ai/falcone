import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
import { canary } from './console-workspace-secrets-page.manifest'

export const workspaceId = 'synthetic-workspace'
export const databasePath = `/v1/workspaces/${workspaceId}/database`
export const rotationPath = `${databasePath}/credential-rotations`
// Reuse the existing canary without adding its literal to the PR diff captured in CI reports.
export const password = canary
export const dsn = `postgresql://synthetic_role:${password}@synthetic-db.example.test:5432/synthetic_database`
export const hint = 'uses the platform DB credential (no CREATEROLE on this deploy)'
export const reason = 'shared-mode database has no dedicated credential to rotate'
export const unknownReason = 'synthetic-unmapped-rotation-reason'
export const record = { id: 'synthetic-database', workspace_id: workspaceId, tenant_id: 'synthetic-tenant', database_name: 'synthetic_database', engine: 'postgresql', mode: 'dedicated_role', username: 'synthetic_role', host: 'synthetic-db.example.test', port: 5432, status: 'ready', created_at: '2026-01-02T03:04:05Z' }
export const sharedDsn = `postgresql://synthetic_platform@${record.host}:${record.port}/${record.database_name}`
export const connection = { mode: record.mode, engine: record.engine, database: record.database_name, host: record.host, port: record.port, username: record.username, password, passwordHint: null, dsn, sslmode: 'disable' }
export const provisioned = { database: record, connection }
export const rotated = { databaseId: record.id, rotated: true, mode: record.mode, database: record.database_name, username: record.username, password, dsn }
export const requestId = 'req_synthetic_database'
export const ok = (body: unknown, delayMs?: number): EndpointResponse => ({ status: 200, body, delayMs })
export const error = (status: number, code = `HTTP_${status}`): EndpointResponse => ({ status, body: { status, code, message: 'synthetic-server-text-never-interface-copy', requestId } })
export const net: EndpointResponse = { network: true }
export interface Scenario { get?: EndpointResponse[]; provision?: EndpointResponse[]; rotate?: EndpointResponse[]; shell?: 'none' | 'two' | 'loading' | 'error' | 'empty'; role?: 'tenant_owner' | 'tenant_viewer' }
export const scenarios: Record<string, Scenario> = {
  'workspace-database.get.success': {},
  'workspace-database.get.delayed': { get: [ok({ database: record }, 1500)] },
  'workspace-database.get.401-refresh-ok': { get: [error(401), ok({ database: record })] },
  'workspace-database.get.401-refresh-rejected': { get: [error(401)] },
  'workspace-database.provision.dedicated': { get: [error(404)] },
  'workspace-database.provision.shared': { get: [error(404)], provision: [ok({ database: { ...record, mode: 'shared' }, connection: { ...connection, mode: 'shared', password: null, passwordHint: hint, dsn: sharedDsn } })] },
  'workspace-database.rotate.success': {},
  'workspace-database.rotate.not-rotated': { rotate: [ok({ databaseId: record.id, rotated: false, reason })] },
  'workspace-database.rotate.not-rotated-unknown-reason': { rotate: [ok({ databaseId: record.id, rotated: false, reason: unknownReason })] },
  'workspace-database.rotate.409-db-shared-mode': { rotate: [error(409, 'DB_SHARED_MODE')] },
  'shell.no-active-workspace': { shell: 'none' },
  'shell.workspace-switch': { shell: 'two' },
  'shell.workspaces-loading': { shell: 'loading' },
  'shell.workspaces-error': { shell: 'error' },
  'shell.no-workspaces-owner': { shell: 'empty', role: 'tenant_owner' },
  'shell.no-workspaces-viewer': { shell: 'empty', role: 'tenant_viewer' },
}
for (const op of ['get', 'provision', 'rotate'] as const) {
  for (const status of [403, 404, 500, 409, 'network'] as const) scenarios[`workspace-database.${op}.${status}`] = {
    ...(op === 'provision' ? { get: [error(404)] } : {}), [op]: [status === 'network' ? net : error(status)],
  }
  for (const status of [500, 'network'] as const) scenarios[`workspace-database.${op}.${status}-then-success`] = {
    ...(op === 'provision' ? { get: [error(404)] } : {}), [op]: [status === 'network' ? net : error(status), ok(op === 'get' ? { database: record } : op === 'provision' ? provisioned : rotated)],
  }
}
export const fixtureIds = Object.keys(scenarios)
export function createScenario(id: string) {
  if (!Object.hasOwn(scenarios, id)) throw new Error(`Unknown database fixture: ${id}`)
  const scenario = { get: [ok({ database: record })], provision: [ok(provisioned)], rotate: [ok(rotated)], ...scenarios[id] }
  const calls: { method: string; path: string; body: unknown }[] = []
  const counts = { get: 0, provision: 0, rotate: 0 }
  return { calls, handle(method: string, path: string, body?: unknown): EndpointResponse | undefined {
    const op = method === 'GET' && path === databasePath ? 'get' : method === 'POST' && path === databasePath ? 'provision' : method === 'POST' && path === rotationPath ? 'rotate' : null
    if (!op || (op !== 'get' && (JSON.stringify(body) !== '{}'))) return undefined
    calls.push({ method, path, body })
    const sequence = scenario[op]
    return sequence[Math.min(counts[op]++, sequence.length - 1)]
  } }
}
export const endpoints: Record<string, PageEndpoint> = {
  'workspace-database.get': { method: 'GET', path: databasePath, fixtures: { success: ok({ database: record }), empty: error(404) } },
  'workspace-database.provision': { method: 'POST', path: databasePath, fixtures: { success: ok(provisioned) } },
  'workspace-database.rotate': { method: 'POST', path: rotationPath, fixtures: { success: ok(rotated) } },
}
const manifest: ParityManifest = {
  route: '/console/database', roles: ['superadmin', 'tenant_owner', 'tenant_viewer'], endpoints, fixtures: fixtureIds,
  sources: ['src/pages/consoleWorkspaceDatabase.tsx', 'src/pages/consoleWorkspaceDatabase'],
  data: [{ name: 'database name', locator: 'dd:text-is("synthetic_database")' }], actions: [],
  states: [{ fixture: 'workspace-database.get', variant: 'empty', locator: { es: 'h2:text-is("Sin base de datos aprovisionada")', en: 'h2:text-is("No database provisioned")' } }],
}
export default manifest
