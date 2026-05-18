## Why

The audit detail and table views ship a dead link, a Spanish-only label
amid an otherwise English UI, and a click-only expand interaction that
locks out keyboard users. From `openspec/audit/cap-l2-backup-audit-reporting-ui.md`:

- **B3** (`apps/console/src/components/backup/AuditEventDetail.tsx:19`) —
  `<a href={\`/admin/backup/operations/${e.operation_id}\`}>` points at a
  route that does not exist in `apps/console/` or `apps/web-console/`. Click
  yields a 404.
- **B8** (`AuditEventDetail.tsx:47`) — the tenant-role detail uses the
  Spanish label `Motivo:` while every other label in the file is English.
- **B9** (`apps/console/src/components/backup/AuditEventTable.tsx:30-33`) —
  `<tr className="cursor-pointer" onClick={...}>` has no `role`, no
  `tabIndex`, and no `onKeyDown`. Keyboard-only users cannot expand rows.
  WCAG 2.1 violation.
- **G4** — i18n family inconsistency flagged in C2 (B15), G1 (B15), K1.
- **G5** — operator-link routing inconsistency across console apps.

## What Changes

- Replace the dead `/admin/backup/operations/${id}` href with a configurable
  `operationsLinkBuilder(id)` that defaults to `null` (no link rendered)
  and is supplied by the host application only when the route exists.
- Replace `Motivo:` with an `<FormattedMessage id="audit.rejection.label">`
  call backed by an English default (`Reason:`); seed the message catalogue
  under `src/locales/en.json` and add `src/locales/es.json` with the
  Spanish translation so the i18n surface is real, not ad-hoc.
- Promote the expand row to a focusable, keyboard-operable element:
  `role="button"`, `tabIndex={0}`, and `onKeyDown` handling `Enter` and
  `Space`. Add an `aria-expanded` attribute reflecting `expandedId`.

## Capabilities

### Modified Capabilities

- `backup-and-restore`: audit-detail link safety, i18n surface for audit
  labels, and keyboard-accessible row expansion.

## Impact

- **Affected code**: `apps/console/src/components/backup/AuditEventDetail.tsx`,
  `apps/console/src/components/backup/AuditEventTable.tsx`, new
  `apps/console/src/locales/{en,es}.json`,
  `apps/console/src/lib/i18n.ts` (FormatJS provider scaffold).
- **Migration required**: none.
- **Breaking changes**: callers that supplied no `operationsLinkBuilder`
  will see the operation field render as plain text instead of a (broken)
  link — this is the intended fix.
- **Out of scope**: a full app-wide i18n migration of every label; this
  change establishes the surface so subsequent label work can plug in.
