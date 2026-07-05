# Console design-system primitives — Card, Table, Tabs

`apps/web-console/src/components/ui/` holds the console's shared, theme-correct building
blocks. Prior to issue #757, this directory had `button.tsx`, `input.tsx`, `select.tsx`,
`textarea.tsx`, `label.tsx`, `badge.tsx`, `dialog.tsx`, `checkbox.tsx`, `alert.tsx`, and
`separator.tsx`, but **no `Card`, `Table`, or `Tabs` primitive** — every card panel and every
`<table>` on the data-plane screens (Postgres/Mongo inventory and their `/data` editors,
Storage, Flows, Members) was hand-rolled, so header styles and panel idioms diverged
screen-to-screen. This page documents the three primitives added to close that gap, and the
consistency guarantee they now provide across the data-plane surface.

## Card (`@/components/ui/card`)

`Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` codify the
panel idiom the Postgres/Mongo inventory pages had already established by convention:
`rounded-3xl border border-border bg-card/70 p-6 shadow-sm`. Every part accepts `className`
(merged via `cn()`/`tailwind-merge`, so a caller can adjust spacing without losing the shared
look) and forwards the rest of its props — `aria-label`, `aria-busy`, `data-testid`, etc. —
to the underlying `<div>`/`<h2>`/`<p>`, exactly like `button.tsx`/`input.tsx`.

Each part renders with a `data-slot` attribute (`data-slot="card"`, `"card-header"`,
`"card-title"`, `"card-description"`, `"card-content"`, `"card-footer"`) — a stable,
style-independent hook tests can query without depending on Tailwind class strings.

This closed the most visible regression: `ConsoleSecretsPage.tsx`'s revoke dialog previously
rendered a hard-coded `rounded bg-white p-4 shadow` panel — a light-mode card on the
console's permanent dark theme (see `console-form-control-theming.md` for the theme). It, and
`ConsoleStoragePage.tsx`'s previously flat `rounded-xl border border-border` (no `bg-card`)
panels, now render through `Card`.

## Table (`@/components/ui/table`)

`Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `TableCaption`
codify one grid idiom: `Table` wraps the native `<table>` in a
`overflow-x-auto rounded-2xl border border-border` container (`data-slot="table-container"`);
`TableHeader` renders the `bg-muted/50 text-left text-xs uppercase tracking-[0.2em]
text-muted-foreground` column-header row style; `TableBody` renders `divide-y divide-border
bg-background/40`. `Table` accepts a `containerClassName` prop (in addition to `className` for
the `<table>` itself) so callers that need e.g. `mt-4` on the outer wrapper don't have to
re-implement the container.

Before this primitive existed, six different `<th>` class combinations were in use for the
same "column header" role across `ConsolePostgresPage.tsx`, `ConsoleMongoPage.tsx`,
`ConsoleStoragePage.tsx`, `ConsoleMembersPage.tsx`, and `ConsoleFlowsPage.tsx` — some
uppercase with letter-spacing, some not; some with a `bg-muted` header row, some with only a
bottom border. All five pages, plus the Postgres/Mongo `/data` editors' row and preview
grids, now render through `Table`.

`aria-label` (or a `<TableCaption>`) still provides the table's accessible name exactly as
before — migrating to the primitive does not change what `getByRole('table', { name: ... })`
resolves to; it only changes which component the accessible-name-and-styling implementation
lives in.

**Sanctioned exception — `ConsoleFlowsPage.tsx`:** the flow-list table renders through `Table`
(one component, one `data-slot="table"`), but deliberately overrides the container to
`containerClassName="rounded-lg bg-card"` (not the canonical `rounded-2xl`, and adding a
background the canonical container doesn't specify) and `TableBody` to
`className="divide-y-0 bg-transparent"` (not the canonical `divide-y divide-border
bg-background/40`), preserving this table's pre-#757 look intentionally. The header row
(`TableHeader`, unmodified) still uses the canonical `bg-muted/50` uppercase style, so "one
header style" holds; "one container/body idiom" does not, for this one screen, by design.

## Tabs (`@/components/ui/tabs`)

`Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` provide an accessible tab strip for the
mode-switchers that were previously a plain `Button` group with no tab semantics:

- `Tabs` is controlled (`value`/`onValueChange`), matching the existing local `useState`
  pattern these switchers already used — adopting it does not change a page's state shape.
- `TabsList` renders `role="tablist"`.
- `TabsTrigger` renders `role="tab"`, `aria-selected`, and roving `tabIndex` (`0` on the
  active tab, `-1` on the rest).
- `TabsList` handles `ArrowRight`/`ArrowDown` (next), `ArrowLeft`/`ArrowUp` (previous, with
  wraparound both ways), `Home` (first), and `End` (last) — moving focus AND activating the
  target tab, per the WAI-ARIA Tabs pattern.
- `TabsContent` renders only the panel matching the active `value`.

`ConsoleStoragePage.tsx`'s bucket detail switcher (Objetos / URLs prefirmadas / Multiparte) is
the first adopter: it is exactly a tab strip (one panel visible at a time, mutually
exclusive), and now exposes `role="tablist"`/`role="tab"` instead of a bare button group. The
Postgres/Mongo inventory pages' own internal switchers (schema/table-detail tabs; database/
collection-detail tabs) are **not** converted in this change — see the "Deliberately out of
scope" section of `openspec/changes/add-757-console-dataplane-design-system/proposal.md` for
why, and treat that as a candidate follow-up.

## The data-plane consistency guarantee

As of #757, every data-plane screen — the Postgres and Mongo inventory pages, their `/data`
row/document editors, Storage, Flows, and Members — renders its buttons, inputs, selects,
tables and card panels exclusively through the shared primitives in
`apps/web-console/src/components/ui/`. There is no remaining hand-rolled `<table>`, no
remaining hard-coded panel background, and no remaining native/unstyled `<button>`/`<input>`/
`<select>`/`<textarea>` on those screens. `PostgresDataEditor.tsx` and `MongoDataEditor.tsx` in
particular — which previously had **zero `className` usage** — now use `Button`, `Input`,
`Select`, `Textarea`, `Label`, `Card`, and `Table` for every control.

Superadmin-only surfaces (the Plans catalog, chrome/tokens) are out of scope for this
guarantee; they are tracked by separate issues.

## Token discipline (issue #744)

Issue #757 converged the data-plane surface onto the shared primitives; issue #744 extended the
same token discipline to the rest of the authenticated console and closed two remaining theme
bugs.

**No hardcoded light-mode utilities.** Every panel/table/badge in `apps/web-console/src` renders
on theme tokens — `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`,
`border-border` — never a literal Tailwind color that only reads correctly against a white page
(`bg-white`, `bg-slate-<n>`, `text-slate-<n>`). A worst-offender example fixed by #744:
`ConsoleSecretRotationPage.tsx` previously rendered three solid `bg-white` panels directly on the
dark theme. This is enforced by a repo-guard test,
`apps/web-console/src/no-hardcoded-light-mode-colors.test.ts`, which scans the whole
`apps/web-console/src` tree (excluding `*.test.tsx`/`*.stories.tsx`) for these patterns. It
carries a `SANCTIONED_EXCEPTIONS` list for the rare, reviewed case where a literal class is not a
dark-theme regression (e.g. a vendored snippet whose color is not console UI) — kept **empty** as
of #744.

**Status-tone idiom.** Where a badge/pill communicates a semantic status (success, warning,
error, info, neutral), it uses a translucent tint over the border/background with a `-300` text
tone, not a solid light chip:

```text
border-emerald-500/30 bg-emerald-500/10 text-emerald-300   /* success */
border-amber-500/30   bg-amber-500/10   text-amber-300     /* warning */
border-red-500/30     bg-red-500/10     text-red-300       /* error   */
border-sky-500/30     bg-sky-500/10     text-sky-300       /* info    */
border-border         bg-muted/40       text-muted-foreground /* neutral */
```

This idiom was already established by `components/flows/FlowStatusBadge.tsx`; #744 applied it to
every other status badge that still used a solid `bg-<color>-100 text-<color>-800`-style light
chip (`OperationStatusBadge`, `PlanStatusBadge`, `PlanCapabilityBadge`, `BackupScopeLegend`,
`PreflightRiskBadge`, `RiskLevelBadge`, and the ad hoc status colors in the config
export/reprovision/preflight panels).

**Dark-root `-300`-direct tone (no inert `dark:` pairs).** The console renders **dark-root**:
`globals.css`'s `:root` block *is* the dark palette, `tailwind.config.ts` sets
`darkMode: ['class']`, but no `.dark` class is ever added to `<html>`. A class string like
`text-emerald-700 dark:text-emerald-300` therefore always renders its `-700` half — the `dark:`
variant is dead code. Author the `-300` tone **directly**, with no `dark:` prefix and no `-700`
companion:

```tsx
/* Wrong — dark: half never applies on this dark-root console */
className="text-emerald-700 dark:text-emerald-300"

