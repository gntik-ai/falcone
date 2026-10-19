import { createContext, useContext, type ReactNode } from 'react'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
import { useSession } from './session'

const PermissionsContext = createContext(getConsolePermissions([]))
export function PermissionsProvider({ children }: { children: ReactNode }) {
  const session = useSession()
  return <PermissionsContext.Provider value={getConsolePermissions(session?.principal?.platformRoles)}>{children}</PermissionsContext.Provider>
}
export const usePermissions = () => useContext(PermissionsContext)
