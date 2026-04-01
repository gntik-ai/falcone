import { useCallback, useState } from 'react'
import { abortRestore as apiAbortRestore } from '@/services/backupOperationsApi'

export function useAbortRestore(): {
  abort: (confirmationToken: string, authToken: string) => Promise<void>
  isLoading: boolean
  error: Error | null
} {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const abort = useCallback(async (confirmationToken: string, authToken: string) => {
    setIsLoading(true)
    setError(null)
    try {
      await apiAbortRestore(confirmationToken, authToken)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { abort, isLoading, error }
}
