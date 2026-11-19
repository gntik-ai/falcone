# Design and test seams

- HTTP request boundary: root/deep links, raw relative redirect matrix, traversal,
  immutable assets/missing assets, health, proxy path/body/headers, identical CSP.
  The transport-only fixture exercises the shipped handler and actual filesystem
  without sockets. CI also exercises Node and nginx with real listeners.
- Release CLI: independently committed blocking list and closure evidence; exact
  item set, CLOSED/COMPLETED, merged PR in the recorded repository, exact issue
  reference and merge-before-close. API replay uses offline fixtures and is forbidden
  in CI. API errors fail closed; no GitHub closer association is required.
- Parity validator CLI: explicit rows or a provable immutable object spread;
  unresolved, shadowed, defaulted, mutated/reassigned and overriding spreads fail.
- Parity browser boundary: guard open, actions, asynchronous readiness assertions
  and teardown. Negative journey adds sample copy only after open has completed.
- Docker CLI: a scratch build copies a marker from next/dist using the actual
  root build context; runtime test uses read-only root and UID 1000 and validates
  next-only layout, release metadata, and absence of package credential material.

The nginx maps use the raw request URI, normalizing only encoded unreserved
letters of the next prefix. Reserved suffix/query bytes remain unchanged.
Traversal is rejected before routing/redirects. A suffix that could produce a
network-path redirect is rejected instead of emitting an external Location.
Security headers are location-scoped so proxy responses remain undecorated.
The health response sets its default type to text/plain instead of adding a
second Content-Type; the request matrix checks the raw header count under an
application/octet-stream parent default.

Checker follow-up: Node also emits one text/plain Content-Type for health,
including when the bundle is absent. The transport-only request regression
failed on the missing header before this correction. The same regression caught
a 301 instead of 400 for /next/%5Cexternal.test/x; Node now rejects that leading
encoded backslash like nginx, without decoding redirect suffixes.
Reproduction command: node tests/unit/web-console-static-routing.test.mjs.

The non-blocking error-response differences remain outside the redirect parity
contract: nginx rejects traversal at server level, while Node retains its existing
proxy-first /v1 handling and static-error security headers. This preserves the
approved API routing boundary. The parity checkpoint relies on Playwright's
existing worker isolation; concurrent tests within one worker are not enabled.

The cutover CI job grants only contents, issues and pull-requests read access.
Its workflow contract checks those effective permissions and an unconditional
live gate. PR CI must confirm that the falcone GITHUB_TOKEN can also read the
two gntik-ai/gntik-ui issue/PR pairs. Cross-repository access cannot be verified
offline. An API denial remains a gate failure; there is no offline fallback.
If access is denied, the operator must provision an approved token with read
access to both repositories before rerunning the gate. No credentials are
retrieved or introduced by this source change.

The count 57 and prior tag in the gate intentionally bind this switch to its
approved snapshot. Generalizing this release-specific safety check is outside
the switch-release scope. The late-sample browser negative is enforced by the
existing ui-parity-negatives job and its required aggregate result.

Rollback evidence is operator-recorded from staging imageID and the GHCR manifest
on 2026-11-19. The switch digest must be recorded after publication. A staging
rollback rehearsal must restore the prior console and preserve an existing session.
Screenshots, parity in both languages, axe and viewport journeys run in PR CI;
visual assessment and baseline approval remain with the checker and operator.
