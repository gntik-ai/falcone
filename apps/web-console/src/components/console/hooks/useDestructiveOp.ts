import { useCallback, useEffect, useRef, useState } from 'react'

import { describeConsoleError } from '@/lib/console-errors'
import {
  fetchCascadeImpact,
  type CascadeImpactResourceType,
  type DestructiveOpConfig,
  type DestructiveOpState,
} from '@/lib/destructive-ops'

interface UseDestructiveOpReturn {
  isOpen: boolean
  config: DestructiveOpConfig | null
  opState: DestructiveOpState
  confirmError: string | null
  openDialog: (config: Omit<DestructiveOpConfig, 'cascadeImpact' | 'cascadeImpactError'>) => void
  handleConfirm: () => Promise<void>
  handleCancel: () => void
}

const CASCADE_IMPACT_RESOURCE_TYPES: CascadeImpactResourceType[] = ['tenant', 'workspace', 'database', 'api-keys']

function isCascadeImpactResourceType(value: string): value is CascadeImpactResourceType {
  return CASCADE_IMPACT_RESOURCE_TYPES.includes(value as CascadeImpactResourceType)
}

function getConfirmErrorMessage(error: unknown) {
  // A small number of callers (e.g. ConsolePlanDetailPage's lifecycle/delete confirmations)
  // pre-localize their own rejection — mapping specific backend codes (PLAN_HAS_ACTIVE_
  // ASSIGNMENTS, INVALID_TRANSITION, ...) to console-owned copy — and mark the result
  // `preLocalized: true` alongside a safe `message`. Trust that verbatim instead of re-deriving
  // a more generic mapping that would discard the caller's more specific, already-safe text.
  if (typeof error === 'object' && error !== null && (error as { preLocalized?: unknown }).preLocalized === true) {
    const preLocalizedMessage = (error as { message?: unknown }).message
    if (typeof preLocalizedMessage === 'string' && preLocalizedMessage.trim()) {
      return preLocalizedMessage
    }
  }

  const status = typeof error === 'object' && error !== null && 'status' in error ? (error as { status?: number }).status : undefined

  // These two overrides pre-date #743 and are already localized, destructive-op-specific
  // copy (not raw transport text) — kept verbatim rather than falling through to the shared
  // helper's more generic 401/404 wording. Everything else — including the previous
  // unconditional `error.message` echo below — now routes through the shared, never-raw helper.
  if (status === 401) {
    return 'Tu sesión ha expirado. Vuelve a iniciar sesión.'
  }

  if (status === 404) {
    return 'El recurso ya no existe o ha sido eliminado.'
  }

  return describeConsoleError(error, 'No se pudo completar la operación.')
}

export function useDestructiveOp(): UseDestructiveOpReturn {
  const [isOpen, setIsOpen] = useState(false)
  const [config, setConfig] = useState<DestructiveOpConfig | null>(null)
  const [opState, setOpState] = useState<DestructiveOpState>('idle')
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const impactAbortRef = useRef<AbortController | null>(null)
  const openSequenceRef = useRef(0)

  const resetState = useCallback(() => {
    impactAbortRef.current?.abort()
    impactAbortRef.current = null
    setIsOpen(false)
    setConfig(null)
    setOpState('idle')
    setConfirmError(null)
  }, [])

  const handleCancel = useCallback(() => {
    resetState()
  }, [resetState])

  const openDialog = useCallback((nextConfig: Omit<DestructiveOpConfig, 'cascadeImpact' | 'cascadeImpactError'>) => {
    impactAbortRef.current?.abort()
    const sequence = openSequenceRef.current + 1
    openSequenceRef.current = sequence

    setConfirmError(null)
    setIsOpen(true)
    setConfig({ ...nextConfig, cascadeImpact: undefined, cascadeImpactError: false })

    if (nextConfig.level !== 'CRITICAL' || !nextConfig.resourceId || !isCascadeImpactResourceType(nextConfig.resourceType)) {
      setOpState('ready')
      return
    }

    const controller = new AbortController()
    impactAbortRef.current = controller
    setOpState('loading-impact')

    void fetchCascadeImpact(nextConfig.resourceType, nextConfig.resourceId, controller.signal)
      .then((cascadeImpact) => {
        if (openSequenceRef.current !== sequence) return
        impactAbortRef.current = null
        setConfig((current) => (current ? { ...current, cascadeImpact, cascadeImpactError: false } : current))
        setOpState('ready')
      })
      .catch(() => {
        if (controller.signal.aborted || openSequenceRef.current !== sequence) return
        impactAbortRef.current = null
        setConfig((current) => (current ? { ...current, cascadeImpact: [], cascadeImpactError: true } : current))
        setOpState('ready')
      })
  }, [])

  const handleConfirm = useCallback(async () => {
    if (!config) return

    setConfirmError(null)
    setOpState('confirming')

    try {
      await config.onConfirm()
      const onSuccess = config.onSuccess
      resetState()
      onSuccess?.()
    } catch (error) {
      setConfirmError(getConfirmErrorMessage(error))
      setOpState('error')
    }
  }, [config, resetState])

  useEffect(() => () => {
    impactAbortRef.current?.abort()
  }, [])

  return {
    isOpen,
    config,
    opState,
    confirmError,
    openDialog,
    handleConfirm,
    handleCancel
  }
}
