# Migrate the console members page

## Why

Issue #1266 revision 5 migrates `/console/members` to the next console while
preserving the legacy directory, account creation and invitation lifecycle.
The approved blueprint is `57f536f4-a597-4564-9c85-bc835b96e41f`, SHA256
`d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`;
page `console-members-page`, wave u2, entry SHA256
`a83361e00e7de747bedde12c9704cce06be574b7ee1813b9b0b1387e3b5f1073`.

## What changes

- Enable the existing migrated flag and conditional lazy dispatch. Preserve the
  authenticated shell, its permission snapshot and legacy rollback handoff.
- Compose resource-index with pinned gntik-ui 0.11.0 blocks and tokens 0.3.0,
  explicit data/label props and the es-default/en page namespace.
- Resolve the realm from the active tenant's identityContext. Load all users
  with page[size]=100 and opaque continuations, deduplicating userIds. Repeated
  cursors and failed continuations discard the whole users collection. Roles
  load independently with page[size]=100. No tenant or realm sends no page calls.
- Preserve trimmed account creation, masked PasswordInput, role filtering,
  section errors, management gating and the manager-only invitations table.
- Use kit WizardLayout in a focus view for workspace, email, role and summary;
  re-read persisted permissions on open, then load quotas. Invalid or pending
  quota keeps the email step; metric failures preserve legacy fail-open behavior.
- Keep the exact invitation POST and idempotency options, revoke `{}` and resend
  `{email}` through unchanged console-api primitives. Guard double activation.
- Display one-time fragment links only in ephemeral component state. Clear on
  Close, Hide link, tenant change and unmount; never announce or persist a proof.
- Add component, route, rollback and mocked parity tests, fixture inventory and
  visual-state coverage in both locales at all three viewports.

Revision 5 supersedes the five-step/message flow with four steps and no message.
The intended differences are quota fetch on open, enabled validating Next,
summary Edit, focus view, cleared rows on failed invitation GET and user dedupe.
All later legacy invitation lifecycle changes remain represented.

## Validation

Normal Vitest, separate fixture tests, legacy members and console-api regressions,
typecheck/build, i18n and colour lints, fixture scan and parity validation are local
gates. Browser parity, axe, viewport and CSP runs require PR CI because Chromium
is unavailable in the maker sandbox. MCP validate_page is unavailable; the
supplied Hermes snapshot and installed pinned kit types are the offline reference.
Visual specs cover every named state and fixture; CI captures es/en images and
the operator reviews baselines under the November 2 amendment.

## Scope, risk and rollback

No backend, legacy, shared contract, kit version, deployment or CI changes.
R3 credential lifecycle effects require both providers and human approval before
merge. This delivery performs only mocked mutations and a local source commit.
The control plane must confirm all listed blockers, including
`gap:merged-6be392bfcea941b7`, before merge.

Removing the migrated flag restores pendingPage under `/next/console/members`
without members requests and restores a plain legacy shell link. It stops new
calls without undoing accounts, invitation minting or revocation.
