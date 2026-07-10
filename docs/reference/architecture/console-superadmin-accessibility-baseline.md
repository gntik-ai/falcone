# Console superadmin accessibility baseline

Issue #753 defines the minimum accessibility contract for the superadmin console surfaces. The
baseline is frontend-only: it does not change control-plane routes, request/response shapes,
OpenAPI, generated clients, auth claims, or realtime events.

## Modal dialogs

`apps/web-console/src/components/ui/dialog.tsx` is the shared modal primitive for console dialogs
and wizards. `DialogContent` renders the modal semantics by default:

- `role="dialog"` unless a caller intentionally overrides it, for example `role="alertdialog"`
  in destructive confirmations.
- `aria-modal="true"` for dialog/alertdialog roles.
- Accessible name and description are coordinated through `DialogTitle` and
  `DialogDescription`; callers with custom headings can pass `aria-label`,
  `aria-labelledby`, or `aria-describedby` to `DialogContent`.
- Focus moves into the dialog on open, Tab/Shift+Tab stay inside it, Escape requests close, and
  focus returns to the opener on close.
- Backdrop/outside click close is opt-in via `closeOnInteractOutside`. The default is `false` so
  a stray click cannot silently discard multi-step form data.

The create-tenant wizard explicitly keeps outside close disabled. Explicit Cancel, Escape, and
successful completion still use the wizard's normal close/reset path; the protected path is the
accidental backdrop click while fields are dirty.

## Tables and row actions

The plan catalog no longer relies on `<tr onClick>` for navigation. Each plan exposes real
keyboard-operable links: the slug opens the plan detail, and the action cell exposes an "Abrir"
link styled through `Button asChild`. Pointer and keyboard users therefore activate the same
semantic targets, and Enter follows the link without row-specific key handling.

## Landmarks

`ConsoleShellLayout` owns the authenticated console's single main landmark:
`<main id="console-main-content">`. Routed console page components render sections or other
non-main containers inside that shell. This keeps the skip link target stable and prevents screen
readers from announcing nested or competing main regions on plan, tenant, operations,
observability, and data-plane routes.

## Controls and tabs

Superadmin filters use shared design-system form primitives where applicable. Native select
behavior remains, but styling and focus treatment come from `@/components/ui/select`.

Plan detail tabs use the shared `Tabs` primitive documented in
[console-design-system-primitives.md](./console-design-system-primitives.md): tablist/tab roles,
`aria-selected`, roving tabindex, keyboard arrow navigation, and labelled tab panels are owned by
the primitive rather than reimplemented per page.
