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
      className="rounded-3xl border border-border bg-card/70 p-6"
    >
      <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
      <p id={descriptionId} className="mt-2 text-sm text-muted-foreground">{description}</p>
      {actionLabel && onAction ? (
        <div className="mt-4">
          <Button type="button" variant="outline" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
