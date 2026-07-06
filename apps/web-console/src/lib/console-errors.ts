// Shared, localized (Spanish) mapping from a failed console request to human-readable copy.
//
// Issue #743: several console pages carried a local `getApiErrorMessage`/`err.message` echo
// that PREFERRED the raw backend/transport message (e.g. the literal English string
// "requires superadmin", "No action mapped for GET /v1/...", or a bare `HTTP_404`) over the
// page's own localized fallback. That produced English, implementation-leaking text inside an
// otherwise all-Spanish console. `describeConsoleError` is the single place that maps a failed
// request to page content: it NEVER returns the raw transport/exception message for a
// technical failure — only a localized status-based message, or (when the status is missing/
// unknown, e.g. a network failure) the caller-supplied, already-localized `fallback`.
//
// Keep this module dependency-free and side-effect-free so it stays trivially tree-shakeable
// and unit-testable in isolation from React/fetch.

/** Minimal shape this module cares about — matches `ApiError` (see `@/lib/http`) structurally
 * without importing it, so this stays usable against any thrown value (including bare
 * `Error` instances, `PlanApiError`, or a plain object read off a non-JSON response). */
interface ConsoleErrorLike {
  status?: unknown
}

function asRecord(error: unknown): ConsoleErrorLike | null {
  return typeof error === 'object' && error !== null ? (error as ConsoleErrorLike) : null
}

/** Reads the HTTP status off a thrown error, if present (works for the console's `ApiError`,
 * `PlanApiError`, and any other error-shaped object carrying a numeric `status`). */
export function getConsoleErrorStatus(error: unknown): number | undefined {
  const record = asRecord(error)
  return record && typeof record.status === 'number' ? record.status : undefined
}

/**
 * Maps a failed console request to a localized (Spanish), human-readable message.
 *
 * Never returns the raw transport/exception message for a technical (network/HTTP) failure —
 * only a localized, status-based message. When the status is absent or not one of the mapped
 * codes (e.g. a network error, an aborted request, or an unrecognized status), the
 * page-supplied, already-localized `fallback` is returned instead.
 */
export function describeConsoleError(error: unknown, fallback: string): string {
  const status = getConsoleErrorStatus(error)

  switch (status) {
    case 401:
      return 'Tu sesión expiró o no es válida. Vuelve a iniciar sesión.'
    case 403:
      return 'No tienes permiso para ver este recurso.'
    case 404:
      return 'No se encontró el recurso solicitado.'
    case 409:
      return 'La solicitud entra en conflicto con el estado actual del recurso.'
    case 429:
      return 'Se alcanzó el límite de solicitudes; inténtalo de nuevo en unos momentos.'
    default:
      if (typeof status === 'number' && status >= 500) {
        return 'El servicio no está disponible en este momento.'
      }
      // No status (network error, abort, or a value that isn't request-shaped at all): the
      // caller's own localized fallback is the best available copy — never the raw message.
      return fallback
  }
}
