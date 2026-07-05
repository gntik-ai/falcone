import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { FORM_FIELD_ERROR_CLASS_NAME, INVALID_FORM_CONTROL_CLASS_NAME } from '@/lib/console-create-form-validation'
import { getConsolePermissions } from '@/lib/console-permissions'
import {
  consumeConsoleAuthStatusHint,
  consumeProtectedRouteIntent,
  ensureConsoleSession,
  persistConsoleShellSession,
  readConsoleShellSession
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

interface LoginFieldErrors {
  username?: string
  password?: string
}

// Joins description ids, dropping any falsy entries — used to compose aria-describedby chains
// that grow/shrink as feedback, per-field required errors, and static help text come and go.
function describedBy(...ids: Array<string | null | undefined | false>): string | undefined {
  const list = ids.filter((id): id is string => Boolean(id))
  return list.length > 0 ? list.join(' ') : undefined
}

const initialForm = {
  username: '',
  password: '',
  rememberMe: false
}

const invalidCredentialsMessage = 'Revisa tu usuario y contraseña e inténtalo de nuevo.'

// #761 (F2c-5, observer-first IA): a read-only tenant role (tenant_viewer/tenant_developer) has no
// use for the operator `overview` placeholder — land it on a read destination
// (metrics/audit) instead. An explicit deep-link intent (e.g. a bookmarked protected route) always
// wins over this default for every role.
function resolvePostLoginDestination(): string {
  const intent = consumeProtectedRouteIntent()
  if (intent) {
    return intent
  }

  const session = readConsoleShellSession()
  const permissions = getConsolePermissions(session?.principal?.platformRoles)
  return permissions.isReadOnly ? '/console/observability' : '/console/overview'
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
  const usernameInputRef = useRef<HTMLInputElement>(null)
  const passwordInputRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState(initialForm)
  const [signupPolicy, setSignupPolicy] = useState<ConsoleSignupPolicy | null>(null)
  const [policyLoading, setPolicyLoading] = useState(true)
  const [feedback, setFeedback] = useState<FeedbackState>(null)
  const [statusView, setStatusView] = useState<ConsoleAccountStatusView | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({})

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
      return `El alta conservará la organización ${tenantId} y el área de trabajo ${workspaceId}.`
    }

    if (tenantId) {
      return `El alta conservará la organización ${tenantId}.`
    }

    if (workspaceId) {
      return `El alta conservará el área de trabajo ${workspaceId}; revisa la organización antes de enviar el registro.`
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
  const usernameDescription = describedBy(
    'login-username-help',
    fieldErrors.username ? 'login-username-required' : null,
    isCredentialFeedback ? 'login-feedback' : null
  )
  const passwordDescription = describedBy(
    'login-password-help',
    fieldErrors.password ? 'login-password-required' : null,
    isCredentialFeedback ? 'login-feedback' : null
  )
  const usernameInvalid = isCredentialFeedback || Boolean(fieldErrors.username)
  const passwordInvalid = isCredentialFeedback || Boolean(fieldErrors.password)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    setStatusView(null)

    // Localized inline required-field validation, in lieu of the browser-native "required" popup
    // (which renders in the browser locale, not Spanish). `noValidate` on the <form> disables the
    // native popup; this check runs BEFORE any network call. (#729)
    const trimmedUsername = form.username.trim()
    const nextFieldErrors: LoginFieldErrors = {}
    if (!trimmedUsername) {
      nextFieldErrors.username = consoleAuthConfig.labels.requiredField
    }
    if (!form.password) {
      nextFieldErrors.password = consoleAuthConfig.labels.requiredField
    }

    if (nextFieldErrors.username || nextFieldErrors.password) {
      setFieldErrors(nextFieldErrors)
      const firstInvalidInput = nextFieldErrors.username ? usernameInputRef.current : passwordInputRef.current
      firstInvalidInput?.focus()
      return
    }

    setFieldErrors({})
    setIsSubmitting(true)

    try {
      const createdSession = await createConsoleLoginSession({
        username: trimmedUsername,
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
          <h1 className="max-w-2xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
            {consoleAuthConfig.headings.title}
          </h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            {consoleAuthConfig.headings.subtitle}
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
          <form className="space-y-6" onSubmit={handleSubmit} aria-describedby={loginFeedbackId} noValidate>
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
                aria-invalid={usernameInvalid || undefined}
                className={usernameInvalid ? INVALID_FORM_CONTROL_CLASS_NAME : undefined}
                // Place the caret on the first field so keyboard and assistive-tech users
                // can start typing their credential immediately on this dedicated login screen.
                autoFocus
                ref={usernameInputRef}
                value={form.username}
                onChange={(event) => {
                  const value = event.target.value
                  setForm((current) => ({ ...current, username: value }))
                  if (fieldErrors.username) {
                    setFieldErrors((current) => ({ ...current, username: undefined }))
                  }
                }}
                placeholder="operaciones"
                required
                minLength={3}
                maxLength={120}
              />
              <p id="login-username-help" className="text-xs leading-5 text-muted-foreground">
                Usa el usuario de consola asociado a tu organización.
              </p>
              {fieldErrors.username ? (
                <p id="login-username-required" role="alert" className={FORM_FIELD_ERROR_CLASS_NAME}>
                  {fieldErrors.username}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{consoleAuthConfig.labels.password}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                aria-describedby={passwordDescription}
                aria-invalid={passwordInvalid || undefined}
                className={passwordInvalid ? INVALID_FORM_CONTROL_CLASS_NAME : undefined}
                ref={passwordInputRef}
                value={form.password}
                onChange={(event) => {
                  const value = event.target.value
                  setForm((current) => ({ ...current, password: value }))
                  if (fieldErrors.password) {
                    setFieldErrors((current) => ({ ...current, password: undefined }))
                  }
                }}
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
              {fieldErrors.password ? (
                <p id="login-password-required" role="alert" className={FORM_FIELD_ERROR_CLASS_NAME}>
                  {fieldErrors.password}
                </p>
              ) : null}
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
              Tu sesión permanece protegida durante la navegación: si el destino que buscabas requería iniciar
              sesión, volverás automáticamente a él en cuanto accedas.
            </div>
          </aside>
        </div>
      </section>
    </main>
  )
}
