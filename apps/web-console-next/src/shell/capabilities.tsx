import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import { useConsoleContext } from './context'

export const BOOLEAN_CAPABILITY_KEYS = ['sql_admin_api', 'passthrough_admin', 'realtime', 'webhooks', 'public_functions', 'custom_domains', 'scheduled_functions', 'backup_scope_access'] as const
export type BooleanCapabilityKey = typeof BOOLEAN_CAPABILITY_KEYS[number]
interface CapabilityState { loading: boolean; capabilities: Record<string, boolean>; error: unknown }
const empty: CapabilityState = { loading: false, capabilities: {}, error: null }
const Context = createContext<CapabilityState>(empty)
export function CapabilitiesProvider({ children }: { children: ReactNode }) {
  const { activeTenantId, loading } = useConsoleContext()
  const request = useRef<{ tenant: string; promise: Promise<{ capabilities: Record<string, boolean> }> } | null>(null)
  const [state, setState] = useState<CapabilityState & { tenant: string | null }>({ ...empty, tenant: null })
  useEffect(() => {
    let cancelled = false
    if (!activeTenantId) { request.current = null; return }
    // Retain the promise through StrictMode's effect replay, but never reuse another tenant's result.
    if (request.current?.tenant !== activeTenantId) request.current = {
      tenant: activeTenantId,
      promise: requestConsoleSessionJson<{ capabilities: Record<string, boolean> }>('/v1/tenant/effective-capabilities'),
    }
    setState({ ...empty, tenant: activeTenantId, loading: true })
    void request.current.promise.then((value) => {
      if (!cancelled) setState({ tenant: activeTenantId, loading: false, capabilities: value.capabilities ?? {}, error: null })
    }).catch((error: unknown) => {
      if (!cancelled) setState({ tenant: activeTenantId, loading: false, capabilities: {}, error })
    })
    return () => { cancelled = true }
  }, [activeTenantId])
  const value = activeTenantId && state.tenant === activeTenantId ? state : { ...empty, loading: loading || Boolean(activeTenantId) }
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export const useCapabilities = () => useContext(Context)
export function useCapabilityGate(key: BooleanCapabilityKey) {
  const { loading, capabilities, error } = useCapabilities()
  const enabled = !loading && !error && BOOLEAN_CAPABILITY_KEYS.includes(key) && capabilities[key] === true
  return { loading, enabled: Boolean(enabled), reason: loading || enabled ? null : 'plan_restriction' }
}
