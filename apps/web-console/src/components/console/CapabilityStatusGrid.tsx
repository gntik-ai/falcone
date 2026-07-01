import { useId } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const capabilityBadgeClass = {
  enabled: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  disabled: 'border-border bg-secondary text-secondary-foreground'
}

export function CapabilityStatusGrid({ capabilities }: { capabilities: Array<{ capabilityKey: string; displayLabel: string; enabled: boolean; source: 'plan' | 'catalog_default' }> }) {
  const headingId = useId()

  return (
    <section className="rounded-3xl border border-border bg-card/70 p-4 shadow-sm sm:p-5" aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-3 text-base font-semibold text-foreground">Capacidades</h2>
      {capabilities.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">No se devolvieron capacidades heredadas.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {capabilities.map((capability) => (
            <li key={capability.capabilityKey} className="min-w-0 rounded-2xl border border-border/70 bg-background/50 p-3">
              <div className="break-words font-medium text-foreground">{capability.displayLabel}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge
                  aria-label={`${capability.displayLabel}: capacidad ${capability.enabled ? 'habilitada' : 'deshabilitada'}`}
                  className={cn('border', capability.enabled ? capabilityBadgeClass.enabled : capabilityBadgeClass.disabled)}
                >
                  {capability.enabled ? 'Habilitada' : 'Deshabilitada'}
                </Badge>
                <Badge variant="outline" className="max-w-full whitespace-normal text-left leading-5">
                  {capability.source === 'plan' ? 'Plan' : 'Valor predeterminado de plataforma'}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
