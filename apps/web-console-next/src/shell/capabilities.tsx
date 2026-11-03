import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import { useConsoleContext } from './context'

export const BOOLEAN_CAPABILITY_KEYS = ['sql_admin_api', 'passthrough_admin', 'realtime', 'webhooks', 'public_functions', 'custom_domains', 'scheduled_functions', 'backup_scope_access'] as const
export type BooleanCapabilityKey = typeof BOOLEAN_CAPABILITY_KEYS[number]
interface CapabilityState { loading: boolean; capabilities: Record<string, boolean>; error: unknown }
const empty: CapabilityState = { loading: false, capabilities: {}, error: null }
const Context = createContext<CapabilityState & { load: () => void }>({ ...empty, load: () => {} })
export function CapabilitiesProvider({ children }: { children: ReactNode }) {
  const { activeTenantId, loading } = useConsoleContext()
  const request = useRef<{ tenant: string; promise: Promise<{ capabilities: Record<string, boolean> }> } | null>(null)
  const [state, setState] = useState<CapabilityState & { tenant: string | null }>({ ...empty, tenant: null })
  const load = useCallback(() => {
    if (!activeTenantId || request.current?.tenant === activeTenantId) return
    // Retain the promise through StrictMode's effect replay, but never reuse another tenant's result.
    const pending = {
      tenant: activeTenantId,
      promise: requestConsoleSessionJson<{ capabilities: Record<string, boolean> }>('/v1/tenant/effective-capabilities'),
    }
    request.current = pending
    setState({ ...empty, tenant: activeTenantId, loading: true })
    void pending.promise.then((value) => {
      if (request.current === pending) setState({ tenant: activeTenantId, loading: false, capabilities: value.capabilities ?? {}, error: null })
    }).catch((error: unknown) => {
      if (request.current === pending) setState({ tenant: activeTenantId, loading: false, capabilities: {}, error })
    })
  }, [activeTenantId])
  useEffect(() => {
    // Clear even when no consumer is mounted. A child effect may already have loaded the new tenant.
    if (request.current?.tenant !== activeTenantId) {
      request.current = null
      setState({ ...empty, tenant: null })
    }
  }, [activeTenantId])
  const value = activeTenantId && state.tenant === activeTenantId ? state : { ...empty, loading: loading || Boolean(activeTenantId) }
  return <Context.Provider value={{ ...value, load }}>{children}</Context.Provider>
}
export function useCapabilities() {
  const { load, loading, capabilities, error } = useContext(Context)
  useEffect(() => { load() }, [load])
  return { loading, capabilities, error }
}
export function useCapabilityGate(key: BooleanCapabilityKey) {
  const { loading, capabilities, error } = useCapabilities()
  const enabled = !loading && !error && BOOLEAN_CAPABILITY_KEYS.includes(key) && capabilities[key] === true
  return { loading, enabled: Boolean(enabled), reason: loading || enabled ? null : 'plan_restriction' }
}
