import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
    <section className="w-full rounded-3xl border border-border/80 bg-card/80 p-6 shadow-2xl shadow-black/20 backdrop-blur sm:p-8 lg:p-10">
      <div className="mb-8 space-y-3">
        <h1 className="max-w-2xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
          {consoleAuthConfig.labels.pendingActivationTitle}
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
          Esta pantalla muestra el estado de tu solicitud de acceso mientras esperas aprobación o activación.
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

        {navigationState?.registrationId ? (
          <Alert>
            <AlertTitle>Solicitud recibida</AlertTitle>
            <AlertDescription>
              <span className="block">
                Guarda esta referencia de tu solicitud por si necesitas contactar a soporte:{' '}
                {navigationState.registrationId}.
              </span>
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
  )
}
