import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import {
  clearConsoleShellSession, ensureConsoleSession, readConsoleShellSession, storeProtectedRouteIntent,
  subscribeConsoleSessionInvalidated, type ConsoleShellSession
} from '@in-falcone/console-api/session'
import { terminateConsoleLoginSession } from '@in-falcone/console-api/auth'
import { StatusPage } from '../StatusPage'

const SessionContext = createContext<ConsoleShellSession | null>(null)
export const useSession = () => useContext(SessionContext)

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation()
  const routeIntent = location.pathname + location.search + location.hash
  const [session, setSession] = useState<ConsoleShellSession | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    const unsubscribe = subscribeConsoleSessionInvalidated(() => {
      if (active) { setSession(null); setLoading(false) }
    })
    void ensureConsoleSession().then((next) => {
      if (active) { setSession(next); setLoading(false) }
    }).catch(() => {
      if (active) { setSession(null); setLoading(false) }
    })
    return () => { active = false; unsubscribe() }
  }, [routeIntent])
  useEffect(() => {
    if (!loading && !session) storeProtectedRouteIntent(routeIntent)
  }, [loading, session, routeIntent])
  if (loading) return <StatusPage state="loading" />
  if (!session) return <Navigate to={consoleAuthConfig.loginPath} replace />
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}

export async function signOut(session: ConsoleShellSession) {
  // Authenticated requests can rotate the shared snapshot after the shell mounts.
  const current = readConsoleShellSession() ?? session
  try {
    await terminateConsoleLoginSession(current.sessionId, current.tokenSet?.accessToken ?? '', current.tokenSet?.refreshToken ?? '', current.tenantId)
  } finally {
    clearConsoleShellSession()
  }
}
