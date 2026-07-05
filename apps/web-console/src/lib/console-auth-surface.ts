// Shared presentational class names for the unauthenticated funnel surfaces (#731).
//
// The six unauth screens (welcome hub, login, password recovery, signup, pending-activation, 404)
// all render the same visual primitives inside AuthLayout's single container: an elevated "panel"
// card, a display h1, a muted intro paragraph, and (on the form screens) a supporting aside. Those
// class strings were hand-copied into every page and had already drifted — the 404 panel used a
// lighter shadow / flat padding / a solid border and its h1 skipped the responsive type ramp, and
// the welcome/pending intros pinned `text-lg` instead of the responsive `text-base sm:text-lg`
// ramp the form screens use. Centralising them here (mirroring the existing
// `FORM_FIELD_ERROR_CLASS_NAME` / `INVALID_FORM_CONTROL_CLASS_NAME` constant pattern) gives the
// funnel ONE coherent panel/heading/intro/aside treatment and keeps a future screen from
// re-introducing a one-off variant. All values are design-token based (bg-card / border-border /
// text-muted-foreground / bg-background) so they stay legible in the dark theme.

// Elevated card wrapper for each screen's primary `<section>`. Screens that need it centred (the
// 404) append `text-center`; every other prop (aria-labelledby, etc.) stays on the element.
export const AUTH_PANEL_CLASS_NAME =
  'w-full rounded-3xl border border-border/80 bg-card/80 p-6 shadow-2xl shadow-black/20 backdrop-blur sm:p-8 lg:p-10'

// Display heading ramp shared by every screen's h1 — one consistent type scale across the funnel so
// the title never resizes between steps. Screens append their own measure (`max-w-2xl` / `max-w-3xl`)
// or offset (`mt-4`) as needed.
export const AUTH_PANEL_HEADING_CLASS_NAME =
  'text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl'

// Muted intro paragraph under the heading. Responsive size/leading ramp (base on mobile, larger from
// `sm`) with a readable measure — used verbatim by every screen that has a lede.
export const AUTH_PANEL_INTRO_CLASS_NAME =
  'max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8'

// Supporting side panel on the two-column form screens (login / recovery / signup).
export const AUTH_PANEL_ASIDE_CLASS_NAME =
  'self-start space-y-4 rounded-3xl border border-border/70 bg-background/45 p-5 shadow-sm sm:p-6'
