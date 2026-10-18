import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { canManageWorkspaceSecrets } from '@in-falcone/console-api/workspace-secrets-access'
import { RouteState } from './RouteState'
import { useConsoleContext } from './context'
import { useSession } from './session'
import { usePermissions } from './permissions'

export function Guard({ kind, children }: { kind: 'superadmin' | 'observer' | 'secrets'; children: ReactNode }) {
  const session = useSession()
  const { activeWorkspaceId } = useConsoleContext()
  const roles = session?.principal?.platformRoles ?? []
  const allowed = kind === 'superadmin' ? roles.includes('superadmin') : kind === 'observer'
    ? roles.some((role) => ['superadmin', 'platform_admin', 'platform_operator', 'platform_auditor'].includes(role))
    : canManageWorkspaceSecrets(session, activeWorkspaceId)
  return allowed ? children : <RouteState state="forbidden" />
}
export function ConsoleIndexRedirect() {
  const permissions = usePermissions()
  return <Navigate replace to={permissions.isReadOnly ? 'observability' : 'overview'} />
}
