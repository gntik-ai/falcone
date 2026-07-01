import { useId } from 'react'
import { Badge } from '@/components/ui/badge'

export function CapabilityStatusGrid({ capabilities }: { capabilities: Array<{ capabilityKey: string; displayLabel: string; enabled: boolean; source: 'plan' | 'catalog_default' }> }) {
  const headingId = useId()

  return (
    <section className="rounded-2xl border border-border bg-card/70 p-4 shadow-sm" aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-3 text-sm font-semibold">Capabilities</h2>
      {capabilities.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">No inherited capabilities were returned.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {capabilities.map((capability) => (
            <li key={capability.capabilityKey} className="rounded-xl border border-border p-3">
              <div className="font-medium">{capability.displayLabel}</div>
              <div className="mt-2 flex gap-2">
                <Badge
                  aria-label={`${capability.displayLabel} capability ${capability.enabled ? 'enabled' : 'disabled'}`}
                  className={capability.enabled ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-100 text-slate-900'}
                >
                  {capability.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
                <Badge variant="outline">{capability.source === 'plan' ? 'Plan' : 'Platform default'}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
