import { useEffect } from 'react'

import type { ReconciliationDelta } from '@/lib/reconcile-operations'

interface OperationStatusBannerProps {
  delta: ReconciliationDelta | null
  onDismiss?: () => void
  autoDismissMs?: number
}

const STATUS_TEXT: Record<string, string> = {
  completed: 'completada',
  failed: 'falló',
  timed_out: 'expirada',
  cancelled: 'cancelada'
}

function isDeltaEmpty(delta: ReconciliationDelta | null): boolean {
  return !delta || Object.values(delta).every((value) => value.length === 0)
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function summarizeTerminal(delta: ReconciliationDelta): string {
  const counts = delta.terminal.reduce<Record<string, number>>((accumulator, operation) => {
    accumulator[operation.status] = (accumulator[operation.status] ?? 0) + 1
    return accumulator
  }, {})

  return Object.entries(counts)
    .map(([status, count]) => pluralize(count, `operación ${STATUS_TEXT[status] ?? status}`, `operaciones ${STATUS_TEXT[status] ?? status}`))
    .join(', ')
}

export function OperationStatusBanner({ delta, onDismiss, autoDismissMs = 30_000 }: OperationStatusBannerProps) {
  useEffect(() => {
    if (isDeltaEmpty(delta) || !onDismiss) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      onDismiss()
    }, autoDismissMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [autoDismissMs, delta, onDismiss])

  if (isDeltaEmpty(delta)) {
    return null
  }

  const safeDelta = delta as ReconciliationDelta
  const parts: string[] = []

  if (safeDelta.terminal.length > 0) {
    parts.push(`${summarizeTerminal(safeDelta)} mientras estabas desconectado.`)
  }

  if (safeDelta.unavailable.length > 0) {
    parts.push(`${pluralize(safeDelta.unavailable.length, 'operación ya no está disponible', 'operaciones ya no están disponibles')} (eliminadas o purgadas).`)
  }

  if (parts.length === 0 && safeDelta.added.length > 0) {
    parts.push(`${pluralize(safeDelta.added.length, 'nueva operación detectada', 'nuevas operaciones detectadas')} al reconectar.`)
  }

  return (
    <div role="status" aria-live="polite" className="flex items-start justify-between gap-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
      <p>{parts.join(' ')}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded-md border border-blue-300 px-2 py-1 text-xs font-medium text-blue-800 transition hover:bg-blue-100"
      >
        Cerrar
      </button>
    </div>
  )
}

export default OperationStatusBanner
