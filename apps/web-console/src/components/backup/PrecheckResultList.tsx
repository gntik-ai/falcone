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
          className={`rounded-md border p-3 text-sm ${precheck.result === 'blocking_error' ? 'border-red-300 bg-red-50' : precheck.result === 'warning' ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}
        >
          <div className="font-medium">
            <span className="mr-2" aria-hidden>{iconFor(precheck.result)}</span>
            <span>{precheck.code}</span>
          </div>
          <p className="mt-1 text-slate-700">{precheck.message}</p>
          {precheck.metadata && Object.keys(precheck.metadata).length > 0 && (
            <pre className="mt-2 overflow-auto rounded bg-black/5 p-2 text-xs text-slate-700">
              {JSON.stringify(precheck.metadata, null, 2)}
            </pre>
          )}
        </li>
      ))}
    </ul>
  )
}
