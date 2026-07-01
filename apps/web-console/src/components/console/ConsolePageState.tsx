import { useId } from 'react'
import { Button } from '@/components/ui/button'

export function ConsolePageState({
  kind,
  title,
  description,
  actionLabel,
  onAction
}: {
  kind: 'loading' | 'error' | 'empty' | 'blocked'
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}) {
  const titleId = useId()
  const descriptionId = useId()

  return (
    <section
      aria-busy={kind === 'loading'}
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      role={kind === 'error' || kind === 'blocked' ? 'alert' : 'status'}
      className="rounded-3xl border border-border bg-card/70 p-5 shadow-sm sm:p-6"
    >
      <div className="space-y-2">
        <h2 id={titleId} className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        <p id={descriptionId} className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {actionLabel && onAction ? (
        <div className="pt-4">
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