/* Right */
className="text-emerald-300"
```

Issue #757 fixed this for `FlowStatusBadge`'s draft/published tones; issue #744 applied the same
fix to `RunStatusBadge` and 17 other spots across `NodeStatusBadge.tsx`,
`ConsoleFlowDesignerPage.tsx`, `ConsoleFlowRunPage.tsx`, `ConsoleFlowHistoryPage.tsx`,
`DestructiveConfirmationDialog.tsx`, `ConsoleCredentialStatusBadge.tsx`,
`QuotaConsumptionTable.tsx`, and `CapabilityStatusGrid.tsx`.
This is **not** a general license to strip every `dark:` variant repo-wide — only the inert
`text-X-700 dark:text-X-300` pattern (and any `dark:` variant in a file already being rewritten
for another reason) was touched; `dark:` variants elsewhere are left alone pending a future
`.dark`-class decision.

**Card elevation.** `--card` (and `--popover`) previously equalled `--background` in both
`:root` and `.dark` in `globals.css`, so every `bg-card`/`bg-card/NN` panel had zero visual
elevation against the page. Issue #744 gave `--card`/`--popover` a distinct, slightly lighter
HSL value in both blocks, preserving `--card-foreground`'s contrast — a one-line-per-block token
change, not a new component. `--primary`/brand/typeface/focus tokens are unaffected; those are
issue #734's scope.

## Brand tokens (issue #734)

Issue #744 fixed card elevation but explicitly left `--primary`/`--destructive`/typeface/focus
alone. Issue #734 closes that gap: the console had a brand navy (`#1B2D5B`) in
`index.html`'s `theme-color` meta and the logo, but it never made it into a CSS token — every
primary button rendered an unbranded pale ice-blue (`--primary: 204 94% 94%`), there was no
`@font-face`/bundled font (body and buttons fell back to Tailwind preflight's generic
`ui-sans-serif, system-ui, …` stack), and `--destructive` — reused as inline error TEXT color on
dozens of screens, not just the destructive button's surface — measured ~2:1 contrast as text, a
WCAG AA failure (needs 4.5:1). All three are now fixed at the **token** level in
`apps/web-console/src/styles/globals.css` (both the `:root` and `.dark` blocks, kept in sync per
the #744 idiom, since the console renders dark-root with no `.dark` class ever applied to
`<html>`), so every screen picks up the fix automatically — no component was hand-patched with a
literal palette class, and the `no-hardcoded-light-mode-colors.test.ts` guard's exceptions list
stays empty.

**Primary — navy-family brand blue.** The raw brand navy (`hsl(223 54% 23%)`, `#1B2D5B`) is only
~1.5:1 against `--background` and unusable as a large button surface on this dark theme, so
`--primary` is a lighter tint from the **same hue** (`223`, `≈220-230` is the navy family) tuned
to clear WCAG 1.4.11 non-text contrast (`>=3:1` against `--background`) with headroom, and
`--primary-foreground` is a near-black shade from that same hue (not raw white) so the button
label clears WCAG 1.4.3 text contrast (`>=4.5:1`) against the now-lighter surface:

