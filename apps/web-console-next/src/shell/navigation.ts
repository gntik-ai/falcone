import { matchPath } from 'react-router-dom'
import { pendingConsoleRoutes } from './routes'
import { Activity, Database, FolderKanban, Gauge, KeyRound, KeySquare, LayoutDashboard, LogIn, PieChart, Rocket, Settings, Shield, Users, Workflow } from 'lucide-react'

// Application destinations and role visibility follow the legacy shell.
export const navigation = [
  { path: '/console/runtime', key: 'runtime', group: 'main', icon: Activity },
  { path: '/console/overview', key: 'overview', group: 'main', icon: LayoutDashboard },
  { path: '/console/my-plan', key: 'my-plan', exactActive: true, group: 'main', icon: Gauge },
  { path: '/console/my-plan/allocation', key: 'my-plan-allocation', group: 'main', icon: PieChart },
  { path: '/console/tenants', key: 'tenants', group: 'main', icon: Shield, requiresPlatformInventoryAccess: true },
  { path: '/console/workspaces', key: 'workspaces', group: 'main', icon: FolderKanban, restrictedForAction: 'tenant.workspaces.create' },
  { path: '/console/database', key: 'database', group: 'workspace', icon: Database, restrictedForAction: 'workspace.write' },
  { path: '/console/flows', key: 'flows', group: 'functions', icon: Workflow },
  { path: '/console/functions-registry', key: 'functions-registry', group: 'functions', icon: Settings, restrictedForAction: 'workspace.write' },
  { path: '/console/functions', key: 'functions', exactActive: true, group: 'functions', icon: Workflow, restrictedForAction: 'workspace.write' },
  { path: '/console/functions/data', key: 'functions-data', group: 'functions', icon: Rocket, restrictedForAction: 'workspace.write' },
  { path: '/console/iam-access', key: 'iam-access', group: 'administration', icon: Shield, requiresSuperadminAccess: true },
  { path: '/console/members', key: 'members', group: 'administration', icon: Users },
  { path: '/console/plans', key: 'plans', group: 'administration', icon: FolderKanban, requiresSuperadminAccess: true },
  { path: '/console/auth', key: 'auth', group: 'administration', icon: Shield, requiresSuperadminAccess: true },
  { path: '/console/auth-config', key: 'auth-config', group: 'administration', icon: LogIn },
  { path: '/console/postgres', key: 'postgres', group: 'dataPlane', icon: Database },
  { path: '/console/mongo', key: 'mongo', group: 'dataPlane', icon: Database },
  { path: '/console/kafka', key: 'kafka', group: 'dataPlane', icon: Activity },
  { path: '/console/postgres/data', key: 'postgres-data', group: 'dataPlane', icon: Database },
  { path: '/console/mongo/data', key: 'mongo-data', group: 'dataPlane', icon: Database },
  { path: '/console/events/data', key: 'events-data', group: 'dataPlane', icon: Activity },
  { path: '/console/realtime/changes', key: 'realtime-changes', group: 'dataPlane', icon: Activity },
  { path: '/console/operations', key: 'operations', group: 'operations', icon: Activity },
  { path: '/console/storage', key: 'storage', group: 'dataPlane', icon: Database },
  { path: '/console/observability', key: 'observability', group: 'operations', icon: Activity },
  { path: '/console/service-accounts', key: 'service-accounts', group: 'operations', icon: KeySquare, restrictedForAction: 'workspace.write' },
  { path: '/console/workspace-secrets', key: 'workspace-secrets', group: 'operations', icon: KeyRound, requiresWorkspaceSecretsAccess: true, restrictedForAction: 'workspace.write' },
  { path: '/console/quotas', key: 'quotas', group: 'operations', icon: Activity }
] as const

export const navigationGroups = ['main', 'workspace', 'functions', 'administration', 'dataPlane', 'operations', 'restricted'] as const

export function isMigratedRoute(href: string) {
  if (!href.startsWith('/console/')) return false
  const pathname = href.split(/[?#]/, 1)[0]
  // Settings is a migrated lazy route declared separately from pending pages.
  if (pathname === '/console/settings') return true
  // Prefer the most specific route (including unmarked child routes).
  const routes = [...pendingConsoleRoutes].sort((a, b) =>
    b.path.split('/').length - a.path.split('/').length ||
    a.path.split(':').length - b.path.split(':').length)
  return routes.find((route) => matchPath(`/console/${route.path}`, pathname))?.migrated === true
}
