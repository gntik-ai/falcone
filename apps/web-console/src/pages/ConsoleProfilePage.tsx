// Real account profile for the authenticated console (change: add-console-descaffold-dark-theme,
// issue #744). Replaces `ConsolePlaceholderPage` — the identity/role/organization data shown here
// already exists in the session and permission model, so this reads it directly instead of
// narrating "future profile management" placeholder copy.
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useConsoleContext } from '@/lib/console-context'
import { useConsolePermissions } from '@/lib/console-permissions'
import { getConsolePrincipalLabel, getConsolePrincipalSecondary, readConsoleShellSession } from '@/lib/console-session'

export function ConsoleProfilePage() {
  const session = readConsoleShellSession()
  const permissions = useConsolePermissions()
  const { activeTenant, activeWorkspace } = useConsoleContext()
  const principal = session?.principal

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <Badge variant="secondary">Perfil</Badge>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Perfil de usuario</h1>
        <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
          Datos de identidad y permisos de la sesión con la que has iniciado sesión en la consola.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{getConsolePrincipalLabel(session)}</CardTitle>
            <CardDescription>{getConsolePrincipalSecondary(session)}</CardDescription>
          </div>
          <Badge variant="outline">{permissions.highestRoleLabel}</Badge>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Usuario</dt>
              <dd className="mt-1 text-sm text-foreground">{principal?.username ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Correo</dt>
              <dd className="mt-1 text-sm text-foreground">{principal?.primaryEmail ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Organización activa</dt>
              <dd className="mt-1 text-sm text-foreground">{activeTenant?.label ?? 'Ninguna seleccionada'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Área de trabajo activa</dt>
              <dd className="mt-1 text-sm text-foreground">{activeWorkspace?.label ?? 'Ninguna seleccionada'}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Roles asignados</CardTitle>
            <CardDescription>Roles de plataforma que determinan qué puedes ver y hacer en la consola.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {permissions.roles.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {permissions.roles.map((role) => (
                <Badge key={role} variant="secondary">
                  {role}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm leading-6 text-muted-foreground">
              Tu sesión no tiene roles de plataforma asignados. Contacta con un administrador de la organización si necesitas acceso adicional.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
