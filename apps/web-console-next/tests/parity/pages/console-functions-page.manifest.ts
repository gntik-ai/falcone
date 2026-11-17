import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'

// Synthetic fixtures for /console/functions. Every request path and body mirrors the legacy page
// (apps/web-console/src/pages/ConsoleFunctionsPage.tsx); the names follow the migration issue.
const workspace = 'synthetic-workspace'
const root = '/v1/functions'
export const inventoryPath = `${root}/workspaces/${workspace}/inventory`
export const actionsPath = `${root}/workspaces/${workspace}/actions`
export const actionPath = (n: number) => `${root}/actions/synthetic-function-${n}`
export const createPath = `${root}/actions`
export const activationPath = (n = 1) => `${actionPath(1)}/activations/synthetic-activation-${n}`
export const query = '?page[size]=50'

const execution = { runtime: 'nodejs:20', entrypoint: 'main', environment: { SYNTHETIC_MODE: 'test' }, limits: { timeoutMs: 30000, memoryMb: 256, concurrentInvocations: 5 }, parameters: { greeting: 'synthetic-hello' } }
export const action = (n: number, name: string, state = 'active') => ({
  resourceId: `synthetic-function-${n}`, tenantId: 'synthetic-tenant', workspaceId: workspace, actionName: name, packageName: 'synthetic-package', namespaceName: 'synthetic-namespace',
  status: state === 'active' ? 'active' : undefined, activeVersionId: 'synthetic-version-3', rollbackAvailable: true, versionCount: 3, deploymentDigest: 'sha256:synthetic-digest',
  execution, activationPolicy: { mode: 'workspace_default', retentionDays: 7 }, source: { kind: 'inline_code', inlineCode: 'exports.main = () => ({ ok: true })', entryFile: 'index.js' },
  provisioning: { state, failureClass: state === 'degraded' ? 'synthetic-failure' : undefined },
  httpExposure: { enabled: true, publicUrl: 'https://synthetic.example.test/hello', authPolicy: 'bearer' },
  kafkaTriggers: [{ triggerId: 'synthetic-kafka', topicRef: 'synthetic-orders', status: 'active', deliveryMode: 'at_least_once' }],
  cronTriggers: [{ triggerId: 'synthetic-cron', schedule: '*/5 * * * *', timezone: 'UTC', status: 'active' }],
  storageTriggers: [{ triggerId: 'synthetic-storage', bucketRef: 'synthetic-bucket', eventTypes: ['created', 'deleted'], status: 'active' }],
  secretReferences: [{ secretName: 'synthetic-secret' }], timestamps: { createdAt: '2026-05-01T10:00:00Z', updatedAt: '2026-05-30T10:00:00Z' },
})
export const functions3 = [action(1, 'synthetic-hello'), action(2, 'synthetic-billing'), action(3, 'synthetic-orders')]
export const counts = { actions: 3, packages: 1, triggers: 2, httpExposures: 1 }
export const inventory = (quotaStatus?: Record<string, number>) => ({ workspaceId: workspace, actions: functions3, counts, ...(quotaStatus ? { quotaStatus } : {}) })
export const actions60 = { items: Array.from({ length: 60 }, (_, index) => action(index + 1, `synthetic-fn-${String(index + 1).padStart(2, '0')}`)) }
export const versions3 = { items: [
  { versionId: 'synthetic-version-1', resourceId: 'synthetic-function-1', versionNumber: 1, status: 'historical', originType: 'deploy', rollbackEligible: true, timestamps: { createdAt: '2026-05-01T10:00:00Z' } },
  { versionId: 'synthetic-version-2', resourceId: 'synthetic-function-1', versionNumber: 2, status: 'historical', originType: 'update', rollbackEligible: true, timestamps: { createdAt: '2026-05-10T10:00:00Z' } },
  { versionId: 'synthetic-version-3', resourceId: 'synthetic-function-1', versionNumber: 3, status: 'active', originType: 'rollback', rollbackEligible: false, timestamps: { createdAt: '2026-05-20T10:00:00Z' } },
] }
export const activations = (count: number) => ({ items: Array.from({ length: count }, (_, index) => ({
  activationId: `synthetic-activation-${index + 1}`, resourceId: 'synthetic-function-1', status: index === 1 ? 'failed' : 'success', startedAt: `2026-06-01T11:${String(59 - (index % 60)).padStart(2, '0')}:00Z`, durationMs: 12 + index, triggerKind: 'http',
})), page: { total: count } })
export const activationDetail = { activationId: 'synthetic-activation-1', resourceId: 'synthetic-function-1', status: 'success', startedAt: '2026-06-01T11:59:00Z', finishedAt: '2026-06-01T11:59:01Z', durationMs: 12, triggerKind: 'http', statusCode: 200, memoryMb: 128, invocationId: 'synthetic-invocation-1', policy: { retentionDays: 7 } }
export const logs = { activationId: 'synthetic-activation-1', lines: ['synthetic log line one', 'synthetic log line two'], truncated: false }
export const result = { activationId: 'synthetic-activation-1', status: 'success', result: { greeting: 'synthetic-hello', count: 2 }, contentType: 'application/json' }
export const invocation = { invocationId: 'synthetic-invocation-1', resourceId: 'synthetic-function-1', status: 'accepted', acceptedAt: '2026-06-01T12:00:00Z', activationId: 'synthetic-activation-1' }
export const accepted = (status = 'accepted') => ({ requestId: 'req_synthetic_accepted', resourceId: 'synthetic-function-1', status, correlationId: 'synthetic-corr', acceptedAt: '2026-06-01T12:00:00Z' })
export const rollbackAccepted = { requestId: 'req_synthetic_rollback', resourceId: 'synthetic-function-1', requestedVersionId: 'synthetic-version-2', status: 'accepted', correlationId: 'synthetic-corr', acceptedAt: '2026-06-01T12:00:00Z' }

