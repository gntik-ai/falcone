import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'

// Synthetic data only. The canary below is not a credential: the harness redacts it to a fixed mask inside the
// route handler, and verify-artifacts.mjs fails when it is found in any persisted artifact.
export const workspaceId = 'synthetic-workspace'
export const secretsPath = `/v1/functions/workspaces/${workspaceId}/secrets`
export const secretPath = (name: string) => `${secretsPath}/${encodeURIComponent(name)}`
export const cursorPath = `${secretsPath}?page%5Bafter%5D=cursor-2`
export const canary = 'synthetic-canary-value-7f3a91c2'
export const redacted = '[redacted-secret-value]'
export const typed = { requestId: 'req_synthetic_secrets', correlationId: 'corr_synthetic_secrets' }

const stamp = '2026-01-02T03:04:05Z'
export const secret = (secretName: string, extra: Record<string, unknown> = {}) => ({
  secretName, tenantId: 'synthetic-tenant', workspaceId, resolvedRefCount: 0, timestamps: { createdAt: stamp, updatedAt: stamp }, ...extra,
})
export const listBody = {
  items: [
    secret('db_password', { resolvedRefCount: 2, description: 'Synthetic database credential' }),
    secret('api_key'),
    secret('smtp_user', { timestamps: { createdAt: null, updatedAt: null } }),
  ],
  page: { size: 25 },
}
export const pagedFirst = { items: Array.from({ length: 25 }, (_, index) => secret(`secret_${String(index + 1).padStart(2, '0')}`)), page: { size: 25, nextCursor: 'cursor-2' } }
export const pagedSecond = { items: ['secret_26', 'secret_27', 'secret_28'].map((name) => secret(name)), page: { size: 25 } }
export const emptyBody = { items: [], page: { size: 25 } }
export const longNames = { items: ['a'.repeat(29), 'b'.repeat(63)].map((name) => secret(name, { description: 'Synthetic long identifier' })), page: { size: 25 } }
export const oneRow = { items: [secret('only_secret')], page: { size: 25 } }

const ok = (body: unknown, delayMs?: number): EndpointResponse => ({ status: 200, body, ...(delayMs ? { delayMs } : {}) })
const gone: EndpointResponse = { status: 204 }
const net: EndpointResponse = { network: true }
const error = (status: number, code = `HTTP_${status}`): EndpointResponse => ({ status, body: { status, code, message: 'synthetic-backend-reason', ...typed } })
const apiError = (status: number, code?: string): EndpointResponse => ({ status, body: { status, code: code ?? `HTTP_${status}`, message: 'synthetic-backend-reason', requestId: typed.requestId, correlationId: typed.correlationId } })

type Sequence = EndpointResponse[]
export interface Scenario {
  list?: Sequence
  page2?: Sequence
  create?: Sequence
  replace?: Sequence
  delete?: Sequence
  // Shell bootstrap: the active workspace and the session membership.
  shell?: { environment?: string; workspaces?: 'none' | 'two' | 'loading' | 'error' | 'one'; member?: boolean }
}
const base: Required<Pick<Scenario, 'list' | 'page2' | 'create' | 'replace' | 'delete'>> = {
  list: [ok(listBody)], page2: [ok(pagedSecond)], create: [ok(secret('new_secret'))], replace: [ok(secret('db_password'))], delete: [gone],
}
const withShell = (shell: Scenario['shell'], scenario: Scenario = {}): Scenario => ({ ...scenario, shell })
const sequence = (...items: EndpointResponse[]) => items

