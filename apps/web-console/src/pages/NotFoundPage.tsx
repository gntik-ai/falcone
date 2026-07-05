import { useEffect, useRef } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AUTH_PANEL_CLASS_NAME,
  AUTH_PANEL_HEADING_CLASS_NAME,
  AUTH_PANEL_INTRO_CLASS_NAME
} from '@/lib/console-auth-surface'
import { consoleAuthConfig } from '@/lib/console-config'
import { hasUsableConsoleSession, readConsoleShellSession } from '@/lib/console-session'

// A "back" step only exists to offer when react-router has recorded a non-initial entry in this
// document's session history (createBrowserRouter writes an incrementing { idx } into history.state).
// When the 404 IS the entry point — a pasted, bookmarked or mistyped URL opened in a fresh tab — idx
// is 0/absent and navigate(-1) would eject the visitor OUT of the console entirely (or no-op), a
// worse dead-end than the one #733 replaced. So we only surface "Volver atrás" when it can stay
// inside the app; the primary + secondary actions always provide a safe way forward, and the
// browser's own Back control is unaffected either way.
function hasNavigableConsoleHistory(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  const historyIndex = (window.history.state as { idx?: number } | null)?.idx
  return typeof historyIndex === 'number' && historyIndex > 0
}

// #733: the 404 fallback is a recovery hub, not a dead end. Previously it offered exactly one
// action ("Volver al inicio") and rendered its "404" eyebrow with `tracking-[0.3em]` on three bare
// digits, which visually reads as "4 0 4". Now it offers a primary path forward — auth-aware, since
// the SAME `*` catch-all under `AuthLayout` (router.tsx) also matches an authenticated visitor who
// lands on an unknown top-level URL (a stale bookmark, a typo, etc.) and shouldn't be pushed at the
// unauth login funnel — plus secondary "home" and "back" escape hatches. The eyebrow now reuses the
// `Badge` primitive the sibling unauth screens already use (WelcomePage, PasswordRecoveryPage)
// instead of a bespoke tracked-uppercase `<p>`, which both fixes the legibility bug and keeps the
// visual hierarchy consistent across the funnel.
export function NotFoundPage() {
  const navigate = useNavigate()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const isAuthenticated = hasUsableConsoleSession(readConsoleShellSession())
  const canGoBack = hasNavigableConsoleHistory()

  const primaryTarget = isAuthenticated ? '/console' : consoleAuthConfig.loginPath
  const primaryLabel = isAuthenticated ? 'Ir a la consola' : 'Ir al acceso'

  // Route-not-found arrival: send focus to the error heading so keyboard and assistive-tech users
  // are told WHAT happened (the h1 is announced) and Tab resumes from the recovery actions rather
  // than the shared header chrome — for EVERY entry path, including a fresh direct load and the
  // authenticated→unknown-top-level-URL layout swap, both of which AuthLayout's own route-change
  // focus intentionally treats as an un-hijacked first render. Mirrors the funnel's existing
  // focus-on-state-change pattern (SignupPage's success confirmation) and composes with AuthLayout,
  // which defers whenever focus already sits inside <main> (#731).
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <section className={`${AUTH_PANEL_CLASS_NAME} text-center`}>
      <div className="mb-8 space-y-3 sm:mb-10">
        <Badge variant="secondary">404</Badge>
        <h1 ref={headingRef} tabIndex={-1} className={`${AUTH_PANEL_HEADING_CLASS_NAME} outline-none`}>
          Página no encontrada
        </h1>
        <p className={`mx-auto ${AUTH_PANEL_INTRO_CLASS_NAME}`}>
          La ruta que intentas abrir no existe en la consola de In Falcone. Puede que el enlace esté
          desactualizado o que la dirección no sea correcta. Elige una de las opciones para continuar.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
        <Button asChild>
          <Link to={primaryTarget}>
            {primaryLabel}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link to="/">Volver al inicio</Link>
        </Button>
        {canGoBack ? (
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Volver atrás
          </Button>
        ) : null}
      </div>
    </section>
  )
}
