// Honest, product-quality empty state for console settings (change:
// add-console-descaffold-dark-theme, issue #744). Replaces `ConsolePlaceholderPage` — there are no
// configurable preferences for this surface yet, so this states that plainly instead of narrating
// dev/iteration status ("entrada base para futura gestión…").
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useConsoleContext } from '@/lib/console-context'

export function ConsoleSettingsPage() {
  const { activeTenant } = useConsoleContext()

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <Badge variant="secondary">Ajustes</Badge>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Ajustes de consola</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Preferencias operativas para tu cuenta y para {activeTenant?.label ?? 'la organización activa'}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Sin preferencias configurables</CardTitle>
            <CardDescription>Esta organización no tiene ajustes de consola disponibles en este momento.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-muted-foreground">
            La gestión de miembros, cuotas y planes ya está disponible en sus propias secciones de la consola. Si necesitas
            cambiar un ajuste que no ves aquí, contacta con un administrador de la organización o con soporte.
          </p>
        </CardContent>
      </Card>
    </section>
  )
}
