import { Link, useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AUTH_PANEL_CLASS_NAME, AUTH_PANEL_HEADING_CLASS_NAME } from '@/lib/console-auth-surface'
import { consoleAuthConfig } from '@/lib/console-config'
import { hasUsableConsoleSession, readConsoleShellSession } from '@/lib/console-session'

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
  const isAuthenticated = hasUsableConsoleSession(readConsoleShellSession())

  const primaryTarget = isAuthenticated ? '/console' : consoleAuthConfig.loginPath
  const primaryLabel = isAuthenticated ? 'Ir a la consola' : 'Ir al acceso'

  return (
    <section className={`${AUTH_PANEL_CLASS_NAME} text-center`}>
      <Badge variant="secondary">404</Badge>
      <h1 className={`${AUTH_PANEL_HEADING_CLASS_NAME} mt-4`}>Página no encontrada</h1>
      <p className="mt-4 text-base leading-7 text-muted-foreground">
        La ruta solicitada no existe todavía en la consola administrativa. Puedes volver al punto de entrada
        principal y continuar desde allí.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button asChild>
          <Link to={primaryTarget}>{primaryLabel}</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link to="/">Volver al inicio</Link>
        </Button>
        <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
          Volver atrás
        </Button>
      </div>
    </section>
  )
}
