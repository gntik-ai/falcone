import { ArrowRight, KeyRound } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { consoleAuthConfig } from '@/lib/console-config'

export function WelcomePage() {
  return (
    <main className="flex min-h-dvh items-start justify-center bg-background px-4 py-8 text-foreground sm:px-6 sm:py-12 lg:items-center lg:px-8 lg:py-16">
      <section
        aria-labelledby="foundation-title"
        className="w-full max-w-3xl rounded-3xl border border-border/80 bg-card/80 p-6 shadow-2xl shadow-black/20 backdrop-blur sm:p-8 lg:p-10"
      >
        <Badge className="mb-6" variant="secondary">
          Bienvenido a la consola
        </Badge>
        <div className="space-y-6">
          <div className="space-y-3">
            <h1
              id="foundation-title"
              className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl"
            >
              In Falcone Console
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
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
    </main>
  )
}
