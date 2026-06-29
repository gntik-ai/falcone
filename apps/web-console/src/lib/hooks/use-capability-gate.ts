import type { BooleanCapabilityKey } from '@/lib/capabilities/catalog-keys'
import { useConsoleContext } from '@/lib/console-context'

export type CapabilityGateReason = 'plan_restriction' | 'override_restriction' | null

export interface CapabilityGateResult {
  enabled: boolean
  loading: boolean
  reason: CapabilityGateReason
}

// `capabilityKey` is constrained to the boolean-capability catalog (see catalog-keys.ts):
// gating on a key absent from the catalog can never be satisfied (#790).
export function useCapabilityGate(capabilityKey: BooleanCapabilityKey): CapabilityGateResult {
  const { capabilities, capabilitiesLoading } = useConsoleContext()

  if (capabilitiesLoading) {
    return { enabled: false, loading: true, reason: null }
  }

  if (capabilities[capabilityKey] === true) {
    return { enabled: true, loading: false, reason: null }
  }

  return { enabled: false, loading: false, reason: 'plan_restriction' }
}
