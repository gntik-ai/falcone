# Console form controls — dark-theme legibility

The web console renders in a permanent dark theme: `apps/web-console/src/styles/globals.css`
defines `--background: 222.2 84% 4.9%` (near-black) and `--foreground: 210 40% 98%`
(near-white), and `body` applies `bg-background text-foreground`. This page documents the rule
that keeps form controls (`<input>`, `<select>`, `<textarea>`) legible against that dark
background.

## The Tailwind-preflight trap

The console uses Tailwind's preflight (`@tailwind base`). Preflight resets form controls so they
inherit typography: it sets `color: inherit` on `input`, `select`, and `textarea`, so an unstyled
control inherits the body's near-white `--foreground`. However, preflight only sets
`background-color: transparent` on **button-type** inputs — for text inputs, selects, and
textareas it leaves the **user-agent white background** in place.

The result for a *bare* control (a native element with no `className`) is near-white text on a
white background — roughly **1.02:1** contrast, far below the WCAG 2.1 AA minimum of **4.5:1**.
The value the user types is effectively invisible.

This is exactly why the design-system primitives override the background. In
`apps/web-console/src/components/ui/input.tsx` the `Input` class list includes
`bg-background … text-foreground`; `apps/web-console/src/components/ui/select.tsx` (`Select`) and
`apps/web-console/src/components/ui/textarea.tsx` (`Textarea`) include `bg-background`. On the
dark background these primitives are legible.

## Rule: use the design-system primitives

**A console form control MUST render via the design-system primitives**, not a bare native
element:

- `<input>` → `Input` (`@/components/ui/input`)
- `<select>` → `Select` (`@/components/ui/select`) — a thin wrapper around a native `<select>`
  that forwards children, so `<option>` children work unchanged
- `<textarea>` → `Textarea` (`@/components/ui/textarea`)
- the associated `<label>` → `Label` (`@/components/ui/label`)

Each primitive forwards `{...props}` to the underlying element, so `id`, `value`, `onChange`,
`placeholder`, `htmlFor`, `type`, and ARIA attributes behave identically — only the styling
changes. The data-plane editors and the realtime subscribe form follow this rule:
`ConsolePostgresDataPage`, `ConsoleMongoDataPage`, `RealtimeConsole`, `EventsConsole`, and
`FunctionsConsole` use `Input`/`Select`/`Textarea`/`Label` for their text-entry fields. As of
#757, the row/document editors these pages render — `PostgresDataEditor` and
`MongoDataEditor` — also use the primitives for every field (filter column/operator/value,
page size, edit/insert JSON textareas); they previously rendered bare, unstyled native
controls. See `console-design-system-primitives.md` for the `Card`/`Table`/`Tabs` primitives
and the full data-plane consistency guarantee.

## Safety net: the base-layer rule

As defense-in-depth, `apps/web-console/src/styles/globals.css` also pins the theme colours on
native form elements inside `@layer base`:

```css
input,
textarea,
select {
  @apply bg-background text-foreground;
}
```

This guarantees that **any** control — including a future bare/straggler control, or a native
selection widget such as a checkbox or radio — gets a theme-correct background rather than the
UA white default. Because `@layer base` is the lowest-priority Tailwind layer, this rule is
overridden by:

- the design-system primitives' own `bg-background`/`text-foreground` utility classes (which
  resolve to the same values), and
- any explicit background/foreground utility on an intentionally-styled control — for example
  the plan-catalog status filter in `ConsolePlanCatalogPage`, whose `<select>` carries
  `bg-background text-foreground` and whose `<option>`s carry `bg-card text-foreground`.

So the safety net is a no-op for already-styled controls and only affects truly-bare ones. It is
not a substitute for the primitives — prefer the primitives for new controls; the base rule
exists only to prevent a regression from going unnoticed.

**Rule:** new console form controls use the `Input`/`Select`/`Textarea` primitives so their text
and the user-entered value remain legible in the dark theme; the `globals.css` base rule is the
backstop, not the primary mechanism.
