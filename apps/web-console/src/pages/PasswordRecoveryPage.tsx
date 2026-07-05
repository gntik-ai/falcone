import { useRef, useState } from 'react'
import { ArrowLeft, Send } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createConsolePasswordRecoveryRequest,
  type ConsolePasswordRecoveryStatus,
  type ConsolePasswordRecoveryTicket
} from '@/lib/console-auth'
import { consoleAuthConfig } from '@/lib/console-config'
import { FORM_FIELD_ERROR_CLASS_NAME, INVALID_FORM_CONTROL_CLASS_NAME } from '@/lib/console-create-form-validation'
import type { ApiError } from '@/lib/http'

type FeedbackState =
  | { variant: 'default' | 'success' | 'destructive'; title: string; message: string }
  | null

const recoveryStatusLabels: Record<ConsolePasswordRecoveryStatus, string> = {
  pending_delivery: 'Pendiente de envío',
  delivered: 'Instrucciones enviadas',
  completed: 'Recuperación completada',
  expired: 'Solicitud expirada'
}

export function PasswordRecoveryPage() {
  const [usernameOrEmail, setUsernameOrEmail] = useState('')
  const [feedback, setFeedback] = useState<FeedbackState>(null)
  const [ticket, setTicket] = useState<ConsolePasswordRecoveryTicket | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const usernameOrEmailInputRef = useRef<HTMLInputElement>(null)
  const feedbackId = feedback ? 'password-recovery-feedback' : undefined
  const feedbackRole = feedback?.variant === 'destructive' ? 'alert' : 'status'
  const feedbackLive = feedback?.variant === 'destructive' ? 'assertive' : 'polite'
  const usernameOrEmailDescription = [
    'password-recovery-username-help',
    fieldError ? 'password-recovery-username-required' : null
  ]
    .filter(Boolean)
    .join(' ')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    setTicket(null)

    // Localized inline required-field validation, in lieu of the browser-native "required" popup
    // (which renders in the browser locale, not Spanish). `noValidate` on the <form> disables the
    // native popup; this check runs BEFORE any network call. (#729)
    const normalizedUsernameOrEmail = usernameOrEmail.trim()
    if (!normalizedUsernameOrEmail) {
      setFieldError(consoleAuthConfig.labels.requiredField)
      usernameOrEmailInputRef.current?.focus()
      return
    }

    setFieldError(null)
    setIsSubmitting(true)

    try {
      const createdTicket = await createConsolePasswordRecoveryRequest({
        usernameOrEmail: normalizedUsernameOrEmail,
        deliveryChannel: 'email'
      })

      setTicket(createdTicket)
      setFeedback({
        variant: 'success',
        title: 'Solicitud de recuperación recibida',
        message:
          'Si hay una cuenta elegible, enviaremos instrucciones al correo configurado. Revisa tu bandeja de entrada y spam.'
      })
    } catch (rawError) {
      const error = rawError as ApiError

      if (error.status === 404) {
        setFeedback({
          variant: 'default',
          title: 'Recuperación no habilitada en este entorno',
          message:
            'Este entorno todavía no tiene habilitado el servicio de recuperación de contraseña. Vuelve a login o contacta al operador de plataforma.'
        })
      } else if (error.status === 400) {
        setFeedback({
          variant: 'destructive',
          title: 'No hemos podido validar la solicitud',
          message: error.message || 'Revisa el usuario o correo e inténtalo de nuevo.'
        })
      } else if (error.status === 403) {
        setFeedback({
          variant: 'default',
          title: 'La recuperación no está disponible para esta cuenta',
          message: error.message || 'No se puede iniciar la recuperación con esos datos. Contacta al operador de plataforma si necesitas acceso.'
        })
      } else if (error.status === 429) {
        setFeedback({
          variant: 'default',
          title: 'Demasiados intentos de recuperación',
          message: error.message || 'Espera unos minutos antes de volver a solicitar instrucciones.'
        })
      } else {
        setFeedback({
          variant: 'destructive',
          title: 'El servicio de recuperación no está disponible ahora mismo',
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
            Recuperación de acceso
          </Badge>
          <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
            Recupera el acceso a In Falcone Console
          </h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            Solicita instrucciones para recuperar una cuenta de consola. Por seguridad, la respuesta no confirma si el usuario existe.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
          <form className="space-y-6" onSubmit={handleSubmit} aria-describedby={feedbackId} noValidate>
            <div className="space-y-2">
              <Label htmlFor="usernameOrEmail">Usuario o correo de consola</Label>
              <Input
                id="usernameOrEmail"
                name="usernameOrEmail"
                autoComplete="username"
                autoCapitalize="none"
                aria-describedby={usernameOrEmailDescription}
                aria-invalid={Boolean(fieldError) || undefined}
                className={fieldError ? INVALID_FORM_CONTROL_CLASS_NAME : undefined}
                autoFocus
                ref={usernameOrEmailInputRef}
                value={usernameOrEmail}
                onChange={(event) => {
                  setUsernameOrEmail(event.target.value)
                  if (fieldError) {
                    setFieldError(null)
                  }
                }}
                placeholder="operaciones@example.com"
                required
                minLength={3}
                maxLength={255}
              />
              <p id="password-recovery-username-help" className="text-xs leading-5 text-muted-foreground">
                Introduce el usuario o correo asociado a tu cuenta de consola.
              </p>
              {fieldError ? (
                <p id="password-recovery-username-required" role="alert" className={FORM_FIELD_ERROR_CLASS_NAME}>
                  {fieldError}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting} className="w-full sm:w-auto">
                <Send aria-hidden="true" className="h-4 w-4" />
                {isSubmitting ? 'Enviando solicitud…' : 'Enviar instrucciones'}
              </Button>
              <Button asChild variant="outline" className="w-full sm:w-auto">
                <Link to={consoleAuthConfig.loginPath}>
                  <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                  Volver a login
                </Link>
              </Button>
            </div>

            {feedback ? (
              <Alert
                id="password-recovery-feedback"
                variant={feedback.variant}
                role={feedbackRole}
                aria-live={feedbackLive}
              >
                <AlertTitle>{feedback.title}</AlertTitle>
                <AlertDescription>{feedback.message}</AlertDescription>
              </Alert>
            ) : null}

            {ticket ? (
              <Alert role="status" aria-live="polite">
                <AlertTitle>Estado de la solicitud</AlertTitle>
                <AlertDescription>
                  <span className="block">Estado: {recoveryStatusLabels[ticket.status]}</span>
                  <span className="block">Destino de envío: {ticket.maskedDestination}</span>
                  <span className="block">Expira: {new Date(ticket.expiresAt).toLocaleString('es-ES')}</span>
                </AlertDescription>
              </Alert>
            ) : null}
          </form>

          <aside className="self-start space-y-4 rounded-3xl border border-border/70 bg-background/45 p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-semibold">Recuperación segura</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Las instrucciones se envían solo al destino configurado para la cuenta y caducan automáticamente.
            </p>
            <div className="rounded-2xl border border-dashed border-border/70 p-4 text-sm leading-6 text-muted-foreground">
              Si no tienes acceso al correo de recuperación, contacta al operador de plataforma.
            </div>
          </aside>
        </div>
      </section>
    </main>
  )
}
