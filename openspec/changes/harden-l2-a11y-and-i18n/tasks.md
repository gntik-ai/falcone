## 1. Failing tests

- [ ] 1.1 [test] Add `AuditEventDetail.test.tsx` cases: (a) with no
      `operationsLinkBuilder`, the operation id renders as plain text and
      no `<a href="/admin/backup/operations/...">` is present, proving B3
      from `:19`; (b) the rejection label resolves to the English
      `Reason:` by default, proving B8 from `:47`.
- [ ] 1.2 [test] Add `AuditEventTable.test.tsx` cases asserting clickable
      rows expose `role="button"`, `tabIndex={0}`, and `aria-expanded`, and
      that pressing `Enter` or `Space` on a focused row toggles expansion,
      proving B9 from `:30-33`.

## 2. Implementation

- [ ] 2.1 [fix] Replace the hard-coded href in
      `AuditEventDetail.tsx:19` with a `operationsLinkBuilder?: (id: string)
      => string | null` prop; render `<a>` only when the builder returns a
      non-null string.
- [ ] 2.2 [impl] Add `apps/console/src/lib/i18n.ts` providing an
      IntlProvider wrapper and `apps/console/src/locales/{en,es}.json` with
      a `audit.rejection.label` entry (`Reason:` / `Motivo:`).
- [ ] 2.3 [fix] Replace `Motivo:` at `AuditEventDetail.tsx:47` with
      `<FormattedMessage id="audit.rejection.label" />`; wrap the app root
      in `<IntlProvider locale={detected} messages={catalogue}>`.
- [ ] 2.4 [fix] Promote the clickable `<tr>` at
      `AuditEventTable.tsx:30-33` to a button-role row with `tabIndex={0}`,
      `aria-expanded={expandedId === id}`, and an `onKeyDown` handler that
      toggles expansion on `Enter` and `Space`.

## 3. Validation

- [ ] 3.1 [docs] Document the i18n surface (`src/locales/*.json`) and the
      `operationsLinkBuilder` contract in `apps/console/README.md`.
- [ ] 3.2 [test] Run `pnpm --filter @in-falcone/console test` and
      `openspec validate harden-l2-a11y-and-i18n --strict`; both green.
