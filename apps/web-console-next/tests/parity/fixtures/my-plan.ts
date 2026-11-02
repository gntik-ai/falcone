import { buildConsoleLoginSessionFixture } from '@in-falcone/console-api/fixtures'

export function tenantlessSession(role: 'superadmin' | 'platform_admin' | 'platform_operator') {
  const session = buildConsoleLoginSessionFixture()
  session.principal!.platformRoles = [role]
  session.principal!.tenantIds = []
  session.principal!.workspaceIds = []
  return session
}
export const myPlanSessions = {
  'shell-superadmin-tenantless': tenantlessSession('superadmin'),
  'shell-platform-operator-tenantless': tenantlessSession('platform_operator'),
}
