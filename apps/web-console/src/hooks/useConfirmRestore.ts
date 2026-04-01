import { useCallback, useState } from 'react'
import { abortRestore as apiAbortRestore, confirmRestore as apiConfirmRestore, type ConfirmRestoreBody, type ConfirmRestoreResponse } from '@/services/backupOperationsApi'

export interface ConfirmRestoreOpts {
  tenant_name_confirmation: string
  acknowledge_warnings?: boolean
  second_factor_type?: 'otp' | 'second_actor'
  otp_code?: string
  second_actor_token?: string
}

export function useConfirmRestore(confirmationToken: string | null, authToken: string | null): {
  confirm: (opts: ConfirmRestoreOpts) => Promise<ConfirmRestoreResponse | void>
  abort: () => Promise<void>
  isLoading: boolean
  error: Error | null
} {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const confirm = useCallback(async (opts: ConfirmRestoreOpts) => {
    if (!confirmationToken || !authToken) return
    setIsLoading(true)
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
      return await apiConfirmRestore(body, authToken)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setIsLoading(false)
    }
  }, [authToken, confirmationToken])

  const abort = useCallback(async () => {
    if (!confirmationToken || !authToken) return
    setIsLoading(true)
    setError(null)
    try {
      await apiAbortRestore(confirmationToken, authToken)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setIsLoading(false)
    }
  }, [authToken, confirmationToken])

  return { confirm, abort, isLoading, error }
}