export const failure = (status: number, extra: Record<string, unknown> = {}): EndpointResponse => ({ status, body: { status, code: `HTTP_${status}`, message: 'synthetic-error', requestId: `req_synthetic_functions_${status}`, ...extra } })
const ok = (body: unknown): EndpointResponse => ({ body })
const endpoint = (method: string, path: string, fixtures: Record<string, EndpointResponse | EndpointResponse[]>): PageEndpoint => ({ method, path, fixtures })
const states = ['provisioning', 'degraded', 'suspended', 'unavailable', 'deletion_pending']
const stateFixtures = (n: number, name: string) => Object.fromEntries(states.map((state) => [state, ok(action(n, name, state))]))
const errors = { '401': failure(401), '403': failure(403), '404': failure(404), '500': failure(500), network: { network: true } } as const
// A write that fails once and then succeeds, to observe the retry.
const retry = (fail: EndpointResponse, success: unknown) => [fail, ok(success)]

export const functionsEndpoints = {
  'functions-inventory': endpoint('GET', inventoryPath, {
    success: ok(inventory({ limit: 50, used: 3, remaining: 47 })), 'inventory-3': ok(inventory()), 'quota-available': ok(inventory({ limit: 50, used: 3, remaining: 47 })),
    'quota-near-limit': ok(inventory({ limit: 50, used: 46, remaining: 4 })), 'quota-exhausted': ok(inventory({ limit: 50, used: 50, remaining: 0 })), 'quota-remaining-only': ok(inventory({ limit: 50, remaining: 4 })),
    empty: ok({ workspaceId: workspace, actions: [], counts: { actions: 0, packages: 0, triggers: 0, httpExposures: 0 } }), ...errors,
    '401-then-ok': [failure(401), ok(inventory())], deleted: ok({ workspaceId: workspace, actions: functions3.slice(1), counts: { ...counts, actions: 2 } }),
    created: ok({ workspaceId: workspace, actions: [...functions3, action(4, 'synthetic-new')], counts: { ...counts, actions: 4 } }),
  }),
  'functions-actions': endpoint('GET', actionsPath, { success: ok({ items: functions3 }), 'actions-60': ok(actions60), '500': failure(500), '403': failure(403), network: { network: true } }),
  'functions-detail': endpoint('GET', actionPath(1), { success: ok(action(1, 'synthetic-hello')), 'action-detail': ok(action(1, 'synthetic-hello')), ...stateFixtures(1, 'synthetic-hello'), ...errors, 'network-then-ok': retry({ network: true }, action(1, 'synthetic-hello')), '500-then-ok': retry(failure(500), action(1, 'synthetic-hello')),
    '404-after-delete': failure(404), loaded: ok(action(1, 'synthetic-hello')) }),
  'functions-detail-2': endpoint('GET', actionPath(2), { success: ok(action(2, 'synthetic-billing')) }),
  'functions-detail-4': endpoint('GET', actionPath(4), { success: ok(action(4, 'synthetic-new')) }),
  'functions-versions': endpoint('GET', `${actionPath(1)}/versions`, { success: ok(versions3), 'versions-3': ok(versions3), empty: ok({ items: [] }), 'none-eligible': ok({ items: versions3.items.map((item) => ({ ...item, rollbackEligible: false })) }), ...errors, '500-then-ok': retry(failure(500), versions3) }),
  'functions-versions-2': endpoint('GET', `${actionPath(2)}/versions`, { success: ok({ items: [] }) }),
  'functions-versions-4': endpoint('GET', `${actionPath(4)}/versions`, { success: ok({ items: [] }) }),
  'functions-activations': endpoint('GET', `${actionPath(1)}/activations`, { success: ok(activations(3)), 'activations-50': ok(activations(50)), empty: ok({ items: [] }), ...errors, '500-then-ok': retry(failure(500), activations(3)) }),
  'functions-activation': endpoint('GET', activationPath(), { success: ok(activationDetail), running: ok({ ...activationDetail, status: 'running', finishedAt: undefined }), ...errors, '500-then-ok': retry(failure(500), activationDetail) }),
  'functions-logs': endpoint('GET', `${activationPath()}/logs`, { success: ok(logs), empty: ok({ ...logs, lines: [] }), truncated: ok({ ...logs, truncated: true }), none: ok(null), ...errors, '500-then-ok': retry(failure(500), logs) }),
  'functions-result': endpoint('GET', `${activationPath()}/result`, { success: ok(result), none: ok(null), binary: ok({ ...result, contentType: 'application/octet-stream' }), 'no-result': ok({ ...result, result: null }), ...errors, '500-then-ok': retry(failure(500), result) }),
  'functions-create': endpoint('POST', createPath, { success: ok(accepted()), 'create-accepted': ok({ ...accepted(), resourceId: 'synthetic-function-4' }), '500': failure(500), network: { network: true }, '500-then-ok': retry(failure(500), { ...accepted(), resourceId: 'synthetic-function-4' }), 'network-then-ok': retry({ network: true }, { ...accepted(), resourceId: 'synthetic-function-4' }) }),
  'functions-update': endpoint('PATCH', actionPath(1), { success: ok(accepted()), 'update-accepted': ok(accepted()), '500': failure(500), network: { network: true }, '500-then-ok': retry(failure(500), accepted()), 'network-then-ok': retry({ network: true }, accepted()) }),
  'functions-invoke': endpoint('POST', `${actionPath(1)}/invocations`, { success: ok(invocation), 'invoke-accepted': ok(invocation), 'invoke-429': failure(429), '500': failure(500), 'invoke-quota-exceeded': failure(402, { code: 'QUOTA_EXCEEDED' }), 'invoke-quota-message-400': failure(400, { message: 'synthetic quota message' }),
    network: { network: true }, '500-then-ok': retry(failure(500), invocation), 'network-then-ok': retry({ network: true }, invocation), 'inline-result': ok({ ...invocation, result: { greeting: 'synthetic-hello' }, logs: ['synthetic inline log'] }) }),
  'functions-rollback': endpoint('POST', `${actionPath(1)}/rollback`, { success: ok(rollbackAccepted), 'rollback-accepted': ok(rollbackAccepted), '500': failure(500), network: { network: true }, '500-then-ok': retry(failure(500), rollbackAccepted), 'network-then-ok': retry({ network: true }, rollbackAccepted) }),
  'functions-delete': endpoint('DELETE', actionPath(1), { success: ok(accepted()), 'delete-accepted': ok(accepted()), '500': failure(500), network: { network: true }, '500-then-ok': retry(failure(500), accepted()), 'network-then-ok': retry({ network: true }, accepted()) }),
  'functions-delete-2': endpoint('DELETE', actionPath(2), { success: ok(accepted()) }),
} satisfies Record<string, PageEndpoint>

