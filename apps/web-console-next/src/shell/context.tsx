import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from 'react'
import { listAccessibleTenants, listAccessibleWorkspaces } from '@in-falcone/console-api/loaders'
import type { Tenant, Workspace } from '@in-falcone/console-api/clients'
import { useSession } from './session'

// Shared with the legacy app: no migration, extra fields, or alternate key.
const contextKey = 'in-falcone.console-active-context'
interface Snapshot { userId: string; tenantId: string | null; workspaceId: string | null; updatedAt: string }
function readSelection(userId: string): Snapshot | null {
  try {
    const raw = localStorage.getItem(contextKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Snapshot>
    if (typeof parsed.userId !== 'string' || typeof parsed.updatedAt !== 'string' ||
      (parsed.tenantId !== null && typeof parsed.tenantId !== 'string') ||
      (parsed.workspaceId !== null && typeof parsed.workspaceId !== 'string')) {
      localStorage.removeItem(contextKey)
      return null
    }
    return parsed.userId === userId ? parsed as Snapshot : null
  } catch {
    try { localStorage.removeItem(contextKey) } catch { /* Storage disabled. */ }
    return null
  }
}
function persist(userId: string, tenantId: string | null, workspaceId: string | null) {
  try {
    if (!userId || (!tenantId && !workspaceId)) localStorage.removeItem(contextKey)
    else localStorage.setItem(contextKey, JSON.stringify({ userId, tenantId, workspaceId, updatedAt: new Date().toISOString() } satisfies Snapshot))
  } catch { /* Storage disabled. Selection remains available for this page. */ }
}
function contextError(cause: unknown): { status?: number } {
  const status = cause && typeof cause === 'object' && 'status' in cause ? cause.status : undefined
  return { status: typeof status === 'number' ? status : undefined }
}
const normalizeId = (id?: string | null) => id?.trim() || null
interface ContextValue {
  tenants: Tenant[]; workspaces: Workspace[]; activeTenantId: string | null; activeWorkspaceId: string | null
  loading: boolean; error: { status?: number } | null
  selectTenant: (id: string | null) => void; selectWorkspace: (id: string | null) => void
}
const Context = createContext<ContextValue | null>(null)
export function useConsoleContext() {
  const value = useContext(Context)
  if (!value) throw new Error('ConsoleContextProvider required')
  return value
}
export function ConsoleContextProvider({ children, routeWorkspaceId }: { children: ReactNode; routeWorkspaceId?: string | null }) {
  const session = useSession()!
  const userId = session.principal?.userId?.trim() || ''
  const routeId = normalizeId(routeWorkspaceId)
  const tenantRequest = useRef<{ session: typeof session; promise: ReturnType<typeof listAccessibleTenants> } | null>(null)
  const [tenants, setTenants] = useState<Tenant[] | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeTenantId, setTenant] = useState<string | null>(null)
  const [activeWorkspaceId, setWorkspace] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ status?: number } | null>(null)
  const [selection, setSelection] = useState<{ tenantId: string | null; route: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!userId) { setTenants([]); setLoading(false); return }
    const roles = session.principal?.platformRoles ?? []
    const platform = roles.some((role) => ['superadmin', 'platform_admin', 'platform_operator'].includes(role))
    const isTenantOperator = !platform && roles.some((role) => ['tenant_owner', 'tenant_admin'].includes(role))
    const ownTenantIds = session.principal?.tenantIds?.filter(Boolean) ?? []
    // StrictMode replays effects in development; keep one bootstrap request per session.
    if (tenantRequest.current?.session !== session) {
      tenantRequest.current = { session, promise: listAccessibleTenants({ isTenantOperator, ownTenantIds }) }
    }
    void tenantRequest.current.promise.then((result) => {
      if (!cancelled) setTenants(result.items.filter((tenant) => !ownTenantIds.length || ownTenantIds.includes(tenant.tenantId)))
    }).catch((cause: unknown) => { if (!cancelled) { setError(contextError(cause)); setTenants([]); setLoading(false) } })
    return () => { cancelled = true }
  }, [session, userId])

  useEffect(() => {
    if (!tenants || !userId) return
    let cancelled = false
    const stored = readSelection(userId)
    const membership = session.principal?.workspaceIds?.filter(Boolean) ?? []
    const load = async (tenantId: string) => {
      const result = await listAccessibleWorkspaces(tenantId)
      return result.items.filter((workspace) => !membership.length || membership.includes(workspace.workspaceId))
    }
    async function resolve() {
      setLoading(true)
      try {
        let tenantId: string | null = null
        let workspaceId: string | null = null
        let options: Workspace[] = []
        // A route change overrides storage; a deliberate tenant switch clears that override.
        if (routeId && selection?.route !== routeId) {
          if (!membership.length || membership.includes(routeId)) {
            for (const tenant of tenants!) {
              const candidates = await load(tenant.tenantId)
              if (cancelled) return
              if (candidates.some((workspace) => workspace.workspaceId === routeId)) {
                tenantId = tenant.tenantId; workspaceId = routeId; options = candidates; break
              }
            }
          }
        } else {
          const preferredTenant = selection ? selection.tenantId : stored?.tenantId
          tenantId = tenants!.some((tenant) => tenant.tenantId === preferredTenant) ? preferredTenant! : tenants!.length === 1 ? tenants![0].tenantId : null
          if (tenantId) {
            options = await load(tenantId)
            const preferredWorkspace = !selection && stored?.tenantId === tenantId ? stored.workspaceId : null
            workspaceId = options.some((workspace) => workspace.workspaceId === preferredWorkspace) ? preferredWorkspace
              : options.length === 1 ? options[0].workspaceId : null
          }
        }
        if (cancelled) return
        setTenant(tenantId); setWorkspace(workspaceId); setWorkspaces(options)
        persist(userId, tenantId, workspaceId)
      } catch (cause) {
        if (!cancelled) { setWorkspace(null); setWorkspaces([]); setError(contextError(cause)) }
      } finally { if (!cancelled) setLoading(false) }
    }
    void resolve()
    return () => { cancelled = true }
  }, [tenants, userId, session, routeId, selection])

  function selectTenant(id: string | null) {
    const tenantId = normalizeId(id)
    if (tenantId && !tenants?.some((tenant) => tenant.tenantId === tenantId)) return
    if (tenantId === activeTenantId) return
    setTenant(tenantId); setWorkspace(null); setWorkspaces([]); setError(null)
    persist(userId, tenantId, null)
    setSelection({ tenantId, route: routeId })
  }
  function selectWorkspace(id: string | null) {
    const workspaceId = normalizeId(id)
    if (workspaceId && !workspaces.some((workspace) => workspace.workspaceId === workspaceId)) return
    setWorkspace(workspaceId); persist(userId, activeTenantId, workspaceId)
  }
  return <Context.Provider value={{ tenants: tenants ?? [], workspaces, activeTenantId, activeWorkspaceId, loading, error, selectTenant, selectWorkspace }}>{children}</Context.Provider>
}
