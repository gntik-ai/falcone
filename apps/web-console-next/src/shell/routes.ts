export type GuardKind = 'superadmin' | 'observer' | 'secrets'

export interface PendingConsoleRoute {
  path: string
  migrated?: boolean
  guard?: GuardKind
  handle?: { platformGlobal: boolean }
}

// Keep authorization and context scope next to each route, as in the legacy router.
export const pendingConsoleRoutes: PendingConsoleRoute[] = [
  { path: 'tenants' },
  { path: 'workspaces' },
  { path: 'database' },
  { path: 'functions-registry' },
  { path: 'iam-access', guard: 'superadmin' },
  { path: 'members' },
  { path: 'plans', guard: 'superadmin', handle: { platformGlobal: true } },
  { path: 'plans/new', guard: 'superadmin', handle: { platformGlobal: true } },
  { path: 'plans/:planId', guard: 'superadmin', handle: { platformGlobal: true } },
  { path: 'tenants/:tenantId/plan', guard: 'superadmin' },
  { path: 'my-plan' },
  { path: 'my-plan/allocation' },
  { path: 'workspaces/:workspaceId' },
  { path: 'auth', guard: 'superadmin' },
  { path: 'auth-config' },
  { path: 'postgres' },
  { path: 'postgres/data' },
  { path: 'mongo' },
  { path: 'mongo/data' },
  { path: 'kafka' },
  { path: 'events/data' },
  { path: 'functions' },
  { path: 'functions/data' },
  { path: 'realtime/changes' },
  { path: 'flows' },
  { path: 'flows/:flowId' },
  { path: 'flows/:flowId/runs' },
  { path: 'flows/:flowId/runs/:executionId' },
  { path: 'storage' },
  { path: 'observability' },
  { path: 'runtime', guard: 'observer', handle: { platformGlobal: true } },
  { path: 'service-accounts' },
  { path: 'quotas' },
  { path: 'operations' },
  { path: 'operations/:operationId' },
  { path: 'mcp/servers/:mcpServerId' },
  { path: 'workspaces/:workspaceId/realtime' },
  { path: 'workspaces/:workspaceId/docs' },
  { path: 'secrets' },
  { path: 'secrets/:encodedSecretPath/rotate' },
  { path: 'workspace-secrets', guard: 'secrets' },
  { path: 'profile' },
]
