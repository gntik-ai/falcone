import { describe, expect, it, vi } from 'vitest'

import type { BooleanCapabilityKey } from '@/lib/capabilities/catalog-keys'

// Mock the console context
const mockContextValue = {
  capabilities: {} as Record<string, boolean>,
  capabilitiesLoading: false
}

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockContextValue
}))

import { useCapabilityGate } from './use-capability-gate'

describe('useCapabilityGate', () => {
  it('returns enabled: true when capability is true in context', () => {
    mockContextValue.capabilities = { webhooks: true }
    mockContextValue.capabilitiesLoading = false

    const result = useCapabilityGate('webhooks')
    expect(result).toEqual({ enabled: true, loading: false, reason: null })
  })

  it('returns enabled: false with reason when capability is false', () => {
    mockContextValue.capabilities = { webhooks: false }
    mockContextValue.capabilitiesLoading = false

    const result = useCapabilityGate('webhooks')
    expect(result).toEqual({ enabled: false, loading: false, reason: 'plan_restriction' })
  })

  it('returns loading: true when capabilitiesLoading is true', () => {
    mockContextValue.capabilities = {}
    mockContextValue.capabilitiesLoading = true

    const result = useCapabilityGate('webhooks')
    expect(result).toEqual({ enabled: false, loading: true, reason: null })
  })

  it('returns enabled: false when capability key does not exist (deny-by-default)', () => {
    mockContextValue.capabilities = { realtime: true }
    mockContextValue.capabilitiesLoading = false

    // Cast: the param type is constrained to the catalog at compile time (#790), but this
    // test deliberately exercises the runtime deny-by-default path for a key absent from the
    // live capabilities map.
    const result = useCapabilityGate('unknown_capability' as BooleanCapabilityKey)
    expect(result).toEqual({ enabled: false, loading: false, reason: 'plan_restriction' })
  })
})
