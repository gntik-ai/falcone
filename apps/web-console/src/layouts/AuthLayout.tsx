import { useEffect, useMemo, useRef } from 'react'
import { Link, Outlet, useLocation, useMatches } from 'react-router-dom'

import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { consoleAuthConfig } from '@/lib/console-config'

const DEFAULT_DOCUMENT_TITLE = 'Consola In Falcone'

interface AuthRouteHandle {
  title?: string
}

/**
 * Shared shell for every unauthenticated route (#731): the welcome hub (`/`), login, signup, the
 * pending-activation confirmation, password recovery, and the 404 fallback. Mirrors
 * `ConsoleShellLayout`'s pattern — a pathless `<Outlet/>` layout route — so the funnel gets ONE
 * brand mark, ONE consistent container width, a `<header>` landmark, and a persistent way back to
 * login/home, instead of each page hand-rolling its own shell (which previously drifted: differing
 * container widths, the brand mark missing on 3 of the 6 routes, and a static `document.title` on
 * every route regardless of which screen was showing).
 *
 * The per-route `document.title` is read from the matched leaf route's `handle.title` (set in
 * `router.tsx`) so this layout stays a single, declarative place for the title mechanism rather
 * than each page setting its own.
 */
export function AuthLayout() {
  const location = useLocation()
  const matches = useMatches()
  const mainRef = useRef<HTMLElement>(null)
  const hasNavigatedRef = useRef(false)

  const title = useMemo(() => {
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const handleTitle = (matches[index]?.handle as AuthRouteHandle | undefined)?.title
      if (handleTitle) {
        return handleTitle
      }
    }

    return DEFAULT_DOCUMENT_TITLE
  }, [matches])

  useDocumentTitle(title)

  // Route-change focus management (#731). Moving between funnel screens is a client-side route
  // change, so by default focus is left on the (now-unmounted) link the user activated and drops to
  // <body> — keyboard and assistive-tech users silently lose their place, with the document.title
  // change alone typically going unannounced. On each in-app navigation we send focus to the <main>
  // landmark so the destination screen is announced and Tab resumes from its content. We deliberately
  // DEFER to any screen that manages its own focus (LoginPage / PasswordRecoveryPage autofocus their
  // first field): React applies `autoFocus` during commit, before this passive effect runs, so if
  // focus already sits inside <main> we leave it untouched. The very first render is skipped so the
  // initial page load is never hijacked.
  useEffect(() => {
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true
      return
    }

    const main = mainRef.current
    if (!main) {
      return
    }

    if (main.contains(document.activeElement) && document.activeElement !== main) {
      return
    }

    main.focus()
  }, [location.pathname])

  // Never self-link: the brand mark is a plain (non-interactive) mark on the welcome hub itself
  // (since it already IS "home"), and the persistent "back to login" affordance is omitted on the
  // login route itself. Every other route keeps exactly one of the two as a live affordance. The
  // logo keeps ONE consistent accessible identity ("In Falcone") on every route; when it doubles as
  // the home link the link's PURPOSE is carried by an explicit `aria-label` rather than by mutating
  // the image's alt text per route.
  const isWelcomeRoute = location.pathname === '/'
  const isLoginRoute = location.pathname === consoleAuthConfig.loginPath

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* Sticky so the brand mark and the "back to login" escape hatch stay in view while a tall
          screen (e.g. the signup form) scrolls — which is what activates the header's frosted
          `bg-background/95 backdrop-blur`. Mirrors ConsoleShellLayout's header height (h-16 via
          py-3 + the h-10 mark) so the chrome reads consistently across the authed/unauth shells.
          `flex-wrap` degrades gracefully at extreme narrow widths. */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
          {isWelcomeRoute ? (
            <span className="flex shrink-0 items-center">
              <img src="/img/logo-wide.png" alt="In Falcone" className="h-10 w-auto" />
            </span>
          ) : (
            <Link
              to="/"
              aria-label="Volver al inicio de In Falcone Console"
              className="flex shrink-0 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <img src="/img/logo-wide.png" alt="In Falcone" className="h-10 w-auto" />
            </Link>
          )}

          {isLoginRoute ? null : (
            <Link
              to={consoleAuthConfig.loginPath}
              className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Volver al inicio de sesión
            </Link>
          )}
        </div>
      </header>

      {/* Top-aligned at EVERY breakpoint (no `lg:items-center`): the funnel screens have very
          different heights (a short 404 vs. the tall two-column signup), so vertically centring
          them would land each screen's h1 at a different Y and make the title jump as the user
          moves between steps. Anchoring content to a consistent top offset keeps the heading put. */}
      <main
        ref={mainRef}
        tabIndex={-1}
        className="flex flex-1 items-start justify-center px-4 py-10 focus:outline-none sm:px-6 sm:py-12 lg:px-8 lg:py-16"
      >
        <div data-testid="auth-shell-container" className="w-full max-w-5xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
