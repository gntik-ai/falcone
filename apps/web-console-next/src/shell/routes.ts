export type GuardKind = 'superadmin' | 'observer' | 'secrets'

interface PendingConsoleRoute {
  path: string
  // Opt in only when the page migration lands. Absent means legacy navigation.
  migrated?: boolean
  guard?: GuardKind
  handle?: { platformGlobal: boolean }
}

// Keep authorization and context scope next to each route, as in the legacy router.
export const pendingConsoleRoutes: PendingConsoleRoute[] = [
  { path: 'overview', migrated: true },
  { path: 'tenants' },
  { path: 'workspaces', migrated: true },
  { path: 'database' },
  { path: 'functions-registry', migrated: true },
  { path: 'iam-access', migrated: true, guard: 'superadmin' },
  { path: 'members', migrated: true },
  { path: 'plans', migrated: true, guard: 'superadmin', handle: { platformGlobal: true } },
  { path: 'plans/new', migrated: true, guard: 'superadmin', handle: { platformGlobal: true } },
  { path: 'plans/:planId', migrated: true, guard: 'superadmin', handle: { platformGlobal: true } },
  { path: 'tenants/:tenantId/plan', migrated: true, guard: 'superadmin' },
  { path: 'my-plan', migrated: true },
  { path: 'my-plan/allocation', migrated: true },
  { path: 'workspaces/:workspaceId', migrated: true },
  { path: 'auth', migrated: true, guard: 'superadmin' },
  { path: 'auth-config', migrated: true },
  { path: 'postgres' },
  { path: 'postgres/data' },
  { path: 'mongo' },
  { path: 'mongo/data' },
  { path: 'kafka' },
  { path: 'events/data' },
  { path: 'functions' },
  { path: 'functions/data', migrated: true },
  { path: 'realtime/changes', migrated: true },
  { path: 'flows', migrated: true },
  { path: 'flows/:flowId', migrated: true },
  { path: 'flows/:flowId/runs', migrated: true },
  { path: 'flows/:flowId/runs/:executionId' },
  { path: 'storage', migrated: true },
  { path: 'observability', migrated: true },
  { path: 'runtime', migrated: true, guard: 'observer', handle: { platformGlobal: true } },
  { path: 'service-accounts', migrated: true },
  { path: 'quotas', migrated: true },
  { path: 'operations', migrated: true },
  { path: 'mcp/servers', migrated: true },
  { path: 'mcp/servers/:mcpServerId', migrated: true },
  { path: 'workspaces/:workspaceId/realtime', migrated: true },
  { path: 'workspaces/:workspaceId/docs', migrated: true },
  { path: 'secrets', migrated: true },
  { path: 'secrets/:encodedSecretPath/rotate' },
  { path: 'workspace-secrets', migrated: true, guard: 'secrets' },
  { path: 'profile', migrated: true },
]
