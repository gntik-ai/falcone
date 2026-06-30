import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

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
  tenantId: string
  workspaceId: string
}

const initialForm: SignupFormState = {
  username: '',
  displayName: '',
  primaryEmail: '',
  password: '',
  tenantId: '',
  workspaceId: ''
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
  const [searchParams] = useSearchParams()
  const queryTenantId = (searchParams.get('tenantId') ?? searchParams.get('tenant') ?? '').trim()
  const queryWorkspaceId = (searchParams.get('workspaceId') ?? '').trim()
  const [form, setForm] = useState<SignupFormState>(() => ({
    ...initialForm,
    tenantId: queryTenantId,
    workspaceId: queryWorkspaceId
  }))
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

  useEffect(() => {
    setForm((current) => ({
      ...current,
      tenantId: current.tenantId || queryTenantId,
      workspaceId: current.workspaceId || queryWorkspaceId
    }))
  }, [queryTenantId, queryWorkspaceId])

  const signupAllowed = signupPolicy?.selfServiceEnabled === true

  const passwordMinLength = useMemo(() => {
    const minLength = signupPolicy?.passwordPolicy?.minLength
    return typeof minLength === 'number' && Number.isFinite(minLength) && minLength > 0 ? minLength : 8
  }, [signupPolicy])
  const tenantHasError = feedback?.title === 'Falta el tenant del registro'
  const formFeedbackId = feedback ? 'signup-feedback' : undefined

  const policySummary = useMemo(() => {
    if (policyLoading) {
      return 'Estamos resolviendo la policy efectiva de auto-registro…'
    }

    if (!signupPolicy) {
      return 'No hemos podido confirmar la policy de auto-registro. Puedes volver a intentarlo o acceder desde login si ya tienes cuenta.'
    }

    if (!signupPolicy.selfServiceEnabled) {
      return signupPolicy.message || consoleAuthConfig.labels.signupDisabled
    }

    return signupPolicy.message || 'El registro está habilitado y, si el alta se acepta, podrás continuar hacia el acceso de consola.'
  }, [policyLoading, signupPolicy])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!signupPolicy?.selfServiceEnabled) {
      return
    }

    setFeedback(null)
    setRegistration(null)

    const tenantId = form.tenantId.trim()
    if (!tenantId) {
      setFeedback({
        variant: 'destructive',
        title: 'Falta el tenant del registro',
        message: 'Indica el tenant en el que se creará la cuenta antes de enviar el registro.'
      })
      return
    }

    setIsSubmitting(true)

    try {
      const workspaceId = form.workspaceId.trim()
      const createdRegistration = await createConsoleSignup({
        username: form.username.trim(),
        displayName: form.displayName.trim(),
        primaryEmail: form.primaryEmail.trim(),
        password: form.password,
        tenantId,
        ...(workspaceId ? { workspaceId } : {})
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
          message: error.message || signupPolicy?.message || consoleAuthConfig.labels.signupDisabled
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
    <main className="flex min-h-dvh items-start justify-center bg-background px-4 py-8 text-foreground sm:px-6 sm:py-12 lg:items-center lg:px-8 lg:py-16">
      <section className="w-full max-w-5xl rounded-3xl border border-border/80 bg-card/80 p-6 shadow-2xl shadow-black/20 backdrop-blur sm:p-8 lg:p-10">
        <div className="mb-8 space-y-3 sm:mb-10">
          <img src="/img/logo-wide.png" alt="In Falcone" className="mb-3 h-16 w-auto" />
          <Badge variant="secondary" className="w-fit">
            EP-14 / US-UI-01-T03
          </Badge>
          <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
            {consoleAuthConfig.labels.signupTitle}
          </h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            {consoleAuthConfig.labels.signupSubtitle}
          </p>
          <p className="max-w-2xl break-words text-sm leading-6 text-muted-foreground">
            Realm <span className="font-medium text-foreground">{consoleAuthConfig.realm}</span> · Client ID{' '}
            <span className="font-medium text-foreground">{consoleAuthConfig.clientId}</span>
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <div className="space-y-5">
            {policyLoading ? (
              <Alert role="status" aria-live="polite" aria-busy="true">
                <AlertTitle>Resolviendo policy de registro</AlertTitle>
                <AlertDescription>{policySummary}</AlertDescription>
              </Alert>
            ) : signupAllowed ? (
              <form className="space-y-6" onSubmit={handleSubmit} aria-describedby={formFeedbackId}>
                <div className="space-y-2">
                  <Label htmlFor="username">{consoleAuthConfig.labels.username}</Label>
                  <Input
                    id="username"
                    name="username"
                    autoComplete="username"
                    aria-describedby="username-help"
                    value={form.username}
                    onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                    placeholder="operaciones"
                    required
                    minLength={3}
                    maxLength={63}
                    pattern="^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$"
                  />
                  <p id="username-help" className="text-xs leading-5 text-muted-foreground">
                    3-63 caracteres: minúsculas, números y guiones; empieza y termina con letra o número.
                  </p>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
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
                </div>

                <div className="grid gap-5 rounded-2xl border border-border/70 bg-background/35 p-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="tenantId">Tenant ID requerido</Label>
                    <Input
                      id="tenantId"
                      name="tenantId"
                      autoComplete="organization"
                      aria-describedby="tenantId-help"
                      aria-invalid={tenantHasError || undefined}
                      value={form.tenantId}
                      onChange={(event) => setForm((current) => ({ ...current, tenantId: event.target.value }))}
                      placeholder="ten_demo"
                      required
                      minLength={3}
                      maxLength={120}
                    />
                    <p id="tenantId-help" className="text-xs leading-5 text-muted-foreground">
                      Identifica el tenant donde se creará la cuenta; se completa automáticamente cuando el enlace lo incluye.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="workspaceId">Workspace ID opcional</Label>
                    <Input
                      id="workspaceId"
                      name="workspaceId"
                      autoComplete="off"
                      aria-describedby="workspaceId-help"
                      value={form.workspaceId}
                      onChange={(event) => setForm((current) => ({ ...current, workspaceId: event.target.value }))}
                      placeholder="wrk_demo"
                      maxLength={120}
                    />
                    <p id="workspaceId-help" className="text-xs leading-5 text-muted-foreground">
                      Añádelo solo si el acceso debe quedar asociado a un workspace concreto desde el alta.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">{consoleAuthConfig.labels.password}</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    aria-describedby="password-help"
                    value={form.password}
                    onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder="••••••••••••"
                    required
                    minLength={passwordMinLength}
                    maxLength={256}
                  />
                  <p id="password-help" className="text-xs leading-5 text-muted-foreground">
                    Mínimo {passwordMinLength} caracteres según la policy de este entorno.
                  </p>
                </div>

                <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                  <Button
                    type="submit"
                    disabled={isSubmitting || policyLoading || !signupAllowed}
                    aria-busy={isSubmitting}
                    className="w-full sm:w-auto"
                  >
                    {isSubmitting ? consoleAuthConfig.labels.signupSubmitLoading : consoleAuthConfig.labels.signupSubmit}
                  </Button>
                  <Button asChild type="button" variant="link" className="justify-start px-0 sm:justify-center">
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
              <Alert id="signup-feedback" variant={feedback.variant} aria-live="assertive">
                <AlertTitle>{feedback.title}</AlertTitle>
                <AlertDescription>{feedback.message}</AlertDescription>
              </Alert>
            ) : null}

            {registration ? (
              <Alert variant="success" role="status" aria-live="polite">
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

          <aside className="self-start space-y-4 rounded-3xl border border-border/70 bg-background/45 p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-semibold">Policy de auto-registro</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              La consola resuelve la policy efectiva antes de exponer el flujo de alta y refleja si el acceso será inmediato o pendiente de aprobación.
            </p>
            <Alert role="status" aria-live="polite" aria-busy={policyLoading}>
              <AlertTitle>
                {policyLoading
                  ? 'Resolviendo policy…'
                  : signupAllowed
                    ? 'Registro habilitado'
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
