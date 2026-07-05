import type { PrecheckResultItem } from '@/services/backupOperationsApi'

function iconFor(result: PrecheckResultItem['result']) {
  if (result === 'blocking_error') return '🚫'
  if (result === 'warning') return '⚠️'
  return '✅'
}

export function PrecheckResultList({ prechecks }: { prechecks: PrecheckResultItem[] }) {
  return (
    <ul className="space-y-2">
      {prechecks.map((precheck) => (
        <li
          key={precheck.code}
          className={`rounded-md border p-3 text-sm ${precheck.result === 'blocking_error' ? 'border-destructive/30 bg-destructive/5' : precheck.result === 'warning' ? 'border-amber-500/30 bg-amber-500/10' : 'border-border bg-card/70'}`}
        >
          <div className="font-medium text-foreground">
            <span className="mr-2" aria-hidden>{iconFor(precheck.result)}</span>
            <span>{precheck.code}</span>
          </div>
          <p className="mt-1 text-muted-foreground">{precheck.message}</p>
          {precheck.metadata && Object.keys(precheck.metadata).length > 0 && (
            <pre className="mt-2 overflow-auto rounded bg-background/60 p-2 text-xs text-muted-foreground">
              {JSON.stringify(precheck.metadata, null, 2)}
            </pre>
          )}
        </li>
      ))}
    </ul>
  )
}
