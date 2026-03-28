import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createConsoleSignup,
  getConsoleSignupPolicy,
  type ConsoleSignupPolicy,
  type ConsoleSignupRegistration
} from '@/lib/console-auth'
import { consoleAuthConfig } from '@/lib/console-config'
import type { ApiError } from '@/lib/http'

type FeedbackState =
  | { variant: 'default' | 'success' | 'destructive'; title: string; message: string }
  | null

interface SignupFormState {
  username: string
  displayName: string
  primaryEmail: string
  password: string
}

const initialForm: SignupFormState = {
  username: '',
  displayName: '',
  primaryEmail: '',
  password: ''
}

interface PendingActivationNavigationState {
  registrationId: string
  state: string
  statusView: string
  activationMode: string
  createdAt: string
  message: string
}

export function SignupPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState(initialForm)
  const [signupPolicy, setSignupPolicy] = useState<ConsoleSignupPolicy | null>(null)
  const [policyLoading, setPolicyLoading] = useState(true)
  const [feedback, setFeedback] = useState<FeedbackState>(null)
  const [registration, setRegistration] = useState<ConsoleSignupRegistration | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    getConsoleSignupPolicy(controller.signal)
      .then((policy) => {
        setSignupPolicy(policy)
      })
      .catch(() => {
        setSignupPolicy(null)
      })
      .finally(() => {
        setPolicyLoading(false)
      })

    return () => controller.abort()
  }, [])

  const signupAllowed = Boolean(signupPolicy?.allowed)

  const policySummary = useMemo(() => {
    if (policyLoading) {
      return 'Estamos resolviendo la policy efectiva de auto-registro…'
    }

    if (!signupPolicy) {
      return 'No hemos podido confirmar la policy de auto-registro. Puedes volver a intentarlo o acceder desde login si ya tienes cuenta.'
    }

    if (!signupPolicy.allowed) {
      return signupPolicy.reason ?? consoleAuthConfig.labels.signupDisabled
    }

    if (signupPolicy.approvalRequired || signupPolicy.effectiveMode === 'approval_required') {
      return 'El registro está habilitado, pero la activación final requiere aprobación antes de entrar en la consola.'
    }

    return 'El registro está habilitado y, si el alta se acepta, podrás continuar hacia el acceso de consola.'
  }, [policyLoading, signupPolicy])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!signupPolicy?.allowed) {
      return
    }

    setFeedback(null)
    setRegistration(null)
    setIsSubmitting(true)

    try {
      const createdRegistration = await createConsoleSignup({
        username: form.username.trim(),
        displayName: form.displayName.trim(),
        primaryEmail: form.primaryEmail.trim(),
        password: form.password
      })

      if (createdRegistration.state === 'pending_activation' || createdRegistration.statusView === 'pending_activation') {
        navigate(consoleAuthConfig.pendingActivationPath, {
          replace: true,
          state: {
            registrationId: createdRegistration.registrationId,
            state: createdRegistration.state,
            statusView: createdRegistration.statusView,
            activationMode: createdRegistration.activationMode,
            createdAt: createdRegistration.createdAt,
            message: createdRegistration.message
          } satisfies PendingActivationNavigationState
        })
        return
      }

      setRegistration(createdRegistration)
      setFeedback({
        variant: 'success',
        title: 'Registro aceptado correctamente',
        message:
          createdRegistration.message ||
          'Tu cuenta ya está disponible para continuar hacia el acceso de consola respaldado por Keycloak.'
      })
    } catch (rawError) {
      const error = rawError as ApiError

      if (error.status === 400) {
        setFeedback({
          variant: 'destructive',
          title: 'No hemos podido validar el registro',
          message: error.message || 'Revisa los campos obligatorios e inténtalo de nuevo.'
        })
      } else if (error.status === 403) {
        setFeedback({
          variant: 'default',
          title: 'El registro no está disponible ahora mismo',
          message: error.message || signupPolicy?.reason || consoleAuthConfig.labels.signupDisabled
        })
      } else if (error.status === 409) {
        setFeedback({
          variant: 'destructive',
          title: 'Ya existe una cuenta con esos datos',
          message: error.message || 'Prueba a iniciar sesión o a recuperar el acceso con la cuenta existente.'
        })
      } else {
        setFeedback({
          variant: 'destructive',
          title: 'No hemos podido completar el registro',
          message:
            error.message || 'Ha ocurrido un error operativo. Puedes reintentar en unos instantes sin recargar la consola.'
        })
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16 text-foreground">
      <section className="w-full max-w-4xl rounded-3xl border border-border bg-card/80 p-10 shadow-2xl shadow-black/20 backdrop-blur">
        <div className="mb-8 space-y-3">
          <Badge variant="secondary">EP-14 / US-UI-01-T03</Badge>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{consoleAuthConfig.labels.signupTitle}</h1>
          <p className="max-w-2xl text-lg leading-8 text-muted-foreground">{consoleAuthConfig.labels.signupSubtitle}</p>
          <p className="text-sm leading-6 text-muted-foreground">
            Realm <span className="font-medium text-foreground">{consoleAuthConfig.realm}</span> · Client ID{' '}
            <span className="font-medium text-foreground">{consoleAuthConfig.clientId}</span>
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5">
            {signupAllowed ? (
              <form className="space-y-5" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="username">{consoleAuthConfig.labels.username}</Label>
                  <Input
                    id="username"
                    name="username"
                    autoComplete="username"
                    value={form.username}
                    onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                    placeholder="operaciones"
                    required
                    minLength={3}
                    maxLength={63}
                    pattern="^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="displayName">{consoleAuthConfig.labels.displayName}</Label>
                  <Input
                    id="displayName"
                    name="displayName"
                    autoComplete="name"
                    value={form.displayName}
                    onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
                    placeholder="Operaciones Plataforma"
                    required
                    minLength={1}
                    maxLength={120}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="primaryEmail">{consoleAuthConfig.labels.primaryEmail}</Label>
                  <Input
                    id="primaryEmail"
                    name="primaryEmail"
                    type="email"
                    autoComplete="email"
                    value={form.primaryEmail}
                    onChange={(event) => setForm((current) => ({ ...current, primaryEmail: event.target.value }))}
                    placeholder="ops@example.com"
                    required
                    maxLength={160}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">{consoleAuthConfig.labels.password}</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder="••••••••••••"
                    required
                    minLength={12}
                    maxLength={256}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" disabled={isSubmitting || policyLoading || !signupAllowed}>
                    {isSubmitting ? consoleAuthConfig.labels.signupSubmitLoading : consoleAuthConfig.labels.signupSubmit}
                  </Button>
                  <Button asChild type="button" variant="link" className="px-0">
                    <Link to={consoleAuthConfig.loginPath}>Ya tengo una cuenta</Link>
                  </Button>
                </div>
              </form>
            ) : (
              <Alert>
                <AlertTitle>Registro no disponible</AlertTitle>
                <AlertDescription>
                  <span className="block">{policySummary}</span>
                  <Link className="mt-3 inline-flex font-medium text-primary underline underline-offset-4" to={consoleAuthConfig.loginPath}>
                    Ir al acceso de consola
                  </Link>
                </AlertDescription>
              </Alert>
            )}

            {feedback ? (
              <Alert variant={feedback.variant}>
                <AlertTitle>{feedback.title}</AlertTitle>
                <AlertDescription>{feedback.message}</AlertDescription>
              </Alert>
            ) : null}

            {registration ? (
              <Alert variant="success">
                <AlertTitle>Resumen del registro</AlertTitle>
                <AlertDescription>
                  <span className="block">Registration ID: {registration.registrationId}</span>
                  <span className="block">Estado: {registration.state}</span>
                  <span className="block">Modo de activación: {registration.activationMode}</span>
                  <span className="block">Status view: {registration.statusView}</span>
                  <span className="block">Creado: {new Date(registration.createdAt).toLocaleString('es-ES')}</span>
                  <Link className="mt-3 inline-flex font-medium text-primary underline underline-offset-4" to={consoleAuthConfig.loginPath}>
                    Continuar hacia login
                  </Link>
                </AlertDescription>
              </Alert>
            ) : null}
          </div>

          <aside className="space-y-4 rounded-3xl border border-border/70 bg-background/40 p-6">
            <h2 className="text-lg font-semibold">Policy de auto-registro</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              La consola resuelve la policy efectiva antes de exponer el flujo de alta y refleja si el acceso será inmediato o pendiente de aprobación.
            </p>
            <Alert>
              <AlertTitle>
                {policyLoading
                  ? 'Resolviendo policy…'
                  : signupAllowed
                    ? signupPolicy?.effectiveMode === 'approval_required'
                      ? 'Registro con aprobación posterior'
                      : 'Registro habilitado'
                    : 'Auto-registro deshabilitado'}
              </AlertTitle>
              <AlertDescription>{policySummary}</AlertDescription>
            </Alert>
            <div className="rounded-2xl border border-dashed border-border/70 p-4 text-sm leading-6 text-muted-foreground">
              Esta iteración cubre signup y activación pendiente. El shell autenticado y la gestión robusta de sesión llegarán en T04 y T05.
            </div>
          </aside>
        </div>
      </section>
    </main>
  )
}
