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
