import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createConsoleLoginSession,
  getConsoleAccountStatusView,
  getConsoleSignupPolicy,
  inferStatusViewFromError,
  type ConsoleAccountStatusView,
  type ConsoleSignupPolicy
} from '@/lib/console-auth'
import { consoleAuthConfig } from '@/lib/console-config'
import {
  consumeConsoleAuthStatusHint,
  consumeProtectedRouteIntent,
  ensureConsoleSession,
  persistConsoleShellSession
} from '@/lib/console-session'
import type { ApiError } from '@/lib/http'

type FeedbackState =
  | {
      variant: 'default' | 'success' | 'destructive'
      kind: 'credential' | 'service' | 'status' | 'success'
      title: string
      message: string
    }
  | null

const initialForm = {
  username: '',
  password: '',
  rememberMe: false
}

const invalidCredentialsMessage = 'Revisa tu usuario y contraseña e inténtalo de nuevo.'

function resolvePostLoginDestination(): string {
  return consumeProtectedRouteIntent() ?? '/console/overview'
}

function isCredentialError(error: ApiError): boolean {
  const code = typeof error.code === 'string' ? error.code.trim().toUpperCase() : ''
  return error.status === 400 || error.status === 401 || error.status === 403 || code === 'INVALID_CREDENTIALS'
}

function resolveCredentialErrorMessage(error: ApiError): string {
  if (error.status === 400 || error.status === 403) {
    return error.message || invalidCredentialsMessage
  }

  return invalidCredentialsMessage
}