```text
--primary:            223 60% 62%   /* was 204 94% 94% (:root) / 210 40% 98% (.dark) — unbranded */
--primary-foreground: 223 60% 8%    /* was 222.2 47.4% 11.2% */
```

Measured (real WCAG contrast math, not eyeballed — see the `hsl -> relative luminance -> contrast
ratio` helper in `src/styles/brand-tokens.test.ts`):

| Pair | Ratio | Requirement |
| --- | --- | --- |
| `--primary` vs `--background` | 5.60:1 | `>=3:1` (WCAG 1.4.11, non-text UI contrast) |
| `--primary-foreground` vs `--primary` | 5.35:1 | `>=4.5:1` (WCAG 1.4.3, text contrast) |
| `--primary` vs `--secondary` | 4.09:1 | clearly distinct from the secondary/disabled surface |

**Destructive — accessible error-text contrast.** `--destructive` is now a lighter red from the
same hue (`0`) so it is legible as inline error text, and `--destructive-foreground` is darkened
to match so the destructive `Button` variant's label contrast is preserved:

```text
--destructive:            0 72% 62%   /* was 0 62.8% 30.6% (#7F1D1D) */
--destructive-foreground: 0 72% 8%    /* was 210 40% 98% */
```

| Pair | Ratio | Requirement |
| --- | --- | --- |
| `--destructive` (as text) vs `--background` | 5.56:1 | `>=4.5:1` (WCAG AA text) |
| `--destructive` (as text) vs the `bg-destructive/10` tint over `--background` | 5.15:1 | `>=4.5:1` |
| `--destructive` (as text) vs the `bg-destructive/20` tint over `--background` | 4.57:1 | `>=4.5:1` |
| `--destructive-foreground` vs `--destructive` (button label) | 5.32:1 | `>=4.5:1` (was 9.56:1 — still comfortably clears it) |

**Focus ring — already accessible, left unchanged.** `--ring` (`212.7 26.8% 83.9%`) measures
13.46:1 against `--background` and 12.01:1 against `--card` — a highly visible focus indicator
already, well above the `>=3:1` WCAG 1.4.11 bar. No change was needed; `brand-tokens.test.ts`
guards the ratio staying `>=3:1` so a future edit can't silently regress it.

**Typeface — self-hosted Inter Variable.** The console previously shipped no `@font-face` at
all. It now bundles the
[`@fontsource-variable/inter`](https://www.npmjs.com/package/@fontsource-variable/inter) package
(OFL-1.1 licensed) as a normal `apps/web-console` dependency:

```ts
// src/main.tsx — only the non-italic weight axis (100-900) is imported; the console never
// renders italics. The font files ship inside the npm package and are bundled into the Vite
// build output as ordinary static assets — no runtime Google-Fonts/CDN fetch, so this works
// fully offline/air-gapped, matching the self-hosted product's deployment model.
import '@fontsource-variable/inter/wght.css'
```

```ts
// tailwind.config.ts — theme.extend.fontFamily.sans
sans: ['"Inter Variable"', 'ui-sans-serif', 'system-ui', /* …Tailwind's default system stack */]
```

Tailwind's preflight sets `html { font-family: theme('fontFamily.sans', …) }`, so overriding
`fontFamily.sans` (rather than requiring every component to opt in via a `font-sans` utility
class) makes **every** screen pick up the brand face by default — the system stack remains as the
fallback for the brief pre-load window or any glyph the bundled subsets don't cover.

**How to use these tokens.** Nothing changes for callers: `bg-primary text-primary-foreground`
(the `Button` `default` variant, `Badge` `default` variant, active nav/tab states) and
`text-destructive` (inline error copy) already consume these variables via
`hsl(var(--primary))` / `hsl(var(--destructive))` in `tailwind.config.ts` — the brand color and
accessible contrast apply automatically everywhere those utilities are used, with no
component-level changes required.
