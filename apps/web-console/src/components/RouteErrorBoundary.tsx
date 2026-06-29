import { AlertTriangle } from 'lucide-react'
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * Shell-level route error boundary (#755).
 *
 * Attached as the `errorElement` of the pathless layout route that wraps the console content
 * routes. When a content route throws while rendering (e.g. React #426 — "a component suspended
 * while responding to synchronous input", which is what a lazily-loaded page does when reached via
 * a synchronous in-app `navigate()`), react-router renders this element in the nearest matching
 * `errorElement` instead of letting the error bubble to the root boundary and blank the whole
 * element tree. Because the boundary sits *inside* `ConsoleShellLayout`'s `<Outlet/>`, the shell
 * navigation chrome stays mounted and the raw minified stack is never shown to the operator.
 *
 * This is defense-in-depth: the primary fix for the secrets crash is eager-importing the wired
 * pages in `router.tsx` so they never suspend. This boundary guarantees that any future
 * lazy-route / Suspense regression degrades gracefully (contained, on-brand message) rather than
 * crashing the entire console shell.
 */
export function RouteErrorBoundary() {
  const error = useRouteError()

  let title = 'No se pudo mostrar esta sección'
  let description =
    'Ocurrió un error inesperado al cargar esta vista de la consola. La navegación principal sigue ' +
    'disponible: puedes volver a la vista general o reintentar la acción.'

  if (isRouteErrorResponse(error)) {
    title = `Error ${error.status}`
    description =
      typeof error.data === 'string' && error.data.trim().length > 0
        ? error.data
        : error.statusText || description
  }

  return (
    <section
      role="region"
      aria-label="Error de la sección de consola"
      data-testid="console-route-error-boundary"
      className="space-y-4"
    >
      <Alert variant="destructive">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <AlertTitle>{title}</AlertTitle>
            <AlertDescription>{description}</AlertDescription>
          </div>
        </div>
      </Alert>
      <div>
        <Button asChild variant="secondary">
          <Link to="/console/overview">Volver a la consola</Link>
        </Button>
      </div>
    </section>
  )
}