export function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const passwordInputRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState(initialForm)
  const [signupPolicy, setSignupPolicy] = useState<ConsoleSignupPolicy | null>(null)
  const [policyLoading, setPolicyLoading] = useState(true)
  const [feedback, setFeedback] = useState<FeedbackState>(null)
  const [statusView, setStatusView] = useState<ConsoleAccountStatusView | null>(null)
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
    const hint = consumeConsoleAuthStatusHint()
    if (hint) {
      setFeedback({
        variant: 'default',
        kind: 'status',
        title: hint.title,
        message: hint.message
      })
    }

    let active = true

    ensureConsoleSession()
      .then((session) => {
        if (!active || !session) {
          return
        }

        navigate(resolvePostLoginDestination(), { replace: true })
      })
      .catch(() => undefined)

    return () => {
      active = false
    }
  }, [navigate])

  const signupVisible = signupPolicy?.selfServiceEnabled === true

  const signupTarget = useMemo(() => {
    const tenantId = (searchParams.get('tenantId') ?? searchParams.get('tenant') ?? '').trim()
    const workspaceId = (searchParams.get('workspaceId') ?? '').trim()
    const nextParams = new URLSearchParams()

    if (tenantId) {
      nextParams.set('tenantId', tenantId)
    }

    if (workspaceId) {
      nextParams.set('workspaceId', workspaceId)
    }

    const query = nextParams.toString()
    return query ? `${consoleAuthConfig.signupPath}?${query}` : consoleAuthConfig.signupPath
  }, [searchParams])

  const signupContextSummary = useMemo(() => {
    const tenantId = (searchParams.get('tenantId') ?? searchParams.get('tenant') ?? '').trim()
    const workspaceId = (searchParams.get('workspaceId') ?? '').trim()

    if (tenantId && workspaceId) {
      return `El alta conservará el tenant ${tenantId} y el workspace ${workspaceId}.`
    }

    if (tenantId) {
      return `El alta conservará el tenant ${tenantId}.`
    }

    if (workspaceId) {
      return `El alta conservará el workspace ${workspaceId}; revisa el tenant antes de enviar el registro.`
    }

    return null
  }, [searchParams])

  const statusAction = useMemo(() => {
    const firstAllowedAction = statusView?.allowedActions[0] ?? null

    if (firstAllowedAction) {
      return firstAllowedAction
    }

    if (statusView?.statusView === 'pending_activation') {
      return {
        actionId: 'view_pending_activation',
        label: 'Ver estado de activación',
        target: consoleAuthConfig.pendingActivationPath
      }
    }

    return null
  }, [statusView])
  const loginFeedbackId = feedback ? 'login-feedback' : undefined
  const isCredentialFeedback = feedback?.kind === 'credential'
  const isDestructiveFeedback = feedback?.variant === 'destructive'
  const usernameDescription = isCredentialFeedback ? 'login-username-help login-feedback' : 'login-username-help'
  const passwordDescription = isCredentialFeedback ? 'login-password-help login-feedback' : 'login-password-help'

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    setStatusView(null)
    setIsSubmitting(true)

    try {
      const createdSession = await createConsoleLoginSession({
        username: form.username.trim(),
        password: form.password,
        rememberMe: form.rememberMe
      })

      persistConsoleShellSession(createdSession)
      setFeedback({
        variant: 'success',
        kind: 'success',
        title: 'Sesión creada correctamente',
        message: 'Redirigiendo al destino protegido solicitado…'
      })
      navigate(resolvePostLoginDestination(), { replace: true })
    } catch (rawError) {
      const error = rawError as ApiError
      const inferredStatus = inferStatusViewFromError(error)

      if (error.status === 409 && inferredStatus) {
        setFeedback({
          variant: 'default',
          kind: 'status',
          title: inferredStatus.title,
          message: inferredStatus.message
        })

        if (inferredStatus.statusView !== 'login') {
          try {
            const view = await getConsoleAccountStatusView(inferredStatus.statusView)
            setStatusView(view)
          } catch {
            setStatusView({
              statusView: inferredStatus.statusView,
              title: inferredStatus.title,
              message: inferredStatus.message,
              allowedActions: []
            })
          }
        }
      } else if (isCredentialError(error)) {
        setFeedback({
          variant: 'destructive',
          kind: 'credential',
          title: 'No hemos podido validar tus credenciales',
          message: resolveCredentialErrorMessage(error)
        })
        passwordInputRef.current?.focus()
      } else {
        setFeedback({
          variant: 'destructive',
          kind: 'service',
          title: 'El servicio de acceso no está disponible ahora mismo',
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
      <section className="w-full max-w-4xl rounded-3xl border border-border/80 bg-card/80 p-6 shadow-2xl shadow-black/20 backdrop-blur sm:p-8 lg:p-10">
        <div className="mb-8 space-y-3 sm:mb-10">
          <img src="/img/logo-wide.png" alt="In Falcone" className="mb-3 h-16 w-auto" />
          <Badge variant="secondary" className="w-fit">
            EP-14 / US-UI-01-T05
          </Badge>
          <h1 className="max-w-2xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
            {consoleAuthConfig.headings.title}
          </h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            {consoleAuthConfig.headings.subtitle}
          </p>
          <p className="max-w-2xl break-words text-sm leading-6 text-muted-foreground">
            Realm <span className="font-medium text-foreground">{consoleAuthConfig.realm}</span> · Client ID{' '}
            <span className="font-medium text-foreground">{consoleAuthConfig.clientId}</span>
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
          <form className="space-y-6" onSubmit={handleSubmit} aria-describedby={loginFeedbackId}>
            {feedback ? (
              <Alert
                id="login-feedback"
                variant={feedback.variant}
                aria-live="assertive"
                aria-atomic="true"
                className={
                  isDestructiveFeedback ? 'border-destructive/30 bg-destructive/5 text-foreground shadow-sm' : undefined
                }
              >
                <AlertTitle className={isDestructiveFeedback ? 'text-foreground' : undefined}>
                  {feedback.title}
                </AlertTitle>
                <AlertDescription className={isDestructiveFeedback ? 'break-words text-muted-foreground' : undefined}>
                  {feedback.message}
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="username">{consoleAuthConfig.labels.username}</Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                aria-describedby={usernameDescription}
                aria-invalid={isCredentialFeedback || undefined}
                // Place the caret on the first field so keyboard and assistive-tech users
                // can start typing their credential immediately on this dedicated login screen.
                autoFocus
                value={form.username}
                onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                placeholder="operaciones"
                required
                minLength={3}
                maxLength={120}
              />
              <p id="login-username-help" className="text-xs leading-5 text-muted-foreground">
                Usa el usuario de consola asociado a tu tenant.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{consoleAuthConfig.labels.password}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                aria-describedby={passwordDescription}
                aria-invalid={isCredentialFeedback || undefined}
                ref={passwordInputRef}
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="••••••••••••"
                required
                // No client-side minLength on login: this form authenticates an EXISTING
                // credential, so it must never impose a length floor that can exceed (or
                // drift from) the platform password policy (`/v1/auth/signups/policy` →
                // `passwordPolicy.minLength`, currently 8) and block policy-valid accounts
                // from submitting. The backend / Keycloak policy stays authoritative. (#804)
                maxLength={256}
              />
              <p id="login-password-help" className="text-xs leading-5 text-muted-foreground">
                La policy de contraseña se valida en el servicio de acceso.
              </p>
            </div>

            <label className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/35 p-4 text-sm text-muted-foreground transition-colors hover:bg-accent/40">
              <input
                type="checkbox"
                checked={form.rememberMe}
                onChange={(event) => setForm((current) => ({ ...current, rememberMe: event.target.checked }))}
                className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
              <span>{consoleAuthConfig.labels.rememberMe}</span>
            </label>

            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting} className="w-full sm:w-auto">
                {isSubmitting ? consoleAuthConfig.labels.submitLoading : consoleAuthConfig.labels.submit}
              </Button>
              <Button asChild variant="link" className="justify-start px-0 sm:justify-center">
                <Link to={consoleAuthConfig.passwordRecoveryPath}>{consoleAuthConfig.labels.passwordRecovery}</Link>
              </Button>
            </div>

            {statusView ? (
              <Alert>
                <AlertTitle>{statusView.title}</AlertTitle>
                <AlertDescription>
                  <span className="block">{statusView.message}</span>
                  {statusAction ? (
                    <Link className="mt-3 inline-flex font-medium text-primary underline underline-offset-4" to={statusAction.target}>
                      {statusAction.label}
                    </Link>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
          </form>

          <aside className="self-start space-y-4 rounded-3xl border border-border/70 bg-background/45 p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-semibold">Acceso y alta</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              La consola consulta la policy efectiva de auto-registro y, si la sesión expira, devuelve al usuario al destino protegido una vez vuelva a autenticarse.
            </p>
            {policyLoading ? (
              <p className="text-sm text-muted-foreground" role="status" aria-live="polite" aria-busy="true">
                Cargando policy de registro…
              </p>
            ) : signupVisible ? (
              <div className="space-y-2">
                <Button asChild variant="outline" className="w-full">
                  <Link to={signupTarget} aria-describedby={signupContextSummary ? 'signup-context-help' : undefined}>
                    {consoleAuthConfig.labels.signup}
                  </Link>
                </Button>
                {signupContextSummary ? (
                  <p id="signup-context-help" className="text-xs leading-5 text-muted-foreground">
                    {signupContextSummary}
                  </p>
                ) : null}
              </div>
            ) : (
              <Alert>
                <AlertTitle>Registro no disponible</AlertTitle>
                <AlertDescription>{signupPolicy?.message ?? consoleAuthConfig.labels.signupDisabled}</AlertDescription>
              </Alert>
            )}
            <div className="rounded-2xl border border-dashed border-border/70 p-4 text-sm leading-6 text-muted-foreground">
              Esta iteración ya protege el shell, conserva el destino solicitado y prepara la base para que T06 valide login, logout y navegación por E2E.
            </div>
          </aside>
        </div>
      </section>
    </main>
  )
}
