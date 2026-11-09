# Migrate the console secret rotation page

## Why

Issue #1273 revision 2 migrates `/console/secrets/:encodedSecretPath/rotate`
to `apps/web-console-next` (wave u2). Rotation cannot be undone from the console.
The new page adds typed destructive confirmation, single-flight submission and
explicit read and submit failure states while preserving the current legacy API.

Approved blueprint: `57f536f4-a597-4564-9c85-bc835b96e41f`, SHA256
`d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`.
Page: `console-secret-rotation-page`, entry SHA256
`8c91e440a98fd35f6e1b4a0889335d6e1a430515af7c34aeda8254240b3137f8`.

## What changes

- Add the lazy resource-form composition using gntik-ui ui/blocks/templates
  0.11.0 and tokens 0.3.0, explicit data and label props, and the
  `pages.console-secret-rotation-page` catalogs in es (default) and en.
- Use console-api session transport for only the three routed page endpoints:
  GET history with `limit=20&offset=N`, GET consumer-status without query, and
  POST rotate. Send exactly `{gracePeriodSeconds, justification, newValue}`;
  never send `secretPath` or request version revocation.
- Copy the current legacy shape check and domain/name URL encoding, including
  tenant paths dropping the middle tenant segment from request URLs. Invalid
  decoded paths show the title and not-found/back link without mounting readers,
  a form or a timer.
- Keep default grace 1800. Use a plain number input with min 300, max 86400 and
  `Number(value)` without clamping. Clamp only the slider display to 300..86400.
  Keep native `required` on justification, no `aria-required`, and `noValidate`
  on the form so empty justification still sends an empty string.
- Require the exact decoded path for every confirmation. Cancel/Escape sends
  nothing and restores trigger focus. Disable submit/discard while pending,
  prevent duplicate activation, never retry rotate automatically and retain
  form values after success or failure. Descartar resets locally.
- Show loading, empty, no-access, not-found, server and network states for both
  subordinate lists. Page history with controlled offsets; retry it independently.
  Poll consumers with one 5000 ms timer, retain stale-marked last data after errors,
  reschedule once on consumer retry, and stop on terminal collections or unmount.
- Focus submit validation, toast and announce the result in the active locale.
  Never expose the new value in text feedback, confirmation, logs or screenshots.
  Treat 503 like other submit failures, without an automatic retry.
- Preserve the three legacy test cases on `platform%2Fdb-password`, add invalid
  three-segment coverage, and supply mocked parity fixtures and visual scenarios.

The issue amendments and the legacy changes since the blueprint supersede its
old NO_ROUTE labels, revoke entry, `secretPath` body and `aria-required` wording.
The three endpoints are routed; 404 remains a supported runtime failure state.

## Validation

Run the page and navigation Vitest tests, normal console Vitest suite, typecheck,
build, i18n and colour lints, parity manifest/fixture validation and strict OpenSpec
validation. Existing tests, dependency pins, the browser-session query guard and
CSP harness remain unchanged. Do not run the full suite in shell-fixture mode.

Chromium is unavailable in the delivery sandbox: PR CI runs parity, axe,
responsive and CSP checks. The visual spec covers all named states in es/en at
375, 768 and 1280 px. Under the November 2 amendment, the checker assesses the
code and fixtures here; CI captures screenshots and the operator reviews baselines
after publication. No sandbox screenshot or operator approval is claimed.
MCP validate_page is unavailable; use the supplied Hermes kit snapshot SHA256
`3cd591245ca1c4f1c43e2b09427a2589e06b447cbf6435aae17da8086cabce9e`
and repository conformance checks without fetching the kit.

## Rollout and kill switch

The lazy route is directly accessible under `/next/console/` without a page role
guard; authorization remains server-side. The existing rotation route's
`migrated` flag stays unset until the PR parity gate passes. Inventory links and
navigation therefore keep their legacy full-page handoff during this delivery.
This records the current implementation, rather than claiming parity has passed.

After PARITY_PASS, enabling `migrated: true` opts navigation into the next page.
Removing that flag hands navigation back to legacy. The direct `/next/` dispatch
currently does not depend on that flag: disabling the direct migrated page also
requires reverting its rotation branch in `src/router.tsx` to pendingPage.
Neither switch restores an already rotated secret. Legacy removal and cutover
remain u5 work; this delivery does not perform rollout or deployment.

## Out of scope and risk

No revoke UI, backend/gateway/deployment changes, tenant parsing changes, new kit
components, legacy edits, shared contracts, dependency pin changes or CI changes
are required by this page repair. The deployment worktree is untouched.

R3: duplicate POSTs could rotate twice, body drift could break the server contract,
and feedback could expose the new value. Exact request assertions, single-flight
typed confirmation, no automatic retry and synthetic-only non-leak fixtures cover
these risks. The independent checker, both providers and human approval remain
delivery gates; this maker does not grant approval, merge or deploy.