// The six read endpoints whose injected 500 the harness consumes as a resource diagnostic (functions:section-500).
export const sectionFailureEndpoints = ['functions-detail', 'functions-versions', 'functions-activations', 'functions-activation', 'functions-logs', 'functions-result']

const manifest: ParityManifest = {
  route: '/console/functions', roles: ['superadmin', 'workspace_viewer'], endpoints: functionsEndpoints,
  fixtures: [
    'functions:inventory-3', 'functions:quota-available', 'functions:quota-near-limit', 'functions:quota-exhausted', 'functions:quota-remaining-only', 'functions:inventory-500-actions-60', 'functions:action-detail', 'functions:versions-3',
    'functions:activations-50', 'functions:activation-detail-logs-result', 'functions:create-accepted', 'functions:update-accepted', 'functions:rollback-accepted', 'functions:invoke-accepted', 'functions:delete-accepted',
    'functions:inventory-empty', 'shell:tenant-none', 'shell:workspace-none', 'functions:section-empties', 'functions:activation-running', 'functions:activation-no-logs-no-result', 'functions:action-write-states', 'functions:inventory-401',
    'functions:inventory-403', 'functions:detail-403', 'functions:activation-logs-403', 'functions:action-404', 'functions:activation-404', 'functions:inventory-500', 'functions:section-500', 'functions:inventory-network',
    'functions:section-network-after-load', 'functions:invoke-429', 'functions:write-500-retry', 'functions:write-network-retry', 'functions:inventory-401-refresh-ok', 'functions:inventory-401-refresh-rejected',
    'functions:invoke-quota-exceeded', 'functions:invoke-quota-message-400',
  ],
  sources: ['src/pages/consoleFunctions.tsx', 'src/pages/consoleFunctions'],
  data: [{ name: 'functions-title', locator: '[data-testid="console-functions-page"] h1' }], actions: [], states: [],
}
export default manifest
