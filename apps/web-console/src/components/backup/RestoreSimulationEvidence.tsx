import type { OperationResponse } from '@/services/backupOperationsApi'

interface RestoreSimulationEvidenceProps {
  operation: OperationResponse['operation'] | null
}

export function RestoreSimulationEvidence({ operation }: RestoreSimulationEvidenceProps) {
  if (!operation || operation.execution_mode !== 'simulation') return null

  const checks = operation.validation_summary?.checks ?? []

  return (
    <section className="rounded-lg border border-border bg-muted/20 p-4" data-testid="restore-simulation-evidence">
      <h3 className="text-sm font-semibold text-foreground">Evidencia de simulación</h3>
      <dl className="mt-3 grid gap-2 text-sm text-foreground sm:grid-cols-2">
        <div><dt className="font-medium">Entorno</dt><dd>{operation.target_environment ?? 'n/a'}</dd></div>
        <div><dt className="font-medium">Resultado</dt><dd>{operation.validation_summary?.outcome ?? operation.status}</dd></div>
        <div><dt className="font-medium">Chequeado por</dt><dd>{operation.validation_summary?.checkedBy ?? 'n/a'}</dd></div>
        <div><dt className="font-medium">Chequeado en</dt><dd>{operation.validation_summary?.checkedAt ? new Date(operation.validation_summary.checkedAt).toLocaleString() : 'n/a'}</dd></div>
      </dl>
      {checks.length > 0 && (
        <ul className="mt-4 space-y-2 text-sm">
          {checks.map((check) => (
            <li key={check.code} className="rounded border border-border bg-card/70 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-foreground">{check.code}</span>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">{check.result}</span>
              </div>
              <p className="mt-1 text-muted-foreground">{check.message}</p>
            </li>
          ))}
        </ul>
      )}
      {operation.evidence_refs && operation.evidence_refs.length > 0 && (
        <div className="mt-4 text-sm text-foreground">
          <h4 className="font-medium">Referencias</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {operation.evidence_refs.map((ref) => (
              <li key={`${ref.kind}:${ref.id}`}>
                {ref.label ?? ref.kind}: {ref.id}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

export default RestoreSimulationEvidence
