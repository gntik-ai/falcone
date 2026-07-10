import { cn } from '@/lib/utils'

const stepStateLabels = {
  current: 'Paso actual',
  completed: 'Completado',
  upcoming: 'Pendiente'
} as const

export function WizardStepIndicator({ currentStep, labels }: { currentStep: number; labels: string[] }) {
  const columnClassName = labels.length >= 5 ? 'sm:grid-cols-3 lg:grid-cols-5' : 'sm:grid-cols-4'

  return (
    <ol className={cn('mb-6 grid gap-2', columnClassName)} aria-label="Progreso del asistente">
      {labels.map((label, index) => {
        const state = index === currentStep ? 'current' : index < currentStep ? 'completed' : 'upcoming'
        const stateLabel = stepStateLabels[state]

        return (
          <li
            key={label}
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
            className={cn(
              'min-w-0 rounded-xl border px-3 py-2 text-sm transition-colors',
              state === 'current' && 'border-primary bg-primary text-primary-foreground shadow-sm',
              state === 'completed' && 'border-primary/60 bg-primary/10 text-primary',
              state === 'upcoming' && 'border-border bg-muted/30 text-muted-foreground'
            )}
          >
            <span className="block font-medium">
              <span className="sr-only">Paso {index + 1} de {labels.length}: </span>
              <span className="tabular-nums" aria-hidden="true">{index + 1}.</span> {label}
            </span>
            <span className="mt-1 block text-xs leading-4 opacity-80">{stateLabel}</span>
          </li>
        )
      })}
    </ol>
  )
}
