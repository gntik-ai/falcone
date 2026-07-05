import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { FORM_FIELD_ERROR_CLASS_NAME, INVALID_FORM_CONTROL_CLASS_NAME } from '@/lib/console-create-form-validation'
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

interface SignupFieldErrors {
  username?: string
  displayName?: string
  primaryEmail?: string
  tenantId?: string
  password?: string
}

// Joins description ids, dropping any falsy entries — used to compose aria-describedby chains
// that grow/shrink as static help text and per-field required errors come and go.
function describedBy(...ids: Array<string | null | undefined | false>): string | undefined {
  const list = ids.filter((id): id is string => Boolean(id))
  return list.length > 0 ? list.join(' ') : undefined
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
  const [fieldErrors, setFieldErrors] = useState<SignupFieldErrors>({})
  const usernameInputRef = useRef<HTMLInputElement>(null)
  const displayNameInputRef = useRef<HTMLInputElement>(null)
  const primaryEmailInputRef = useRef<HTMLInputElement>(null)
  const tenantIdInputRef = useRef<HTMLInputElement>(null)
  const passwordInputRef = useRef<HTMLInputElement>(null)
  const successRef = useRef<HTMLDivElement>(null)

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

  // After a successful active-account signup, move focus to the confirmation so keyboard and
  // assistive-tech users are taken straight to the plain-language guidance + primary next action,
  // instead of being left on the (now-superseded) submit button (#730).
  useEffect(() => {
    if (registration) {
      successRef.current?.focus()
    }
  }, [registration])

  const signupAllowed = signupPolicy?.selfServiceEnabled === true

  const passwordMinLength = useMemo(() => {
    const minLength = signupPolicy?.passwordPolicy?.minLength
    return typeof minLength === 'number' && Number.isFinite(minLength) && minLength > 0 ? minLength : 8
  }, [signupPolicy])
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

    // Localized inline required-field validation, in lieu of the browser-native "required" popup
    // (which renders in the browser locale, not Spanish). `noValidate` on the <form> disables the
    // native popup; this check runs BEFORE any network call. (#729)
    const trimmedUsername = form.username.trim()
    const trimmedDisplayName = form.displayName.trim()
    const trimmedPrimaryEmail = form.primaryEmail.trim()
    const tenantId = form.tenantId.trim()

    const nextFieldErrors: SignupFieldErrors = {}
    if (!trimmedUsername) {
      nextFieldErrors.username = consoleAuthConfig.labels.requiredField
    }
    if (!trimmedDisplayName) {
      nextFieldErrors.displayName = consoleAuthConfig.labels.requiredField
    }
    if (!trimmedPrimaryEmail) {
      nextFieldErrors.primaryEmail = consoleAuthConfig.labels.requiredField
    }
    if (!tenantId) {
      nextFieldErrors.tenantId = consoleAuthConfig.labels.requiredField
    }
    if (!form.password) {
      nextFieldErrors.password = consoleAuthConfig.labels.requiredField
    }

    if (
      nextFieldErrors.username ||
      nextFieldErrors.displayName ||
      nextFieldErrors.primaryEmail ||
      nextFieldErrors.tenantId ||
      nextFieldErrors.password
    ) {
      setFieldErrors(nextFieldErrors)
      const firstInvalidInput = nextFieldErrors.username
        ? usernameInputRef.current
        : nextFieldErrors.displayName
          ? displayNameInputRef.current
          : nextFieldErrors.primaryEmail
            ? primaryEmailInputRef.current
            : nextFieldErrors.tenantId
              ? tenantIdInputRef.current
              : passwordInputRef.current
      firstInvalidInput?.focus()
      return
    }

    setFieldErrors({})
    setIsSubmitting(true)

    try {
      const workspaceId = form.workspaceId.trim()
      const createdRegistration = await createConsoleSignup({
        username: trimmedUsername,
        displayName: trimmedDisplayName,
        primaryEmail: trimmedPrimaryEmail,
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

      // Single success surface: the confirmation alert below leads with the service's plain-language
      // guidance, keeps the registration reference, and carries the primary next action. Avoid a
      // second, redundant success banner via `feedback` (which stays reserved for error states).
      setRegistration(createdRegistration)
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
    <section className="w-full rounded-3xl border border-border/80 bg-card/80 p-6 shadow-2xl shadow-black/20 backdrop-blur sm:p-8 lg:p-10">
      <div className="mb-8 space-y-3 sm:mb-10">
        <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
          {consoleAuthConfig.labels.signupTitle}
        </h1>
        <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
          {consoleAuthConfig.labels.signupSubtitle}
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
            <form className="space-y-6" onSubmit={handleSubmit} aria-describedby={formFeedbackId} noValidate>
              <div className="space-y-2">
                <Label htmlFor="username">{consoleAuthConfig.labels.username}</Label>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  aria-describedby={describedBy('username-help', fieldErrors.username ? 'username-required' : null)}
                  aria-invalid={Boolean(fieldErrors.username) || undefined}
                  className={fieldErrors.username ? INVALID_FORM_CONTROL_CLASS_NAME : undefined}
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
                  maxLength={63}
                  pattern="^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$"
                />
                <p id="username-help" className="text-xs leading-5 text-muted-foreground">
                  3-63 caracteres: minúsculas, números y guiones; empieza y termina con letra o número.
                </p>
                {fieldErrors.username ? (
                  <p id="username-required" role="alert" className={FORM_FIELD_ERROR_CLASS_NAME}>
                    {fieldErrors.username}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="displayName">{consoleAuthConfig.labels.displayName}</Label>
                  <Input
                    id="displayName"
                    name="displayName"
                    autoComplete="name"
                    aria-describedby={fieldErrors.displayName ? 'displayName-required' : undefined}
                    aria-invalid={Boolean(fieldErrors.displayName) || undefined}
                    className={fieldErrors.displayName ? INVALID_FORM_CONTROL_CLASS_NAME : undefined}
                    ref={displayNameInputRef}
                    value={form.displayName}
                    onChange={(event) => {
                      const value = event.target.value
                      setForm((current) => ({ ...current, displayName: value }))
                      if (fieldErrors.displayName) {
                        setFieldErrors((current) => ({ ...current, displayName: undefined }))
                      }
                    }}
                    placeholder="Operaciones Plataforma"
                    required
                    minLength={1}
                    maxLength={120}
                  />
                  {fieldErrors.displayName ? (
                    <p id="displayName-required" role="alert" className={FORM_FIELD_ERROR_CLASS_NAME}>
                      {fieldErrors.displayName}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="primaryEmail">{consoleAuthConfig.labels.primaryEmail}</Label>
                  <Input
                    id="primaryEmail"
                    name="primaryEmail"
                    type="email"
                    autoComplete="email"
                    aria-describedby={fieldErrors.primaryEmail ? 'primaryEmail-required' : undefined}
                    aria-invalid={Boolean(fieldErrors.primaryEmail) || undefined}
                    className={fieldErrors.primaryEmail ? INVALID_FORM_CONTROL_CLASS_NAME : undefined}
                    ref={primaryEmailInputRef}
                    value={form.primaryEmail}
                    onChange={(event) => {
                      const value = event.target.value
                      setForm((current) => ({ ...current, primaryEmail: value }))
                      if (fieldErrors.primaryEmail) {
                        setFieldErrors((current) => ({ ...current, primaryEmail: undefined }))
                      }
                    }}
                    placeholder="ops@example.com"
                    required
                    maxLength={160}
                  />
                  {fieldErrors.primaryEmail ? (
                    <p id="primaryEmail-required" role="alert" className={FORM_FIELD_ERROR_CLASS_NAME}>
                      {fieldErrors.primaryEmail}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-5 rounded-2xl border border-border/70 bg-background/35 p-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="tenantId">ID de organización requerido</Label>
                  <Input
                    id="tenantId"
                    name="tenantId"
                    autoComplete="organization"
                    aria-describedby={describedBy('tenantId-help', fieldErrors.tenantId ? 'tenantId-required' : null)}
                    aria-invalid={Boolean(fieldErrors.tenantId) || undefined}
                    className={fieldErrors.tenantId ? INVALID_FORM_CONTROL_CLASS_NAME : undefined}
                    ref={tenantIdInputRef}
                    value={form.tenantId}
                    onChange={(event) => {
                      const value = event.target.value
                      setForm((current) => ({ ...current, tenantId: value }))
                      if (fieldErrors.tenantId) {
                        setFieldErrors((current) => ({ ...current, tenantId: undefined }))
                      }
                    }}
                    placeholder="ten_demo"
                    required
                    minLength={3}
                    maxLength={120}
                  />
                  <p id="tenantId-help" className="text-xs leading-5 text-muted-foreground">
                    Identifica la organización donde se creará la cuenta; se completa automáticamente cuando el enlace la incluye.
                  </p>
                  {fieldErrors.tenantId ? (
                    <p id="tenantId-required" role="alert" className={FORM_FIELD_ERROR_CLASS_NAME}>
                      {fieldErrors.tenantId}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="workspaceId">ID de área de trabajo opcional</Label>
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
                    Añádelo solo si el acceso debe quedar asociado a un área de trabajo concreta desde el alta.
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
                  aria-describedby={describedBy('password-help', fieldErrors.password ? 'password-required' : null)}
                  aria-invalid={Boolean(fieldErrors.password) || undefined}
                  className={fieldErrors.password ? INVALID_FORM_CONTROL_CLASS_NAME : undefined}
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
                  minLength={passwordMinLength}
                  maxLength={256}
                />
                <p id="password-help" className="text-xs leading-5 text-muted-foreground">
                  Mínimo {passwordMinLength} caracteres según la policy de este entorno.
                </p>
                {fieldErrors.password ? (
                  <p id="password-required" role="alert" className={FORM_FIELD_ERROR_CLASS_NAME}>
                    {fieldErrors.password}
                  </p>
                ) : null}
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
              <AlertDescription className="break-words">{feedback.message}</AlertDescription>
            </Alert>
          ) : null}

          {registration ? (
            <div ref={successRef} tabIndex={-1} className="outline-none">
              <Alert variant="success" role="status" aria-live="polite">
                <AlertTitle>Tu cuenta está lista</AlertTitle>
                <AlertDescription>
                  <span className="block">
                    {registration.message || 'Tu cuenta ya está disponible para entrar en la consola.'}
                  </span>
                  <span className="mt-2 block">
                    Guarda esta referencia de tu solicitud por si necesitas contactar a soporte:{' '}
                    {registration.registrationId}.
                  </span>
                  <Link
                    className="mt-3 inline-flex font-medium text-primary underline underline-offset-4"
                    to={consoleAuthConfig.loginPath}
                  >
                    Continuar hacia login
                  </Link>
                </AlertDescription>
              </Alert>
            </div>
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
            Cuando el alta se acepta, tu cuenta queda lista para entrar en la consola; si tu organización
            requiere aprobación, verás el estado de tu solicitud en la pantalla de activación pendiente.
          </div>
        </aside>
      </div>
    </section>
  )
}
