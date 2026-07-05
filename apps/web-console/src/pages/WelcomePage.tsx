import { ArrowRight, KeyRound } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AUTH_PANEL_CLASS_NAME,
  AUTH_PANEL_HEADING_CLASS_NAME,
  AUTH_PANEL_INTRO_CLASS_NAME
} from '@/lib/console-auth-surface'
import { consoleAuthConfig } from '@/lib/console-config'

export function WelcomePage() {
  return (
    <section aria-labelledby="foundation-title" className={AUTH_PANEL_CLASS_NAME}>
      <Badge className="mb-6" variant="secondary">
        Bienvenido a la consola
      </Badge>
      <div className="space-y-6">
        <div className="space-y-3">
          <h1 id="foundation-title" className={AUTH_PANEL_HEADING_CLASS_NAME}>
            In Falcone Console
          </h1>
          <p className={AUTH_PANEL_INTRO_CLASS_NAME}>
            Consola de administración para tu organización en la plataforma BaaS de In Falcone: gestiona el
            acceso de tu equipo, la configuración de tu organización y los servicios habilitados desde un
            mismo lugar, con autenticación respaldada por Keycloak.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <article className="rounded-2xl border border-border/80 bg-background/60 p-5">
            <h2 className="text-base font-semibold">Acceso seguro</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Inicia sesión con tu cuenta de organización; solo las personas autorizadas pueden entrar en la
              consola.
            </p>
          </article>
          <article className="rounded-2xl border border-border/80 bg-background/60 p-5">
            <h2 className="text-base font-semibold">¿Aún no tienes cuenta?</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Si tu organización habilita el registro, puedes solicitar acceso y seguir el estado de tu alta
              hasta que quede activa.
            </p>
          </article>
        </div>

        <div className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Button asChild>
              <Link to={consoleAuthConfig.loginPath}>
                Ir al login
                <KeyRound className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={consoleAuthConfig.signupPath}>
                Solicitar acceso
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
          <Button asChild variant="link" className="justify-start px-0">
            <Link to={consoleAuthConfig.passwordRecoveryPath}>{consoleAuthConfig.labels.passwordRecovery}</Link>
          </Button>
        </div>

        <p className="border-t border-border/60 pt-6 text-sm leading-6 text-muted-foreground">
          ¿Necesitas ayuda para entrar? Contacta a quien administre tu organización.
        </p>
      </div>
    </section>
  )
}