export const scenarios: Record<string, Scenario> = {
  'workspace-secrets.list.success': {},
  'workspace-secrets.list.paged': { list: [ok(pagedFirst)] },
  'workspace-secrets.list.page-2': { list: [ok(pagedFirst)] },
  'workspace-secrets.list.delayed': { list: [ok(listBody, 1500)] },
  'workspace-secrets.list.empty': { list: [ok(emptyBody)] },
  'workspace-secrets.list.long-names': { list: [ok(longNames)] },
  'workspace-secrets.list.501': { list: [apiError(501, 'SECRETS_BACKEND_DISABLED')] },
  'workspace-secrets.list.401-refresh-ok': { list: [error(401), ok(listBody)] },
  'workspace-secrets.list.401-after-refresh': { list: [error(401), error(401)] },
  'workspace-secrets.list.401-refresh-rejected': { list: [error(401)] },
  'workspace-secrets.list.403': { list: [apiError(403)] },
  'workspace-secrets.list.404': { list: [apiError(404, 'WORKSPACE_NOT_FOUND')] },
  'workspace-secrets.list.500-then-network-then-success': { list: sequence(apiError(500), net, ok(listBody)) },
  'workspace-secrets.list.page-2-500-then-network-then-success': { list: [ok(pagedFirst)], page2: sequence(apiError(500), net, ok(pagedSecond)) },
  'workspace-secrets.list.page-2.500-then-network-then-success': { list: [ok(pagedFirst)], page2: sequence(apiError(500), net, ok(pagedSecond)) },
  'workspace-secrets.create.success': {},
  'workspace-secrets.create.validation-errors': {},
  'workspace-secrets.create.500-then-success': { create: sequence(apiError(500), ok(secret('new_secret'))) },
  'workspace-secrets.create.500-then-network-then-success': { create: sequence(apiError(500), net, ok(secret('new_secret'))) },
  'workspace-secrets.create.403': { create: [apiError(403)] },
  'workspace-secrets.create.404': { create: [apiError(404, 'WORKSPACE_NOT_FOUND')] },
  'workspace-secrets.replace.success': {},
  'workspace-secrets.replace.later-page-success': { list: [ok(pagedFirst), ok(pagedFirst)], replace: [ok(secret('secret_26'))] },
  'workspace-secrets.replace.500-then-success': { replace: sequence(apiError(500), ok(secret('db_password'))) },
  'workspace-secrets.replace.500-then-network-then-success': { replace: sequence(apiError(500), net, ok(secret('db_password'))) },
  'workspace-secrets.replace.403': { replace: [apiError(403)] },
  'workspace-secrets.replace.404-secret-not-found': { replace: [apiError(404, 'SECRET_NOT_FOUND')] },
  'workspace-secrets.replace-and-delete.404-generic': { replace: [apiError(404, 'WORKSPACE_NOT_FOUND')], delete: [apiError(404, 'WORKSPACE_NOT_FOUND')] },
  'workspace-secrets.delete.success': {},
  'workspace-secrets.delete.unreferenced-staging': withShell({ environment: 'staging' }),
  'workspace-secrets.delete.last-row': { list: [ok(oneRow), ok(emptyBody)] },
  'workspace-secrets.delete.500': { delete: [apiError(500)] },
  'workspace-secrets.delete.500-then-success': { delete: sequence(apiError(500), gone) },
  'workspace-secrets.delete.500-then-network-then-success': { delete: sequence(apiError(500), net, gone) },
  'workspace-secrets.delete.403': { delete: [apiError(403)] },
  'workspace-secrets.delete.404-secret-not-found': { delete: [apiError(404, 'SECRET_NOT_FOUND')] },
  'shell.workspace-production': withShell({ environment: 'production' }),
  'shell.workspace-live-environment': withShell({ environment: 'production' }),
  'shell.workspace-staging': withShell({ environment: 'staging' }),
  'shell.non-member': withShell({ member: false }),
  'shell.no-active-workspace': withShell({ workspaces: 'none' }),
  'shell.workspace-switch': withShell({ workspaces: 'two' }),
  'shell.workspace-loading': withShell({ workspaces: 'loading' }),
  'shell.workspace-error': withShell({ workspaces: 'error' }),
}
export const fixtureIds = Object.keys(scenarios)

// Serves one scenario: each operation consumes its own response sequence, repeating the last item.
export function createScenario(id: string) {
  const scenario = { ...base, ...scenarios[id] } as Scenario & typeof base
  const attempts: Record<string, number> = {}
  const calls: { method: string; path: string; body: unknown }[] = []
  const next = (key: keyof typeof base) => { const items = scenario[key]; const at = attempts[key] ?? 0; attempts[key] = at + 1; return items[Math.min(at, items.length - 1)] }
  return {
    calls,
    handle(method: string, path: string, body?: unknown): EndpointResponse | undefined {
      calls.push({ method, path, body })
      const [pathname, search = ''] = path.split('?')
      if (pathname === secretsPath) {
        if (method === 'GET') return next(search ? 'page2' : 'list')
        if (method === 'POST' && !search) return next('create')
      } else if (pathname.startsWith(`${secretsPath}/`) && !search) {
        if (method === 'PUT') return next('replace')
        if (method === 'DELETE') return next('delete')
      }
      return undefined
    },
  }
}

export const endpoints: Record<string, PageEndpoint> = {
  'workspace-secrets.list': { method: 'GET', path: secretsPath, fixtures: { success: ok(listBody), empty: ok(emptyBody), paged: ok(pagedFirst) } },
  'workspace-secrets.create': { method: 'POST', path: secretsPath, fixtures: { success: ok(secret('new_secret')) } },
}

// The CSP harness registers only the query-less list GET; writes and cursor reads stay unmatched there.
export const workspaceSecretsEndpoints: Record<string, PageEndpoint> = {
  'workspace-secrets.list': endpoints['workspace-secrets.list'],
}

// Approved deliberate differences from legacy, all bounded to presentation.
export const deliberateChanges = [
  'Replace and delete are typed-name confirmed; the legacy replace and unreferenced delete were not.',
  'Cursor pagination adds Cargar más secretos; the legacy page showed only the first page.',
  'List, create, replace and delete 403, 404, 500 and network failures render dedicated states with recovery actions.',
  'The kit reveal toggle is not used on secret value fields.',
]

const manifest: ParityManifest = {
  route: '/console/workspace-secrets', roles: ['superadmin', 'tenant_owner'], endpoints,
  fixtures: ['refresh:success', 'refresh:401', ...fixtureIds],
  sources: ['src/pages/consoleWorkspaceSecrets.tsx', 'src/pages/consoleWorkspaceSecrets'],
  data: [{ name: 'secrets title', locator: { es: 'h1:text-is("Secretos del área de trabajo")', en: 'h1:text-is("Workspace secrets")' } }],
  actions: [],
  states: [
    { fixture: 'workspace-secrets.list', variant: 'empty', locator: { es: 'h2:text-is("No hay secretos en esta área de trabajo")', en: 'h2:text-is("There are no secrets in this workspace")' } },
  ],
}
export default manifest
