import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getConsoleAccountStatusView, type ConsoleAccountStatusView } from '@/lib/console-auth'
import { consoleAuthConfig } from '@/lib/console-config'

interface PendingActivationLocationState {
  registrationId?: string
  state?: string
  statusView?: string
  activationMode?: string
  createdAt?: string
  message?: string
}

const fallbackView: ConsoleAccountStatusView = {
  statusView: 'pending_activation',
  title: 'Tu registro está pendiente de activación',
  message:
    'Hemos recibido tu solicitud de acceso, pero todavía necesitas una aprobación o activación previa antes de entrar en la consola.',
  allowedActions: []
}

export function PendingActivationPage() {
  const location = useLocation()
  const navigationState = (location.state as PendingActivationLocationState | null) ?? null
  const [statusView, setStatusView] = useState<ConsoleAccountStatusView | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()

    getConsoleAccountStatusView('pending_activation', controller.signal)
      .then((view) => {
        setStatusView(view)
      })
      .catch(() => {
        setStatusView(null)
      })
      .finally(() => {
        setLoading(false)
      })

    return () => controller.abort()
  }, [])

  const resolvedView = useMemo(() => {
    if (statusView) {
      return statusView
    }

    return {
      ...fallbackView,
      message: navigationState?.message || fallbackView.message
    }
  }, [navigationState?.message, statusView])

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16 text-foreground">
      <section className="w-full max-w-3xl rounded-3xl border border-border bg-card/80 p-10 shadow-2xl shadow-black/20 backdrop-blur">
        <div className="mb-8 space-y-3">
          <Badge variant="secondary">EP-14 / US-UI-01-T03</Badge>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{consoleAuthConfig.labels.pendingActivationTitle}</h1>
          <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
            Estado intermedio del acceso de consola respaldado por la familia pública `/v1/auth/*`.
          </p>
        </div>

        <div className="space-y-6">
          <Alert>
            <AlertTitle>{resolvedView.title}</AlertTitle>
            <AlertDescription>
              <span className="block">{resolvedView.message}</span>
              {loading ? <span className="mt-2 block text-sm text-muted-foreground">Resolviendo la vista canónica de estado…</span> : null}
            </AlertDescription>
          </Alert>

          {navigationState ? (
            <Alert>
              <AlertTitle>Resumen del registro</AlertTitle>
              <AlertDescription>
                {navigationState.registrationId ? <span className="block">Registration ID: {navigationState.registrationId}</span> : null}
                {navigationState.state ? <span className="block">Estado: {navigationState.state}</span> : null}
                {navigationState.activationMode ? (
                  <span className="block">Modo de activación: {navigationState.activationMode}</span>
                ) : null}
                {navigationState.createdAt ? (
                  <span className="block">Creado: {new Date(navigationState.createdAt).toLocaleString('es-ES')}</span>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {resolvedView.allowedActions.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {resolvedView.allowedActions.map((action) => (
                <Button key={action.actionId} asChild variant="outline">
                  <Link to={action.target}>{action.label}</Link>
                </Button>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link to={consoleAuthConfig.loginPath}>Volver a login</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={consoleAuthConfig.signupPath}>Revisar signup</Link>
            </Button>
          </div>
        </div>
      </section>
    </main>
  )
}
