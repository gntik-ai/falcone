## Why

On the dark-themed web console, several form controls are **bare native
`<input>`/`<select>`/`<textarea>` with no `className`**. Tailwind's preflight (Tailwind 3.4.x)
sets `color: inherit` on form controls — so they inherit the body's near-white
`--foreground` (≈ `#FAFBFC`) — but sets `background-color: transparent` **only on
button-type inputs**. Text inputs, selects, and textareas therefore keep the user-agent
**white background (`#ffffff`)**, producing near-white text on white (~**1.02:1** contrast),
far below the WCAG 2.1 AA minimum of **4.5:1**. The value the user types is effectively
invisible.

The defect is proven by the design-system primitives themselves: `ui/input.tsx`,
`ui/select.tsx`, and `ui/textarea.tsx` all explicitly add `bg-background` (and, for `Input`,
`text-foreground`) precisely to override this preflight behaviour. The bare controls bypass
those primitives.

Confirmed bare controls on HEAD `17ec4af5`:

- `apps/web-console/src/pages/ConsolePostgresDataPage.tsx` — `#pg-db`, `#pg-schema`,
  `#pg-table` (bare `<input>`), bare `<label>`s.
- `apps/web-console/src/pages/ConsoleMongoDataPage.tsx` — `#mongo-db`, `#mongo-collection`
  (bare `<input>`), bare `<label>`s.
- `apps/web-console/src/components/console/RealtimeConsole.tsx` — `#rt-source` (bare
  `<select>`), `#rt-db`, `#rt-collection`, `#rt-schema`, `#rt-table`, `#rt-key` (bare
  `<input>`), bare `<label>`s.
- `apps/web-console/src/components/console/EventsConsole.tsx` — `#new-topic` (bare
  `<input>`), `#message-json` (bare `<textarea>`), bare `<label>`s.
- `apps/web-console/src/components/console/FunctionsConsole.tsx` — `#deploy-spec-json`,
  `#input-json` (bare `<textarea>`), bare `<label>`s.

## What Changes

- **Swap every bare text-entry control to the design-system primitives.** In the five files
  above, `<input>` → `<Input>` (`@/components/ui/input`), `<textarea>` → `<Textarea>`
  (`@/components/ui/textarea`), `<select>` → `<Select>` (`@/components/ui/select`), and the
  associated `<label>` → `<Label>` (`@/components/ui/label`). Every prop (`id`, `value`,
  `onChange`, `placeholder`, `htmlFor`, …) is preserved — the primitives forward `{...props}`,
  so behaviour is identical and only styling changes. Component ids, handlers, and logic are
  unchanged. The `type="radio"` selectors in `EventsConsole`/`FunctionsConsole` remain native
  radios (selection widgets, not text entry) and are covered by the safety-net rule below.
- **Add a base-layer safety net in `apps/web-console/src/styles/globals.css`** (inside the
  existing `@layer base`):
  ```css
  input,
  textarea,
  select {
    @apply bg-background text-foreground;
  }
  ```
  This guarantees that ANY console form control — including a future bare/straggler control —
  inherits a theme-correct dark background. Because `@layer base` is the lowest-priority
  Tailwind layer, it is overridden by the design-system primitives' own `bg-background`
  utility classes and by any explicit background utility on an already-styled control (e.g.
  the plan-catalog status filter), so it is a no-op for styled controls and only affects
  truly-bare ones.
- **Bounded design pass on the affected form regions** (step 5b, since the change touches the
  web console): a UX pass (field grouping + spacing, responsive grids, card-style page headers,
  design-system `Button` swaps, and legible `role="alert"`/`role="status"` feedback) and a UI
  visual-polish pass (unify the field-grid vertical rhythm), both reusing the existing design
  system and preserving every control `id`, `htmlFor`↔`id` pairing, `role`, button accessible
  name, and the asserted `bg-background`/`text-foreground` classes. The full
  data-editor/list/result redesign of these deliberately-bare pages is deferred to the dedicated
  issues **#757** (data-plane design system) and **#789** (Functions UX/UI).
- **Regression test** `apps/web-console/src/pages/form-control-legibility.test.tsx` renders
  each affected page/component and asserts each control's rendered `className` carries
  `bg-background` (and, for inputs, `text-foreground`). RED on `main` (bare control →
  empty className → no match), GREEN on this branch (primitive → className includes
  `bg-background`).
- **No contract artifacts changed**: no `*.openapi.json`, no generated SDK/types, no
  `internal-contracts`, no `public-route-catalog.json`, no gateway config. This is a
  frontend-only styling fix.
- **Docs**: a new reference page
  `docs/reference/architecture/console-form-control-theming.md` documents the requirement
  and the Tailwind-preflight root cause.

## Capabilities

### Modified Capabilities

- `web-console`: an ADDED requirement — every console form control (input/select/textarea)
  must render with a theme-correct foreground/background so its text and the user-entered
  value meet WCAG 2.1 AA (≥ 4.5:1) in the dark theme. This is a new requirement under
  `web-console` (no existing requirement in `openspec/specs/web-console/spec.md` covers
  form-control legibility), so it is added as `## ADDED Requirements`, not MODIFIED.
