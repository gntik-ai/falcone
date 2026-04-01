import { useCallback, useState } from 'react'
import {
  abortRestore as apiAbortRestore,
  confirmRestore as apiConfirmRestore,
  initiateRestore as apiInitiateRestore,
  type ConfirmRestoreBody,
  type ConfirmRestoreResponse,
  type InitiateRestoreBody,
  type InitiateRestoreResponse,
} from '@/services/backupOperationsApi'

export type RestorePhase = 'idle' | 'loading' | 'pending_confirmation' | 'confirming' | 'dispatched' | 'error'

export interface ConfirmRestoreOpts {
  tenant_name_confirmation: string
  acknowledge_warnings?: boolean
  second_factor_type?: 'otp' | 'second_actor'
  otp_code?: string
  second_actor_token?: string
}

export interface UseTriggerRestoreResult {
  initiate: (body: InitiateRestoreBody, token: string) => Promise<void>
  confirm: (opts: ConfirmRestoreOpts) => Promise<void>
  abort: () => Promise<void>
  phase: RestorePhase
  precheckResponse: InitiateRestoreResponse | null
  operationId: string | null
  error: Error | null
}

export function useTriggerRestore(): UseTriggerRestoreResult {
  const [phase, setPhase] = useState<RestorePhase>('idle')
  const [error, setError] = useState<Error | null>(null)
  const [operationId, setOperationId] = useState<string | null>(null)
  const [precheckResponse, setPrecheckResponse] = useState<InitiateRestoreResponse | null>(null)
  const [confirmationToken, setConfirmationToken] = useState<string | null>(null)
  const [authToken, setAuthToken] = useState<string | null>(null)

  const initiate = useCallback(async (body: InitiateRestoreBody, token: string) => {
    setPhase('loading')
    setError(null)
    setAuthToken(token)
    try {
      const response = await apiInitiateRestore(body, token)
      setPrecheckResponse(response)
      setConfirmationToken(response.confirmation_token)
      setPhase('pending_confirmation')
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      setPhase('error')
    }
  }, [])

  const confirm = useCallback(async (opts: ConfirmRestoreOpts) => {
    if (!confirmationToken || !authToken) return
    setPhase('confirming')
    setError(null)
    try {
      const body: ConfirmRestoreBody = {
        confirmation_token: confirmationToken,
        confirmed: true,
        tenant_name_confirmation: opts.tenant_name_confirmation,
        acknowledge_warnings: opts.acknowledge_warnings,
        second_factor_type: opts.second_factor_type,
        otp_code: opts.otp_code,
        second_actor_token: opts.second_actor_token,
      }
      const response = await apiConfirmRestore(body, authToken)
      setOperationId(response.operation_id ?? null)
      setPhase('dispatched')
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      setPhase('error')
    }
  }, [authToken, confirmationToken])

  const abort = useCallback(async () => {
    if (!confirmationToken || !authToken) return
    try {
      await apiAbortRestore(confirmationToken, authToken)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setPhase('idle')
      setPrecheckResponse(null)
      setConfirmationToken(null)
      setAuthToken(null)
    }
  }, [authToken, confirmationToken])

  return { initiate, confirm, abort, phase, precheckResponse, operationId, error }
}
