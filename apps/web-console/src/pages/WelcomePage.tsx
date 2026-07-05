import { ArrowRight, KeyRound } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export function WelcomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16 text-foreground">
      <section
        aria-labelledby="foundation-title"
        className="w-full max-w-3xl rounded-3xl border border-border bg-card/80 p-10 shadow-2xl shadow-black/20 backdrop-blur"
      >
        <Badge className="mb-6" variant="secondary">
          Bienvenido a la consola
        </Badge>
        <div className="space-y-6">
          <div className="space-y-3">
            <h1 id="foundation-title" className="text-4xl font-semibold tracking-tight sm:text-5xl">
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

          <div className="flex flex-wrap items-center gap-3">
            <Button asChild>
              <a href="/login">
                Ir al login
                <KeyRound className="h-4 w-4" aria-hidden="true" />
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href="#console-overview">
                Conocer la consola
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </Button>
            <Badge variant="outline">Sin dependencia de SDKs de navegador para autenticar</Badge>
          </div>

          <div id="console-overview" className="rounded-2xl border border-dashed border-border/80 p-5">
            <p className="text-sm leading-6 text-muted-foreground">
              Desde aquí puedes iniciar sesión, solicitar acceso si tu organización habilita el registro y
              recuperar tu contraseña si la olvidas. Si necesitas ayuda para entrar, contacta a quien
              administre tu organización.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
